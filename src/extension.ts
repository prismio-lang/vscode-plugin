// The Prismio extension: a client of `prismio lsp` and nothing more.
//
// Every piece of language knowledge -- diagnostics, completion, hover, navigation, rename, the
// formatter, semantic highlighting -- is the toolchain's. These files start the server, find the
// toolchain, and offer the tasks, debug entry, code lenses and new-project command that
// `build.ums` and `prismio init` make possible. If they grow past a few hundred lines each, the
// logic they are gaining belongs in the server.

import * as vscode from "vscode";
import { PrismioCodeLenses } from "./codelens";
import { newProject } from "./newProject";
import { Server } from "./server";
import { StatusBar } from "./status";
import { debugTarget, runTask, taskProvider } from "./tasks";

export { findPrismio } from "./toolchain";

let server: Server | undefined;

const folderOf = (uri: string) => vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(uri));

// What the end-to-end suite asks of a running extension.
export interface PrismioApi { readonly serverState: string; readonly serverHeld: number; readonly serverTrace: string }

export async function activate(context: vscode.ExtensionContext): Promise<PrismioApi> {
  const output = vscode.window.createOutputChannel("Prismio");
  server = new Server(output);
  const lenses = new PrismioCodeLenses();
  context.subscriptions.push(
    output,
    server,
    new StatusBar(server),
    lenses,
    vscode.languages.registerCodeLensProvider([{ language: "prismio" }, { language: "ums" }], lenses),
    vscode.tasks.registerTaskProvider("prismio", taskProvider),
    vscode.commands.registerCommand("prismio.showOutput", () => output.show()),
    vscode.commands.registerCommand("prismio.restartServer", () => server?.restart()),
    vscode.commands.registerCommand("prismio.newProject", newProject),
    vscode.commands.registerCommand("prismio.debugTarget", (folder?: string, target?: string) =>
      debugTarget(typeof folder === "string" ? folderOf(folder) : undefined, target)),
    vscode.commands.registerCommand("prismio.runTarget", (folder: string, target: string) => {
      const f = folderOf(folder);
      return f ? runTask(f, { type: "prismio", command: "run", target }) : undefined;
    }),
    vscode.commands.registerCommand("prismio.runTests", (folder: string) => {
      const f = folderOf(folder);
      return f ? runTask(f, { type: "prismio", command: "test" }) : undefined;
    }),
    vscode.commands.registerCommand("prismio.runManifestCommand", (folder: string, name: string) => {
      const f = folderOf(folder);
      return f ? runTask(f, { type: "prismio", command: name }) : undefined;
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("prismio.path")) { void server?.restart(); }
      else if (e.affectsConfiguration("prismio.trace.server")) { server?.applyTrace(); }
    }),
  );
  await server.start();
  return {
    get serverState() { return server?.state ?? "stopped"; },
    get serverHeld() { return server?.held ?? 0; },
    get serverTrace() { return server?.trace ?? "off"; },
  };
}

export async function deactivate(): Promise<void> {
  await server?.stop();
}
