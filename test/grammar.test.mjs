// The TextMate grammar is generated, and these tests are what keep it so: it must equal what the
// generator makes of the committed token tables, those tables must equal what the compiler says
// now (when PRISMIO names one), and the grammar must colour a sample as the language reads it.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildGrammar, dumpTokens } from "../scripts/generate-grammar.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(import.meta.url);

test("the grammar is what the generator makes of the committed tokens", () => {
  const generated = JSON.stringify(buildGrammar(JSON.parse(read("syntaxes/tokens.json"))), null, 2) + "\n";
  assert.strictEqual(read("syntaxes/prismio.tmLanguage.json"), generated, "stale: run `pnpm run grammar`");
});

test("the committed tokens are what the compiler says now", { skip: process.env.PRISMIO ? false : "set PRISMIO to compare with a compiler" }, () => {
  assert.deepStrictEqual(JSON.parse(read("syntaxes/tokens.json")), dumpTokens(process.env.PRISMIO),
    "the compiler's token tables changed: run `PRISMIO=... pnpm run grammar --refresh`");
});

test("the tables are not empty (a vacuous grammar passes everything)", () => {
  const tokens = JSON.parse(read("syntaxes/tokens.json"));
  assert.ok(tokens.keywords.length > 20 && tokens.operators.length > 20 && tokens.types.integer.length > 5);
});

test("a sample is coloured as the language reads it", async () => {
  const textmate = require("vscode-textmate");
  const oniguruma = require("vscode-oniguruma");
  const wasm = readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer;
  await oniguruma.loadWASM(wasm);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: (s) => new oniguruma.OnigScanner(s), createOnigString: (s) => new oniguruma.OnigString(s) }),
    loadGrammar: async () => textmate.parseRawGrammar(read("syntaxes/prismio.tmLanguage.json"), "prismio.json"),
  });
  const grammar = await registry.loadGrammar("source.prismio");
  const scopesOf = (line) => grammar.tokenizeLine(line).tokens.map((t) => [line.slice(t.startIndex, t.endIndex), t.scopes.at(-1)]);
  const has = (line, text, scope) => assert.ok(scopesOf(line).some(([t, s]) => t === text && s === scope), `${text} should be ${scope} in ${line}: ${JSON.stringify(scopesOf(line))}`);
  has("fn add(a: Int) -> Int {", "fn", "storage.type.function.prismio");
  has("fn add(a: Int) -> Int {", "add", "entity.name.function.prismio");
  has("fn add(a: Int) -> Int {", "Int", "support.type.builtin.prismio");
  has("    return total", "return", "keyword.control.prismio");
  has("    let mut x = 0xFF_FF", "let", "storage.type.prismio");
  has("    let mut x = 0xFF_FF", "0xFF_FF", "constant.numeric.hex.prismio");
  has("    for i in 0..<10 {", "0", "constant.numeric.decimal.prismio");
  has("    if a and not b { }", "and", "keyword.operator.word.prismio");
  has("    let s = \"a\\n\"", "\\n", "constant.character.escape.prismio");
  has("// a comment", "// a comment", "comment.line.double-slash.prismio");
  has("/// doc line", "/// doc line", "comment.line.documentation.prismio");
  has("//// not documentation", "//// not documentation", "comment.line.double-slash.prismio");
  has("let ok = true", "true", "constant.language.prismio");
  has("public struct Point {", "Point", "entity.name.type.prismio");
  has("asm \"nop\"", "asm", "storage.type.prismio");
  assert.ok(!scopesOf("let asm = 1").some(([t, s]) => t === "asm" && s === "storage.type.prismio"), "asm is a keyword only before a string");
  has("    println(n)", "println", "entity.name.function.call.prismio");
});

test("the extension and each language have an icon, and the files exist and ship", () => {
  const manifest = JSON.parse(read("package.json"));
  const files = [manifest.icon];
  for (const language of manifest.contributes.languages) {
    assert.ok(language.icon, `language ${language.id} has no icon`);
    files.push(language.icon.light, language.icon.dark);
  }
  for (const file of files) {
    assert.ok(readFileSync(join(root, file)).length > 100, `${file} is missing or empty`);
  }
  // 128 px is what the Marketplace shows; a smaller picture is blurred there.
  const header = readFileSync(join(root, manifest.icon));
  assert.strictEqual(header.readUInt32BE(16), 128, "the extension icon is 128 px wide");
  assert.ok(!read(".vscodeignore").split("\n").some((line) => line.trim().startsWith("images")), "images/ is shipped");
});

test("block comments nest and span lines, and documentation comments are told apart", async () => {
  const { loadGrammar } = await import("./textmate.mjs");
  const { tokenize } = await loadGrammar("source.prismio", "prismio.tmLanguage.json");
  const lines = tokenize("/* outer /* inner */ still comment */ let x = 1\n/* a\n   b */ fn f() {}\n/** doc\n * more */\n/**/ let y = 2\n/***/ let z = 3");
  const is = (line, text, scope) => assert.ok(lines[line].some(([t, , scopes]) => t.includes(text) && scopes.includes(scope)),
    `${text} should be in ${scope} on line ${line}: ${JSON.stringify(lines[line].map((t) => [t[0], t[1]]))}`);
  const isNot = (line, text, scope) => assert.ok(!lines[line].some(([t, , scopes]) => t.includes(text) && scopes.includes(scope)), `${text} should not be ${scope}`);
  is(0, "still comment", "comment.block.prismio");
  is(0, "let", "source.prismio");
  isNot(0, "let", "comment.block.prismio");
  is(1, "a", "comment.block.prismio");
  is(2, "b", "comment.block.prismio");
  isNot(2, "fn", "comment.block.prismio");
  is(3, "doc", "comment.block.documentation.prismio");
  is(4, "more", "comment.block.documentation.prismio");
  isNot(5, "/*", "comment.block.documentation.prismio");
  is(5, "/*", "comment.block.prismio");
  isNot(6, "/*", "comment.block.documentation.prismio");
  isNot(5, "let", "comment.block.prismio");
  const triple = tokenize('let s = """one\ntwo"""\nlet t = 1');
  assert.ok(triple[1][0][2].includes("string.quoted.triple.prismio"), "a triple-quoted string spans lines");
  assert.strictEqual(triple[2][0][1], "storage.type.prismio");
});
