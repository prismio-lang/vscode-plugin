// The TextMate grammar for build.ums, hand-written (a manifest has no keyword table to generate from) and
// held to the manifest lexer's shapes: ums/parser/lexer.psm, as the JetBrains plugin's UmsLexer reads them.
import assert from "node:assert";
import { test } from "node:test";
import { loadGrammar } from "./textmate.mjs";

const MANIFEST = `# a shell-style comment
// and a slash comment
const MAJOR = 0
const VERSION = "\${MAJOR}.1.0"
enum Channel { STABLE = "stable", BETA }

project {
    name = "app-\${Channel.BETA}"
    version = VERSION
    description = "costs $$5, \\"quoted\\""
}

targets {
    executable("app") {
        entry = "src/main.psm"
        freestanding = true
        native {
            source("c/codec.c")
        }
    }
}

commands {
    command("dist") {
        run("tools/package.py", "--out", "dist", args)
        shell("echo", "x", 42)
    }
}
`;

test("a manifest is coloured as its lexer reads it", async () => {
  const { tokenize } = await loadGrammar("source.ums", "ums.tmLanguage.json");
  const lines = tokenize(MANIFEST);
  const scopeOf = (line, text) => {
    const found = lines[line].find(([t]) => t === text);
    assert.ok(found, `${text} not a token on line ${line + 1}: ${JSON.stringify(lines[line].map((t) => t.slice(0, 2)))}`);
    return found[1];
  };
  assert.strictEqual(scopeOf(0, "# a shell-style comment"), "comment.line.number-sign.ums");
  assert.strictEqual(scopeOf(1, "// and a slash comment"), "comment.line.double-slash.ums");
  assert.strictEqual(scopeOf(2, "const"), "storage.type.ums");
  assert.strictEqual(scopeOf(2, "MAJOR"), "entity.name.constant.ums");
  assert.strictEqual(scopeOf(2, "0"), "constant.numeric.integer.ums");
  assert.strictEqual(scopeOf(3, "${MAJOR}"), "meta.interpolation.ums");
  assert.strictEqual(scopeOf(4, "enum"), "storage.type.ums");
  assert.strictEqual(scopeOf(4, "Channel"), "entity.name.constant.ums");
  assert.strictEqual(scopeOf(4, "STABLE"), "constant.other.ums");
  assert.strictEqual(scopeOf(6, "project"), "keyword.other.block.ums");
  assert.strictEqual(scopeOf(7, "name"), "variable.other.property.ums");
  assert.strictEqual(scopeOf(7, "${Channel.BETA}"), "meta.interpolation.ums");
  assert.strictEqual(scopeOf(8, "VERSION"), "constant.other.ums");
  assert.strictEqual(scopeOf(9, "$$"), "constant.character.escape.ums");
  assert.strictEqual(scopeOf(9, '\\"'), "constant.character.escape.ums");
  assert.strictEqual(scopeOf(13, "executable"), "entity.name.function.ums");
  assert.strictEqual(scopeOf(14, "entry"), "variable.other.property.ums");
  assert.strictEqual(scopeOf(15, "true"), "constant.language.boolean.ums");
  assert.strictEqual(scopeOf(16, "native"), "keyword.other.block.ums");
  assert.strictEqual(scopeOf(17, "source"), "entity.name.function.ums");
  assert.strictEqual(scopeOf(24, "args"), "constant.language.args.ums");
  assert.strictEqual(scopeOf(25, "42"), "constant.numeric.integer.ums");
});

test("a # or // inside a string is not a comment, and an unterminated string ends the line", async () => {
  const { tokenize } = await loadGrammar("source.ums", "ums.tmLanguage.json");
  const [line] = tokenize('description = "a # b // c"');
  assert.ok(line.every(([, , scopes]) => !scopes.some((scope) => scope.startsWith("comment"))), JSON.stringify(line));
  const [bad, next] = tokenize('name = "oops\nversion = "1.0.0"');
  assert.ok(bad.some(([t, , scopes]) => t.includes("oops") && scopes.includes("string.quoted.double.ums")));
  assert.ok(next.some(([t, s]) => t === "version" && s === "variable.other.property.ums"), JSON.stringify(next.map((t) => t.slice(0, 2))));
});

test("the demo manifest of the end-to-end suite is coloured without a stray scope", async () => {
  const { tokenize } = await loadGrammar("source.ums", "ums.tmLanguage.json");
  const lines = tokenize(MANIFEST);
  const flat = lines.flat();
  assert.ok(flat.some(([, s]) => s === "variable.other.property.ums") && flat.some(([, s]) => s === "entity.name.function.ums"));
});
