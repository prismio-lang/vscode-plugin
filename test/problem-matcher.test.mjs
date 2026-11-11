// The problem matchers in package.json, run against output the 0.2.0 compiler really printed (captured in
// test/fixtures/output; the project path is normalised to /work). A matcher that does not match shows the
// user nothing in the Problems panel, and only real output says whether it does.
//
// This applies the patterns the way VS Code does: a multi-line matcher takes the first pattern on one line
// and the next pattern on the line after it; if that fails, the line is tried again as a first line.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const matchers = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).contributes.problemMatchers;
const output = (name) => readFileSync(join(root, "test", "fixtures", "output", name), "utf8").split("\n");

function problems(matcherName, lines) {
  const patterns = [].concat(matchers.find((m) => m.name === matcherName).pattern);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    let record = {};
    let ok = true;
    for (let p = 0; p < patterns.length; p++) {
      const match = new RegExp(patterns[p].regexp).exec(lines[i + p] ?? "");
      if (!match) { ok = false; break; }
      for (const field of ["file", "line", "column", "severity", "code", "message"]) {
        if (patterns[p][field] !== undefined) { record[field] = match[patterns[p][field]]; }
      }
    }
    if (ok) { found.push(record); i += patterns.length - 1; }
  }
  return found;
}

test("$prismio reads a warning and a type error with their locations", () => {
  const found = problems("prismio", output("compiler.txt"));
  assert.deepStrictEqual(found.map((p) => [p.severity, p.code, p.file, p.line, p.column]), [
    ["warning", "P2003", "/work/pm/src/main.psm", "4", "9"],
    ["error", "P4001", "/work/pm/src/main.psm", "6", "18"],
  ]);
  assert.match(found[1].message, /expected Int, found String/);
});

test("$prismio does not invent a location for a warning that has none", () => {
  assert.deepStrictEqual(problems("prismio", output("nolocation.txt")), []);
});

test("$prismio does not read the `aborting` summary as a problem", () => {
  assert.ok(!problems("prismio", output("compiler.txt")).some((p) => /aborting/.test(p.message)));
});

test("$prismio-ums reads the one-line manifest errors build.ums gets", () => {
  const found = problems("prismio-ums", output("manifest.txt"));
  assert.deepStrictEqual(found.map((p) => [p.severity, p.code, p.file, p.line, p.column]), [
    ["error", "UMS2104", "/work/pm/build.ums", "7", "5"],
    ["error", "UMS2307", "/work/pm/build.ums", "1", "1"],
  ]);
  assert.match(found[0].message, /executable requires exactly one string name/);
});

test("the two matchers do not read each other's output", () => {
  assert.deepStrictEqual(problems("prismio-ums", output("compiler.txt")), []);
  assert.deepStrictEqual(problems("prismio", output("manifest.txt")), []);
});

test("every task the extension makes uses both matchers", () => {
  const source = readFileSync(join(root, "src", "tasks.ts"), "utf8");
  assert.match(source, /MATCHERS = \["\$prismio", "\$prismio-ums"\]/);
});
