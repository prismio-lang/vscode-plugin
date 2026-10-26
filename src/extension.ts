// The Prismio extension: a client of `prismio lsp` and nothing more.
//
// Every piece of language knowledge -- diagnostics, completion, hover, navigation, rename, the
// formatter, semantic highlighting -- is the toolchain's. This file starts the server, finds the
// toolchain, and offers the tasks and debug entry that `build.ums` declares. If it grows past a
// few hundred lines, the logic it is gaining belongs in the server.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, Trace } from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let output: vscode.OutputChannel;

// The `prismio` to run: the setting, else the first on PATH, else the installer's directory.
export function findPrismio(configured: string, pathVariable = process.env.PATH ?? "", home = os.homedir()): string | undefined {
  if (configured.trim() !== "") { return configured.trim(); }
  const name = process.platform === "win32" ? "prismio.exe" : "prismio";
  const candidates = pathVariable.split(path.delimiter).filter((d) => d !== "").map((d) => path.join(d, name));
  candidates.push(path.join(home, ".prismio", "bin", name));
  return candidates.find((c) => fs.existsSync(c));
}

function prismioPath(): string | undefined {
  return findPrismio(vscode.workspace.getConfiguration("prismio").get<string>("path", ""));
}

async function startServer(context: vscode.ExtensionContext): Promise<void> {
  const prismio = prismioPath();
  if (prismio === undefined) {
    void vscode.window.showWarningMessage(
      "Prismio: no `prismio` found. Install the toolchain, or set `prismio.path`. Highlighting works without it; nothing else does.");
    return;
  }
  const serverOptions: ServerOptions = { command: prismio, args: ["lsp"], options: { env: process.env } };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "prismio" }],
    outputChannel: output,
    // The server watches build.ums and the .psm files it does not have open.
    synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/{*.psm,build.ums}") },
  };
  client = new LanguageClient("prismio", "Prismio", serverOptions, clientOptions);
  const trace = vscode.workspace.getConfiguration("prismio").get<string>("trace.server", "off");
  client.setTrace(trace === "verbose" ? Trace.Verbose : trace === "messages" ? Trace.Messages : Trace.Off);
  context.subscriptions.push({ dispose: () => void client?.stop() });
  try {
    await client.start();
  } catch (error) {
    output.appendLine(`could not start \`${prismio} lsp\`: ${String(error)}`);
    void vscode.window.showErrorMessage(`Prismio: could not start \`${prismio} lsp\` (see the Prismio output).`);
  }
}

// What build.ums declares: its targets and its commands. A line match, not a parse: the manifest's
// own validator is the toolchain's, and a wrong guess here only offers one task too many or too few.
export function manifestNames(text: string): { targets: string[]; commands: string[] } {
  const targets: string[] = [];
  const commands: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const target = /^\s*(?:executable|library|test|kernel)\s*\(\s*"([^"]+)"/.exec(line);
    if (target) { targets.push(target[1]); }
    const command = /^\s*command\s*\(\s*"([^"]+)"/.exec(line);
    if (command) { commands.push(command[1]); }
  }
  return { targets, commands };
}

interface PrismioTaskDefinition extends vscode.TaskDefinition { command: string; target?: string; release?: boolean }

function makeTask(folder: vscode.WorkspaceFolder, def: PrismioTaskDefinition, prismio: string): vscode.Task {
  const args = [def.command];
  if (def.release === true) { args.push("--release"); }
  if (def.target) { args.push(def.target); }
  const task = new vscode.Task(def, folder, `${def.command}${def.target ? " " + def.target : ""}`, "prismio",
    new vscode.ProcessExecution(prismio, args, { cwd: folder.uri.fsPath }), "$prismio");
  if (def.command === "build") { task.group = vscode.TaskGroup.Build; }
  if (def.command === "test") { task.group = vscode.TaskGroup.Test; }
  return task;
}

const taskProvider: vscode.TaskProvider = {
  provideTasks(): vscode.Task[] {
    const prismio = prismioPath();
    const tasks: vscode.Task[] = [];
    if (prismio === undefined) { return tasks; }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      let text = "";
      try { text = fs.readFileSync(path.join(folder.uri.fsPath, "build.ums"), "utf8"); } catch { continue; }
      const { targets, commands } = manifestNames(text);
      tasks.push(makeTask(folder, { type: "prismio", command: "build" }, prismio));
      tasks.push(makeTask(folder, { type: "prismio", command: "test" }, prismio));
      for (const target of targets) { tasks.push(makeTask(folder, { type: "prismio", command: "run", target }, prismio)); }
      for (const command of commands) { tasks.push(makeTask(folder, { type: "prismio", command }, prismio)); }
    }
    return tasks;
  },
  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const prismio = prismioPath();
    const folder = vscode.workspace.workspaceFolders?.[0];
    const def = task.definition as PrismioTaskDefinition;
    return prismio && folder && def.command ? makeTask(folder, def, prismio) : undefined;
  },
};

// Builds a target in the debug profile (which carries DWARF) and starts the debugger the user has.
async function debugTarget(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const prismio = prismioPath();
  if (!folder || !prismio) { void vscode.window.showErrorMessage("Prismio: open a project folder with a build.ums."); return; }
  let text = "";
  try { text = fs.readFileSync(path.join(folder.uri.fsPath, "build.ums"), "utf8"); } catch { /* handled below */ }
  const targets = manifestNames(text).targets;
  const target = targets.length <= 1 ? targets[0] : await vscode.window.showQuickPick(targets, { placeHolder: "Target to debug" });
  if (!target) { void vscode.window.showErrorMessage("Prismio: build.ums declares no target."); return; }
  const build = makeTask(folder, { type: "prismio", command: "build", target }, prismio);
  const done = new Promise<number>((resolve) => {
    const listener = vscode.tasks.onDidEndTaskProcess((e) => { if (e.execution.task === build) { listener.dispose(); resolve(e.exitCode ?? 1); } });
  });
  await vscode.tasks.executeTask(build);
  if ((await done) !== 0) { return; }
  const type = vscode.extensions.getExtension("vadimcn.vscode-lldb") ? "lldb" : "cppdbg";
  await vscode.debug.startDebugging(folder, {
    type, request: "launch", name: `Prismio: ${target}`,
    program: path.join(folder.uri.fsPath, ".prismio", "build", "debug", process.platform === "win32" ? `${target}.exe` : target),
    args: [], cwd: folder.uri.fsPath, ...(type === "cppdbg" ? { MIMode: "lldb" } : {}),
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("Prismio");
  context.subscriptions.push(
    output,
    vscode.tasks.registerTaskProvider("prismio", taskProvider),
    vscode.commands.registerCommand("prismio.showOutput", () => output.show()),
    vscode.commands.registerCommand("prismio.debugTarget", debugTarget),
    vscode.commands.registerCommand("prismio.restartServer", async () => {
      await client?.stop();
      await startServer(context);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("prismio.path")) { void vscode.commands.executeCommand("prismio.restartServer"); } }),
  );
  await startServer(context);
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
