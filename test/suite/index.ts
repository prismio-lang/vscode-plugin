// The extension's end-to-end checks, run inside VS Code. Each one asks the editor's own provider
// commands -- the same path a user's hover or F12 takes -- so a feature the server answers but the
// client never wired up fails here. No test framework: a failure throws, and the run reports all.
import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
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

test("Debug without a debugger extension says so, offers CodeLLDB and starts no session", async () => {
  // The suite runs with --disable-extensions, so neither CodeLLDB nor the C/C++ extension is there.
  assert.ok(!vscode.extensions.getExtension("vadimcn.vscode-lldb") && !vscode.extensions.getExtension("ms-vscode.cpptools"));
  const second = folderNamed("second");
  const shown: { message: string; buttons: string[] }[] = [];
  const opened: unknown[][] = [];
  const windowApi = vscode.window as unknown as Record<string, unknown>;
  const commandsApi = vscode.commands as unknown as Record<string, unknown>;
  const realError = windowApi.showErrorMessage;
  const realExecute = commandsApi.executeCommand;
  // Answer the message as a user who clicks its button.
  windowApi.showErrorMessage = async (message: string, ...buttons: string[]) => { shown.push({ message, buttons }); return buttons[0]; };
  commandsApi.executeCommand = (command: string, ...args: unknown[]) => {
    if (command === "extension.open") { opened.push(args); return Promise.resolve(undefined); }
    return (realExecute as typeof vscode.commands.executeCommand).call(vscode.commands, command, ...args);
  };
  const sessions: string[] = [];
  const tasks: string[] = [];
  const listeners = [
    vscode.debug.onDidStartDebugSession((s) => sessions.push(s.type)),
    vscode.tasks.onDidStartTask((e) => tasks.push(e.execution.task.name)),
  ];
  try {
    await vscode.commands.executeCommand("prismio.debugTarget", second.uri.toString(), "second");
    await sleep(1500);
  } finally {
    windowApi.showErrorMessage = realError;
    commandsApi.executeCommand = realExecute;
    listeners.forEach((l) => l.dispose());
  }
  assert.strictEqual(shown.length, 1, JSON.stringify(shown));
  assert.ok(/debugger/i.test(shown[0].message) && /CodeLLDB/.test(shown[0].message), shown[0].message);
  assert.deepStrictEqual(shown[0].buttons, ["Install CodeLLDB"]);
  assert.deepStrictEqual(opened, [["vadimcn.vscode-lldb"]], "the button opens CodeLLDB in the Extensions view");
  assert.deepStrictEqual(sessions, [], "no debug session, in particular no cppdbg one");
  assert.deepStrictEqual(tasks, [], "nothing is built for a debugger that is not there");
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
    // The new project's entry compiles and links.
    execFileSync(prismio, ["build"], { cwd: folder, env: { ...process.env, PRISMIO_INTERNAL_HOSTED: "1" }, encoding: "utf8" });
    assert.ok(fs.existsSync(path.join(folder, ".prismio", "build", "debug", "fresh-app")), "the built program");
    await assert.rejects(initProject(prismio, parent, "fresh-app"), /already exists/, "a second init in the same place says so");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ---- What the server provides, asked of the editor as a user's actions would ask it ----

const label = (item: vscode.CompletionItem) => (typeof item.label === "string" ? item.label : item.label.label);
const hoverText = (hovers: vscode.Hover[]) => hovers.flatMap((h) => h.contents).map((c) => (typeof c === "string" ? c : c.value)).join("\n");
const folderUri = () => vscode.workspace.workspaceFolders![0].uri;

// A file written into the workspace, opened and shown, then closed and removed whatever the body does.
async function withFiles<T>(files: Record<string, string>, shown: string, body: (doc: vscode.TextDocument) => Promise<T>): Promise<T> {
  for (const [name, text] of Object.entries(files)) { await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folderUri(), name), Buffer.from(text)); }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folderUri(), shown));
  await vscode.window.showTextDocument(doc);
  try {
    return await body(doc);
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    for (const name of Object.keys(files)) { await vscode.workspace.fs.delete(vscode.Uri.joinPath(folderUri(), name)).then(undefined, () => undefined); }
    await vscode.window.showTextDocument(main);
  }
}

// Completion at a position, retried until the server has analysed the file well enough to offer `wanted`.
const completions = (doc: vscode.TextDocument, line: number, character: number, wanted: string, trigger?: string) =>
  until(`a completion named ${wanted}`, async () => {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", doc.uri, new vscode.Position(line, character), trigger);
    return list.items.some((i) => label(i) === wanted) ? list.items : undefined;
  });

// The sample the position-based checks share: a function with two parameters, locals, a struct from another file.
const SAMPLE = [
  "import shapes", "", "fn helper(first: Int, second: Int) -> Int {", "    return first + second", "}", "",
  "fn main() -> Int {", "    let count = 1", "    let p = Point { x: 1, y: 2 }", "    let r = helper(count, 2)",
  "    let z = count", "    return r + z + p.x", "}", "",
].join("\n");

let sample: vscode.TextDocument | undefined;
async function sampleDoc(): Promise<vscode.TextDocument> {
  if (!sample) {
    const uri = vscode.Uri.joinPath(folderUri(), "features.psm");
    await vscode.workspace.fs.writeFile(uri, Buffer.from(SAMPLE));
    sample = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(sample);
    await until("the sample to analyse clean", async () => {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri, new vscode.Position(7, 10));
      return hovers.length > 0 && vscode.languages.getDiagnostics(uri).length === 0 ? true : undefined;
    });
  }
  return sample;
}

// Replace one line while `body` runs, then put it back.
async function withLine<T>(doc: vscode.TextDocument, line: number, text: string, body: () => Promise<T>): Promise<T> {
  const original = doc.lineAt(line).text;
  const range = () => doc.lineAt(line).range;
  const swap = async (to: string) => { const e = new vscode.WorkspaceEdit(); e.replace(doc.uri, range(), to); await vscode.workspace.applyEdit(e); };
  await swap(text);
  try { return await body(); } finally { await swap(original); }
}

test("completion offers the names in scope: locals, functions and types", async () => {
  const doc = await sampleDoc();
  await withLine(doc, 10, "    let z = cou", async () => {
    const items = await completions(doc, 10, 15, "count");
    const byLabel = (name: string) => items.find((i) => label(i) === name)!;
    assert.deepStrictEqual([byLabel("count").kind, byLabel("count").detail], [vscode.CompletionItemKind.Variable, "Int"]);
    assert.strictEqual(byLabel("p").detail, "Point");
    assert.deepStrictEqual([byLabel("helper").kind, byLabel("helper").detail], [vscode.CompletionItemKind.Function, "fn helper(first: Int, second: Int) -> Int"]);
    assert.strictEqual(byLabel("Point").kind, vscode.CompletionItemKind.Struct);
    assert.ok(!byLabel("count").additionalTextEdits?.length, "a local needs no import");
  });
});

test("completion offers a library function that is not imported, and accepting it adds the import", async () => {
  await withFiles({ "lib-completion.psm": "fn main() -> Int {\n    let n = 1\n    pri\n    return 0\n}\n" }, "lib-completion.psm", async (doc) => {
    const items = await completions(doc, 2, 7, "println");
    const item = items.find((i) => label(i) === "println")!;
    assert.strictEqual(item.kind, vscode.CompletionItemKind.Function);
    assert.ok(String(item.detail).includes("fn println"), String(item.detail));
    assert.deepStrictEqual((item.additionalTextEdits ?? []).map((e) => e.newText), ["import std.io\n"]);
    const inserted = typeof item.insertText === "object" ? item.insertText.value : (item.insertText ?? label(item));
    assert.ok(inserted.startsWith("println"), inserted);
    // Accepting it: the word becomes the call, and the item's own edits ride along.
    const accept = new vscode.WorkspaceEdit();
    accept.replace(doc.uri, new vscode.Range(2, 4, 2, 7), "println(n)");
    await vscode.workspace.applyEdit(accept);
    await until("println to be unknown without its import", () => (vscode.languages.getDiagnostics(doc.uri).some((d) => d.message.includes("println")) ? true : undefined));
    const imports = new vscode.WorkspaceEdit();
    for (const e of item.additionalTextEdits ?? []) { imports.replace(doc.uri, e.range, e.newText); }
    await vscode.workspace.applyEdit(imports);
    assert.ok(doc.getText().includes("import std.io\n"), doc.getText());
    await until("the file to compile clean", () => (vscode.languages.getDiagnostics(doc.uri).length === 0 ? true : undefined));
  });
});

test("completion on an import line offers modules", async () => {
  await withFiles({ "imports.psm": "import st\n\nfn main() -> Int {\n    return 0\n}\n" }, "imports.psm", async (doc) => {
    const items = await completions(doc, 0, 9, "std.io");
    const labels = items.map(label);
    assert.ok(["std.io", "std.string", "shapes"].every((l) => labels.includes(l)), labels.slice(0, 30).join(","));
    assert.ok(items.filter((i) => ["std.io", "shapes"].includes(label(i))).every((i) => i.kind === vscode.CompletionItemKind.Module));
    const e = new vscode.WorkspaceEdit();
    e.replace(doc.uri, doc.lineAt(0).range, "import std.");
    await vscode.workspace.applyEdit(e);
    const members = await completions(doc, 0, 11, "io", ".");
    assert.ok(["io", "string", "vec"].every((l) => members.map(label).includes(l)), members.map(label).slice(0, 30).join(","));
  });
});

test("completion offers type names where a type is written", async () => {
  const text = "import shapes\n\nfn helper(first: In) -> Po {\n    return first\n}\n\nfn main() -> Int {\n    let q: Po = 1\n    return 0\n}\n";
  await withFiles({ "types.psm": text }, "types.psm", async (doc) => {
    const spots: [number, number, string][] = [[2, 19, "a parameter's type"], [2, 26, "a return type"], [7, 13, "a let's type"]];
    for (const [line, character, where] of spots) {
      const items = await completions(doc, line, character, "Point");
      const labels = items.map(label);
      assert.strictEqual(items.find((i) => label(i) === "Point")!.kind, vscode.CompletionItemKind.Struct, where);
      assert.ok(["Int", "String", "Vec"].every((l) => labels.includes(l)), `${where}: ${labels.slice(0, 30).join(",")}`);
    }
  });
});

test("completion in build.ums offers blocks and keys", async () => {
  const folder = folderUri();
  const ums = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, "build.ums"));
  await vscode.window.showTextDocument(ums);
  const offer = async (line: number, text: string, wanted: string) => {
    const insert = new vscode.WorkspaceEdit();
    insert.insert(ums.uri, new vscode.Position(line, 0), text + "\n");
    await vscode.workspace.applyEdit(insert);
    try { return await completions(ums, line, text.length, wanted); } finally {
      const remove = new vscode.WorkspaceEdit();
      remove.delete(ums.uri, new vscode.Range(line, 0, line + 1, 0));
      await vscode.workspace.applyEdit(remove);
    }
  };
  try {
    const at0 = await offer(0, "ta", "targets");
    assert.ok(["project", "targets", "commands", "profiles", "dependencies"].every((l) => at0.map(label).includes(l)), at0.map(label).join(","));
    assert.ok(at0.find((i) => label(i) === "targets")!.detail, "a block comes with its description");
    const inProject = await offer(2, "    na", "name");
    assert.ok(["name", "version", "description", "license"].every((l) => inProject.map(label).includes(l)), inProject.map(label).join(","));
    assert.strictEqual(inProject.find((i) => label(i) === "name")!.kind, vscode.CompletionItemKind.Property);
    const inTarget = await offer(8, "        en", "entry");
    assert.ok(["entry", "freestanding", "triple"].every((l) => inTarget.map(label).includes(l)), inTarget.map(label).join(","));
  } finally {
    await vscode.window.showTextDocument(main);
  }
});

test("signature help names the function and follows the argument", async () => {
  const doc = await sampleDoc();
  const callLine = at(doc, "helper(count", "let r");
  const spots: [number, number, string][] = [[callLine.character + 7, 0, "first: Int"], [callLine.character + 14, 1, "second: Int"]];
  for (const [column, active, parameter] of spots) {
    const help = await until("signature help", async () => {
      const h = await vscode.commands.executeCommand<vscode.SignatureHelp>("vscode.executeSignatureHelpProvider", doc.uri, new vscode.Position(callLine.line, column), "(");
      return h && h.signatures.length > 0 ? h : undefined;
    });
    const signature = help.signatures[help.activeSignature];
    assert.strictEqual(signature.label, "fn helper(first: Int, second: Int) -> Int");
    assert.strictEqual(help.activeParameter, active, `column ${column}`);
    const [from, to] = signature.parameters[help.activeParameter].label as [number, number];
    assert.strictEqual(signature.label.slice(from, to), parameter);
  }
});

test("inlay hints show the type of a let and the parameter names at a call", async () => {
  const doc = await sampleDoc();
  const hints = await until("inlay hints", async () => {
    const h = await vscode.commands.executeCommand<vscode.InlayHint[]>("vscode.executeInlayHintProvider", doc.uri, new vscode.Range(0, 0, doc.lineCount, 0));
    return h.length > 0 ? h : undefined;
  });
  const shown = hints.map((h) => `${h.position.line}:${h.position.character} ${typeof h.label === "string" ? h.label : h.label.map((p) => p.value).join("")} ${h.kind === vscode.InlayHintKind.Parameter ? "param" : "type"}`).sort();
  const callLine = at(doc, "helper(count", "let r");
  assert.deepStrictEqual(shown, [
    "7:13 : Int type", "8:9 : Point type", "9:9 : Int type", `9:${callLine.character + 7} first: param`, `9:${callLine.character + 14} second: param`, "10:9 : Int type",
  ].sort());
});

test("document highlights mark the declaration as written and the uses as read", async () => {
  const doc = await sampleDoc();
  const found = await vscode.commands.executeCommand<vscode.DocumentHighlight[]>("vscode.executeDocumentHighlights", doc.uri, at(doc, "count", "let count"));
  const shown = found.map((h) => `${h.range.start.line}:${h.range.start.character} ${h.kind === vscode.DocumentHighlightKind.Write ? "write" : "read"}`).sort();
  assert.deepStrictEqual(shown, ["10:12 read", "7:8 write", `9:${at(doc, "count", "helper(count").character} read`].sort());
});

test("workspace symbols find functions and types across files", async () => {
  await sampleDoc();
  const find = async (query: string, name: string) => until(`${name} among the symbols`, async () => {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", query);
    return symbols.find((s) => s.name === name);
  });
  const point = await find("Poin", "Point");
  assert.deepStrictEqual([point.kind, path.basename(point.location.uri.fsPath), point.location.range.start.line], [vscode.SymbolKind.Struct, "shapes.psm", 0]);
  const helper = await find("help", "helper");
  assert.deepStrictEqual([helper.kind, path.basename(helper.location.uri.fsPath)], [vscode.SymbolKind.Function, "features.psm"]);
  const add = await find("add", "add");
  assert.strictEqual(path.basename(add.location.uri.fsPath), "main.psm");
});

test("go to type definition leads from a value to its struct", async () => {
  const doc = await sampleDoc();
  const found = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeTypeDefinitionProvider", doc.uri, at(doc, "p", "p.x"));
  assert.strictEqual(found.length, 1, JSON.stringify(found));
  const location = "targetUri" in found[0] ? { uri: found[0].targetUri, range: found[0].targetSelectionRange ?? found[0].targetRange } : found[0];
  assert.deepStrictEqual([path.basename(location.uri.fsPath), location.range.start.line, location.range.start.character], ["shapes.psm", 0, 14]);
});

test("folding ranges cover each function body", async () => {
  const doc = await sampleDoc();
  const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", doc.uri);
  assert.deepStrictEqual(ranges.map((r) => [r.start, r.end]).sort((a, b) => a[0] - b[0]), [[2, 3], [6, 11]]);
});

test("range formatting changes the lines asked for and leaves the rest", async () => {
  const messy = "fn  one( ) {\nlet a=1\n   return  a\n}\n\nfn  two( ) {\nlet b=2\n   return  b\n}\n";
  await withFiles({ "range.psm": messy }, "range.psm", async (doc) => {
    const edits = await until("range formatting edits", async () => {
      const e = await vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatRangeProvider", doc.uri, new vscode.Range(0, 0, 3, 1), { tabSize: 4, insertSpaces: true });
      return e && e.length > 0 ? e : undefined;
    });
    const apply = new vscode.WorkspaceEdit();
    apply.set(doc.uri, edits);
    await vscode.workspace.applyEdit(apply);
    assert.strictEqual(doc.getText(), "fn one() {\n    let a = 1\n    return a\n}\n\nfn  two( ) {\nlet b=2\n   return  b\n}\n");
  });
});

test("hover on a library name shows the standard library's signature and comment", async () => {
  const hovers = await until("the library hover", async () => {
    const h = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", main.uri, at(main, "println", "println(n"));
    return h.length > 0 ? h : undefined;
  });
  const text = hoverText(hovers);
  assert.ok(text.includes("public fn println<Ts: ConsoleText>(...args: Ts)") && text.includes("Prints each argument"), text);
});

test("the add-import quick fix clears the error, for a package module and a library one", async () => {
  const files = {
    "helpers.psm": "public fn triple(n: Int) -> Int {\n    return n * 3\n}\n",
    "middle.psm": "import helpers\nimport std.io\n\npublic fn viaMiddle() -> Int {\n    println(1)\n    return triple(1)\n}\n",
    "quickfix.psm": "import middle\n\nfn main() -> Int {\n    let a = triple(2)\n    println(viaMiddle())\n    return a\n}\n",
  };
  await withFiles(files, "quickfix.psm", async (doc) => {
    const diagnostics = await until("both missing imports reported", () => { const d = vscode.languages.getDiagnostics(doc.uri); return d.length === 2 ? d : undefined; });
    assert.ok(diagnostics.some((d) => d.message.includes("`triple` is declared in `helpers`")), JSON.stringify(diagnostics.map((d) => d.message)));
    const offered: string[] = [];
    for (const diagnostic of diagnostics) {
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", doc.uri, diagnostic.range, vscode.CodeActionKind.QuickFix.value);
      const fix = actions.find((a) => a.title.startsWith("Add `import"));
      assert.ok(fix && fix.edit, `no add-import fix for: ${diagnostic.message}\n${JSON.stringify(actions.map((a) => a.title))}`);
      offered.push(fix.title);
      await vscode.workspace.applyEdit(fix.edit);
    }
    assert.deepStrictEqual(offered.sort(), ["Add `import helpers`", "Add `import std.io`"]);
    assert.ok(doc.getText().includes("import helpers\n") && doc.getText().includes("import std.io\n"), doc.getText());
    await until("the file to compile clean", () => (vscode.languages.getDiagnostics(doc.uri).length === 0 ? true : undefined));
  });
});

test("restarting the server leaves it running, again and again", async () => {
  const api = vscode.extensions.getExtension("Prismio.prismio")!.exports as PrismioApi;
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

test("after a restart the diagnostics are back", async () => {
  const api = vscode.extensions.getExtension("Prismio.prismio")!.exports as PrismioApi;
  await withFiles({ "broken.psm": "fn main() -> Int {\n    return missing\n}\n" }, "broken.psm", async (doc) => {
    await until("the error", () => (vscode.languages.getDiagnostics(doc.uri).length > 0 ? true : undefined));
    await vscode.commands.executeCommand("prismio.restartServer");
    await until("the server running", () => (api.serverState === "running" ? true : undefined));
    const again = await until("the error again", () => { const d = vscode.languages.getDiagnostics(doc.uri); return d.length > 0 ? d : undefined; });
    assert.ok(again.some((d) => d.source === "prismio" && d.message.includes("missing")), JSON.stringify(again.map((d) => d.message)));
  });
});

test("the status bar item shows the toolchain's version and a running server", async () => {
  const api = vscode.extensions.getExtension("Prismio.prismio")!.exports as PrismioApi;
  const prismio = vscode.workspace.getConfiguration("prismio").get<string>("path", "");
  const version = /^prismio\s+(\S+)/.exec(execFileSync(prismio, ["--version"], { encoding: "utf8", env: { ...process.env, PRISMIO_INTERNAL_HOSTED: "1" } }))![1];
  await until("the version in the status item", () => (api.statusText === `$(check) Prismio ${version}` ? true : undefined));
});

test("a change to prismio.trace.server reaches the running server without a restart", async () => {
  const api = vscode.extensions.getExtension("Prismio.prismio")!.exports as PrismioApi;
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
  const extension = vscode.extensions.getExtension("Prismio.prismio")!;
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
