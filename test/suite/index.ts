// The extension's end-to-end checks, run inside VS Code. Each one asks the editor's own provider
// commands -- the same path a user's hover or F12 takes -- so a feature the server answers but the
// client never wired up fails here. No test framework: a failure throws, and the run reports all.
import * as assert from "node:assert";
import * as vscode from "vscode";

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

test("tasks come from build.ums", async () => {
  const tasks = await vscode.tasks.fetchTasks({ type: "prismio" });
  const names = tasks.map((t) => t.name);
  assert.ok(names.includes("build") && names.includes("run demo") && names.includes("hello"), names.join(","));
});

export async function run(): Promise<void> {
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
    try { await body(); console.log(`ok   ${name}`); } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${String(error)}`); }
  }
  if (failures.length > 0) { throw new Error(`${failures.length} of ${tests.length} failed: ${failures.join("; ")}`); }
}
