// What the .vsix would carry, checked against an allowlist: a workspace file with local paths, the token
// snapshot the grammar generator reads, a test or a source map must not ship; the files the extension
// loads must. `vsce ls` lists exactly what `vsce package` would put in the archive.
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const ALLOWED = [
  /^package\.json$/, /^README\.md$/, /^LICENSE$/, /^CHANGELOG\.md$/, /^language-configuration\.json$/,
  /^ums-language-configuration\.json$/,
  /^snippets\/[A-Za-z0-9_.-]+\.json$/,
  /^syntaxes\/(prismio|ums)\.tmLanguage\.json$/,
  /^images\/[A-Za-z0-9_.-]+\.(png|svg)$/,
  /^out\/src\/[A-Za-z0-9_./-]+\.js$/,
  // The runtime dependencies, which are not bundled.
  /^node_modules\//,
];

test("the .vsix carries only what the extension loads", () => {
  const listed = execFileSync("npx", ["--no-install", "vsce", "ls"], { cwd: root, encoding: "utf8" })
    .split("\n").map((l) => l.trim()).filter((l) => l !== "");
  assert.ok(listed.includes("package.json") && listed.includes("out/src/extension.js"), listed.slice(0, 20).join("\n"));
  const stray = listed.filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));
  assert.deepStrictEqual(stray, [], `files that would ship but are not on the allowlist:\n${stray.join("\n")}`);
  assert.ok(!listed.some((file) => !file.startsWith("node_modules/") && file.endsWith(".map")), "source maps ship");
});

test("everything the manifest points at ships", () => {
  const listed = new Set(execFileSync("npx", ["--no-install", "vsce", "ls"], { cwd: root, encoding: "utf8" }).split("\n").map((l) => l.trim()));
  const wanted = [manifest.main, manifest.icon];
  for (const language of manifest.contributes.languages) { wanted.push(language.configuration, language.icon.light, language.icon.dark); }
  for (const grammar of manifest.contributes.grammars ?? []) { wanted.push(grammar.path); }
  for (const snippet of manifest.contributes.snippets ?? []) { wanted.push(snippet.path); }
  for (const file of wanted.map((f) => f.replace(/^\.\//, ""))) {
    assert.ok(listed.has(file), `${file} is referenced by package.json and would not ship`);
  }
});
