// The extension's end-to-end checks, run inside VS Code. Each one asks the editor's own provider
// commands -- the same path a user's hover or F12 takes -- so a feature the server answers but the
// client never wired up fails here. No test framework: a failure throws, and the run reports all.
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { PrismioApi } from "../../src/extension";
import { parseManifest } from "../../src/manifest";
import { initProject } from "../../src/newProject";
import { tasksFor } from "../../src/tasks";

// The extension host's console is not always shown by the runner; PRISMIO_E2E_LOG names a file that gets the same lines.
const report = (line: string) => {
  console.log(line);
  if (process.env.PRISMIO_E2E_LOG) { fs.appendFileSync(process.env.PRISMIO_E2E_LOG, line + "\n"); }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(what: string, produce: () => Thenable<T | undefined> | T | undefined, ms = 40000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await produce();
    if (value !== undefined) { return value; }
    if (Date.now() > deadline) { throw new Error(`timed out waiting for ${what}`); }
    await sleep(250);
  }
}

function at(doc: vscode.TextDocument, needle: string, within: string, delta = 0): vscode.Position {
  for (let line = 0; line < doc.lineCount; line++) {
    const text = doc.lineAt(line).text;
    if (!text.includes(within)) { continue; }
    return new vscode.Position(line, text.indexOf(needle, text.indexOf(within)) + delta);
  }
  throw new Error(`${needle} not found in a line with ${within}`);
}

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, body: () => Promise<void>) => tests.push([name, body]);

let main: vscode.TextDocument;
let editor: vscode.TextEditor;

test("the sample program is clean, then an error shows with its code", async () => {
  assert.deepStrictEqual(vscode.languages.getDiagnostics(main.uri), [], "the sample program should be clean");
  await editor.edit((b) => b.insert(new vscode.Position(main.lineCount - 1, 0), "fn broken() -> Int { return missing }\n"));
  const diagnostics = await until("the error", () => { const d = vscode.languages.getDiagnostics(main.uri); return d.length > 0 ? d : undefined; });
  assert.ok(diagnostics.some((d) => d.source === "prismio" && /P\d+/.test(String(typeof d.code === "object" ? d.code.value : d.code))), JSON.stringify(diagnostics));
  await vscode.commands.executeCommand("undo");
  await until("clean again", () => (vscode.languages.getDiagnostics(main.uri).length === 0 ? true : undefined));
});

test("hover shows the signature and the comment, across files", async () => {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", main.uri, at(main, "add", "add(p.x"));
  const text = hovers.flatMap((h) => h.contents).map((c) => (typeof c === "string" ? c : c.value)).join("\n");
  assert.ok(text.includes("fn add(a: Int, b: Int) -> Int") && text.includes("Add two numbers."), text);
  const sum = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", main.uri, at(main, "sum", "p.sum"));
  const sumText = sum.flatMap((h) => h.contents).map((c) => (typeof c === "string" ? c : c.value)).join("\n");
  assert.ok(sumText.includes("The sum of both coordinates."), sumText);
});

test("go to definition crosses files", async () => {
  const found = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeDefinitionProvider", main.uri, at(main, "Point", "Point {"));
  assert.ok(found.length === 1 && JSON.stringify(found).includes("shapes.psm"), JSON.stringify(found));
});

test("go to definition reaches the library, whose source the server writes out", async () => {
  const found = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeDefinitionProvider", main.uri, at(main, "println", "println(n"));
  assert.ok(found.length >= 1 && JSON.stringify(found).includes("io.psm"), JSON.stringify(found));
  const target = "targetUri" in found[0] ? found[0].targetUri : found[0].uri;
  const text = (await vscode.workspace.openTextDocument(target)).getText();
  assert.ok(text.includes("fn println"), "the library's source opens: " + target.fsPath);
});

test("find references lists the declaration and the uses", async () => {
  const found = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", main.uri, at(main, "add", "fn add"));
  assert.ok(found.length >= 2 && found.every((l) => l.uri.fsPath.endsWith("main.psm")), JSON.stringify(found));
});

test("completion after a dot lists the members", async () => {
  const line = at(main, "add(p.x", "add(p.x").line;
  const original = main.lineAt(line).text;
  await editor.edit((b) => b.replace(main.lineAt(line).range, "    let n = add(p., p.sum())"));
  try {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", main.uri, new vscode.Position(line, "    let n = add(p.".length), ".");
    const labels = list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(["x", "y", "sum"].every((l) => labels.includes(l)), `${main.lineAt(line).text} => ${labels.slice(0, 20).join(",")}`);
  } finally {
    await editor.edit((b) => b.replace(main.lineAt(line).range, original));
  }
});

test("the outline lists the functions", async () => {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", main.uri);
  assert.deepStrictEqual(symbols.map((s) => s.name), ["add", "main"]);
});

test("rename changes every use", async () => {
  const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>("vscode.executeDocumentRenameProvider", main.uri, at(main, "total", "let total"), "sum2");
  assert.strictEqual(edit.entries().flatMap(([, edits]) => edits).length, 2);
});

test("formatting uses prismio fmt", async () => {
  const folder = vscode.workspace.workspaceFolders![0].uri;
  const messy = vscode.Uri.joinPath(folder, "messy.psm");
  await vscode.workspace.fs.writeFile(messy, Buffer.from("fn  f( ) {\nlet a=1\n   return  a\n}\n"));
  const doc = await vscode.workspace.openTextDocument(messy);
  await vscode.window.showTextDocument(doc);
  await sleep(1500);
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", doc.uri, { tabSize: 4, insertSpaces: true });
  assert.ok(edits && edits.length > 0, "no edits from the formatter");
  const edit = new vscode.WorkspaceEdit();
  edit.set(doc.uri, edits);
  await vscode.workspace.applyEdit(edit);
  assert.strictEqual(doc.getText(), "fn f() {\n    let a = 1\n    return a\n}\n");
});

test("semantic tokens colour the declarations", async () => {
  const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", main.uri);
  assert.ok(tokens && tokens.data.length > 20 && tokens.data.length % 5 === 0, String(tokens?.data.length));
});

const folderNamed = (name: string) => vscode.workspace.workspaceFolders!.find((f) => f.name === name)!;
const scopeName = (t: vscode.Task) => (typeof t.scope === "object" ? t.scope.name : "");

test("tasks come from build.ums in every folder, and only what can run", async () => {
  const tasks = await vscode.tasks.fetchTasks({ type: "prismio" });
  const namesIn = (folder: string) => tasks.filter((t) => scopeName(t) === folder).map((t) => t.name).sort();
  assert.deepStrictEqual(namesIn("demo"), ["build", "hello", "run demo"]);
  // The second folder has a test target, which gets `test` and not `run`.
  assert.deepStrictEqual(namesIn("second"), ["build", "run second", "test"]);
  const manifest = parseManifest('targets {\n  executable("a") { entry = "a.psm" }\n  library("b") { entry = "b.psm" }\n  test("c") { entry = "c.psm" }\n  kernel("d") { entry = "d.psm" }\n}\n');
  const offered = tasksFor(folderNamed("demo"), manifest, "prismio").map((t) => t.name);
  assert.deepStrictEqual(offered, ["build", "test", "run a"]);
});

test("a task of the second folder runs in the second folder", async () => {
  const second = folderNamed("second");
  const exitCode = new Promise<number | undefined>((resolve) => {
    const listener = vscode.tasks.onDidEndTaskProcess((e) => {
      if (scopeName(e.execution.task) === "second" && e.execution.task.name === "build") { listener.dispose(); resolve(e.exitCode); }
    });
  });
  const build = (await vscode.tasks.fetchTasks({ type: "prismio" })).find((t) => scopeName(t) === "second" && t.name === "build")!;
  await vscode.tasks.executeTask(build);
  assert.strictEqual(await exitCode, 0);
  assert.ok(fs.existsSync(path.join(second.uri.fsPath, ".prismio", "build", "debug", "second")), "built beside the second build.ums");
});

test("debugging starts with a build of the chosen folder's target", async () => {
  const second = folderNamed("second");
  const started = new Promise<vscode.Task>((resolve) => {
    const listener = vscode.tasks.onDidStartTaskProcess((e) => { listener.dispose(); resolve(e.execution.task); });
  });
  void vscode.commands.executeCommand("prismio.debugTarget", second.uri.toString(), "second");
  const task = await started;
  assert.deepStrictEqual([scopeName(task), task.name], ["second", "build second"]);
});

test("a manifest error shows up as a diagnostic, from the server", async () => {
  const ums = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "build.ums"));
  assert.strictEqual(ums.languageId, "ums");
  const manifestEditor = await vscode.window.showTextDocument(ums);
  try {
    await sleep(3000);
    assert.deepStrictEqual(vscode.languages.getDiagnostics(ums.uri), [], "the demo manifest should be clean");
    await manifestEditor.edit((b) => b.insert(new vscode.Position(1, 0), "    nonsense = 1\n"));
    const diagnostics = await until("the manifest error", () => { const d = vscode.languages.getDiagnostics(ums.uri); return d.length > 0 ? d : undefined; });
    assert.ok(diagnostics.some((d) => /UMS\d+/.test(String(typeof d.code === "object" ? d.code.value : d.code))), JSON.stringify(diagnostics));
    await vscode.commands.executeCommand("undo");
    await until("clean again", () => (vscode.languages.getDiagnostics(ums.uri).length === 0 ? true : undefined));
  } finally {
    await vscode.window.showTextDocument(main);
  }
});

test("run and debug code lenses sit above fn main and above the manifest's targets and commands", async () => {
  const folder = vscode.workspace.workspaceFolders![0].uri;
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", main.uri);
  const mainLine = at(main, "fn main", "fn main").line;
  const onMain = lenses.filter((l) => l.range.start.line === mainLine).map((l) => l.command?.title ?? "");
  assert.ok(onMain.some((t) => t.includes("Run demo")) && onMain.some((t) => t.includes("Debug")), JSON.stringify(lenses.map((l) => [l.range.start.line, l.command?.title])));
  assert.ok(lenses.every((l) => l.range.start.line === mainLine), "only fn main has lenses");
  const shapes = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, "shapes.psm"));
  assert.deepStrictEqual(await vscode.commands.executeCommand("vscode.executeCodeLensProvider", shapes.uri), [], "shapes.psm is not an entry");

  const ums = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, "build.ums"));
  const manifestLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", ums.uri);
  const titles = manifestLenses.map((l) => `${l.range.start.line}:${l.command?.title}`);
  const targetLine = at(ums, "executable", "executable(").line;
  const commandLine = at(ums, "command", "command(").line;
  assert.ok(titles.some((t) => t.startsWith(`${targetLine}:`) && t.includes("Run demo")) && titles.some((t) => t.startsWith(`${targetLine}:`) && t.includes("Debug")), titles.join(" | "));
  assert.ok(titles.some((t) => t.startsWith(`${commandLine}:`) && t.includes("Run hello")), titles.join(" | "));
});

test("the second folder gets its lenses too, and no Run on a test target", async () => {
  const folder = folderNamed("second").uri;
  const app = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, "app.psm"));
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", app.uri);
  assert.ok(lenses.some((l) => l.command?.title.includes("Run second")), JSON.stringify(lenses.map((l) => l.command?.title)));
  const ums = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, "build.ums"));
  const titles = (await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", ums.uri)).map((l) => l.command?.title ?? "");
  assert.ok(titles.some((t) => t.includes("Run second")) && titles.some((t) => t.includes("Run tests")), titles.join(" | "));
  assert.ok(!titles.some((t) => t.includes("Run checks")), "a test target has no Run: " + titles.join(" | "));
});

test("the snippets are offered", async () => {
  const snip = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "snip.psm");
  await vscode.workspace.fs.writeFile(snip, Buffer.from("stru\n"));
  const doc = await vscode.workspace.openTextDocument(snip);
  await vscode.window.showTextDocument(doc);
  try {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", doc.uri, new vscode.Position(0, 4));
    const snippets = list.items.filter((i) => i.kind === vscode.CompletionItemKind.Snippet).map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(snippets.includes("struct"), snippets.join(",") || "no snippet at all");
  } finally {
    await vscode.window.showTextDocument(main);
  }
});

test("Enter in a /// comment continues it", async () => {
  const file = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "enter.psm");
  await vscode.workspace.fs.writeFile(file, Buffer.from("/// first\n"));
  const doc = await vscode.workspace.openTextDocument(file);
  const e = await vscode.window.showTextDocument(doc);
  try {
    e.selection = new vscode.Selection(0, 9, 0, 9);
    await vscode.commands.executeCommand("type", { text: "\n" });
    assert.strictEqual(doc.lineAt(1).text, "/// ", JSON.stringify(doc.getText()));
  } finally {
    await vscode.window.showTextDocument(main);
  }
});

test("New Project writes what prismio init writes", async () => {
  const prismio = vscode.workspace.getConfiguration("prismio").get<string>("path", "");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "prismio-new-"));
  try {
    const folder = await initProject(prismio, parent, "fresh-app");
    assert.strictEqual(folder, path.join(parent, "fresh-app"));
    const manifest = fs.readFileSync(path.join(folder, "build.ums"), "utf8");
    assert.ok(manifest.includes('name = "fresh-app"') && /prismio = "\d+\.\d+\.\d+/.test(manifest), manifest);
    assert.ok(fs.existsSync(path.join(folder, "src", "main.psm")));
    await assert.rejects(initProject(prismio, parent, "fresh-app"), /already exists/, "a second init in the same place says so");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("restarting the server leaves it running, again and again", async () => {
  const api = vscode.extensions.getExtension("prismio.prismio")!.exports as PrismioApi;
  assert.strictEqual(api.serverState, "running");
  const held = api.serverHeld;
  assert.ok(held > 0);
  for (let i = 0; i < 3; i++) {
    await vscode.commands.executeCommand("prismio.restartServer");
    await until("the server running again", () => (api.serverState === "running" ? true : undefined));
  }
  assert.strictEqual(api.serverHeld, held, "a restart must not leave listeners or watchers behind");
  await sleep(3000);
  const hovers = await until("a hover from the restarted server", async () => {
    const h = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", main.uri, at(main, "add", "add(p.x"));
    return h.length > 0 ? h : undefined;
  });
  assert.ok(hovers.length > 0);
});

test("a change to prismio.trace.server reaches the running server without a restart", async () => {
  const api = vscode.extensions.getExtension("prismio.prismio")!.exports as PrismioApi;
  const config = vscode.workspace.getConfiguration("prismio");
  assert.strictEqual(api.serverTrace, "off");
  try {
    await config.update("trace.server", "verbose", vscode.ConfigurationTarget.Workspace);
    await until("the trace to follow the setting", () => (api.serverTrace === "verbose" ? true : undefined));
    assert.strictEqual(api.serverState, "running", "no restart was needed");
  } finally {
    await config.update("trace.server", undefined, vscode.ConfigurationTarget.Workspace);
  }
  await until("the trace to switch off", () => (api.serverTrace === "off" ? true : undefined));
});

async function runAll(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders![0].uri;
  main = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, "main.psm"));
  editor = await vscode.window.showTextDocument(main);
  await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, "shapes.psm"));
  const extension = vscode.extensions.getExtension("prismio.prismio")!;
  await extension.activate();
  await until("the first check", () => (vscode.languages.getDiagnostics(main.uri) !== undefined ? true : undefined));
  await sleep(4000);
  const failures: string[] = [];
  for (const [name, body] of tests) {
    try { await body(); report(`ok   ${name}`); } catch (error) { failures.push(name); report(`FAIL ${name}: ${String(error)}`); }
  }
  if (failures.length > 0) { throw new Error(`${failures.length} of ${tests.length} failed: ${failures.join("; ")}`); }
}

export async function run(): Promise<void> {
  try { await runAll(); } catch (error) { report(`ERROR ${String(error instanceof Error ? error.stack : error)}`); throw error; }
}
