// The language configurations: comment toggling, and what Enter does inside a documentation comment.
// VS Code applies an onEnterRule when beforeText matches the text before the cursor (and afterText the
// text after it, previousLineText the line above); the first rule that does decides, so the test applies
// them in that order.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const prismio = config("language-configuration.json");

function enter(before, { after = "", previous = "" } = {}) {
  for (const rule of prismio.onEnterRules) {
    if (!new RegExp(rule.beforeText).test(before)) { continue; }
    if (rule.afterText && !new RegExp(rule.afterText).test(after)) { continue; }
    if (rule.previousLineText && !new RegExp(rule.previousLineText).test(previous)) { continue; }
    return rule.action;
  }
  return undefined;
}

test("Prismio has block comments, which nest, and line comments", () => {
  assert.deepStrictEqual(prismio.comments.blockComment, ["/*", "*/"]);
  assert.strictEqual(prismio.comments.lineComment, "//");
});

test("Enter in a /// comment continues it, and a //// separator or plain // does not", () => {
  assert.strictEqual(enter("/// The sum.")?.appendText, "/// ");
  assert.strictEqual(enter("    /// indented")?.appendText, "/// ");
  assert.strictEqual(enter("/// ")?.appendText, "/// ");
  assert.strictEqual(enter("//// ----"), undefined);
  assert.strictEqual(enter("// plain"), undefined);
});

test("Enter in a /** */ comment continues with a star, and closes tidily", () => {
  assert.strictEqual(enter("/** Adds one.")?.appendText, " * ");
  assert.strictEqual(enter("/**", { after: " */" })?.indent, "indentOutdent");
  assert.strictEqual(enter(" * second line", { previous: "/** first" })?.appendText, "* ");
  assert.strictEqual(enter("/**/"), undefined, "an empty comment is not a doc comment");
  assert.strictEqual(enter(" */")?.removeText, 1);
});

test("the manifest language has its own configuration, with # comments", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).contributes.languages.find((l) => l.id === "ums");
  assert.strictEqual(manifest.configuration, "./ums-language-configuration.json");
  const ums = config("ums-language-configuration.json");
  assert.strictEqual(ums.comments.lineComment, "#");
  assert.strictEqual(ums.comments.blockComment, undefined, "UMS has no block comment");
});

test("the Prismio defaults: four spaces, and this extension formats", () => {
  const defaults = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).contributes.configurationDefaults["[prismio]"];
  assert.strictEqual(defaults["editor.tabSize"], 4);
  assert.strictEqual(defaults["editor.insertSpaces"], true);
  assert.strictEqual(defaults["editor.defaultFormatter"], "io.prismio");
});
