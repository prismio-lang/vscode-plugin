// Every snippet, expanded, against the compiler: the same check the JetBrains plugin's PrismioLiveTemplatesTest
// makes of its live templates. A snippet that writes `;` (which is not in the language) or a `match` without
// parentheses hands the user code that does not build, and nothing else looks at the snippet file. The compile
// half runs with PRISMIO set; without it the file is still held to the rule that no snippet contains `;`.
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snippets = JSON.parse(readFileSync(join(root, "snippets", "prismio.json"), "utf8"));
const text = (snippet) => [].concat(snippet.body).join("\n").replace(/\t/g, "    ");

// Valid text for a placeholder, by its default text; an entry under the snippet's name overrides.
const VALUES = { name: "name", Name: "Shape", Int: "Int", field: "field", Variant1: "First", Variant2: "Second", U16: "U16",
  Entry1: "One", Entry2: "Two", "0": "0", "1": "1", Type: "Holder", method: "method", true: "true", item: "item",
  collection: "collection", i: "i", n: "3", var: "var", value: "scrutinee", result: 'println("a")', default: 'println("b")' };
const OVERRIDES = { match: {}, let: {}, letm: {}, pln: { "": '"hello"' }, fn: { "": "return 0" } };
// What the user types at $0 or into an empty ${n}, where the snippet cannot compile without it.
const EMPTY = { fn: "return 0", pln: '"hello"' };

export function expand(name, snippet) {
  const body = text(snippet);
  return body
    .replace(/\$\{\d+:([^}]*)\}/g, (_, d) => OVERRIDES[name]?.[d] ?? VALUES[d] ?? assert.fail(`${name}: no value for placeholder ${d}`))
    .replace(/\$\{\d+\}/g, () => EMPTY[name] && name === "pln" ? EMPTY.pln : "")
    .replace(/\$0/g, EMPTY[name] && name === "fn" ? EMPTY.fn : "");
}

test("no snippet contains a semicolon, which is not in the language", () => {
  assert.ok(Object.keys(snippets).length >= 15);
  for (const [name, snippet] of Object.entries(snippets)) { assert.ok(!text(snippet).includes(";"), `${name} writes a ;`); }
});

test("every snippet the JetBrains plugin has is here", () => {
  for (const name of ["main", "fn", "fnv", "struct", "enum", "codeset", "impl", "if", "ife", "while", "for", "forr", "match", "let", "letm", "pln", "extern"]) {
    assert.ok(snippets[name], `snippet ${name} is missing`);
    assert.strictEqual(snippets[name].prefix, name);
  }
});

test("every snippet expands to code the compiler accepts", { skip: process.env.PRISMIO ? false : "set PRISMIO to compile the snippets" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "prismio-snippets-"));
  const declaration = /^(fn|struct|enum|codeset|impl|extern)\b/;
  const failures = [];
  try {
    for (const [name, snippet] of Object.entries(snippets)) {
      const body = expand(name, snippet);
      const prelude = name === "impl" ? "struct Holder { n: Int }\n\n" : "";
      const file = declaration.test(body)
        ? `import std.io\n\n${prelude}${body}\n`
        : `import std.io\n\nfn main() -> Int {\n    let collection = [1, 2]\n    let scrutinee = 0\n    ${body.replace(/\n/g, "\n    ")}\n    return 0\n}\n`;
      writeFileSync(join(dir, "snippet.psm"), file);
      try {
        execFileSync(process.env.PRISMIO, ["check", "snippet.psm"], { cwd: dir, encoding: "utf8", env: { ...process.env, PRISMIO_INTERNAL_HOSTED: "1" }, stdio: "pipe" });
      } catch (error) {
        failures.push(`snippet \`${name}\` expands to\n${file}\nand the compiler says:\n${error.stdout}${error.stderr}`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.deepStrictEqual(failures, [], failures.join("\n----\n"));
});
