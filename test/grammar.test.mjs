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
  assert.strictEqual(read("syntaxes/prismio.tmLanguage.json"), generated, "stale: run `npm run grammar`");
});

test("the committed tokens are what the compiler says now", { skip: process.env.PRISMIO ? false : "set PRISMIO to compare with a compiler" }, () => {
  assert.deepStrictEqual(JSON.parse(read("syntaxes/tokens.json")), dumpTokens(process.env.PRISMIO),
    "the compiler's token tables changed: run `PRISMIO=... npm run grammar -- --refresh`");
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
  has("let ok = true", "true", "constant.language.prismio");
  has("public struct Point {", "Point", "entity.name.type.prismio");
  has("    println(n)", "println", "entity.name.function.call.prismio");
});
