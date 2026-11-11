// The editor-free helpers: version parsing, the missing-server message, project names and the status text.
import assert from "node:assert";
import { test } from "node:test";
import { missingServerMessage, parseVersion, statusText, validProjectName } from "../out/src/pure.js";

test("the version is the second word of the first line of --version", () => {
  assert.strictEqual(parseVersion("prismio 0.2.0\nllvm 23.1.5\ncompiler /x\nstdlib /y\n"), "0.2.0");
  assert.strictEqual(parseVersion("prismio 0.3.0-beta.1\n"), "0.3.0-beta.1");
  assert.strictEqual(parseVersion("something else 1.0\n"), undefined);
  assert.strictEqual(parseVersion(""), undefined);
});

test("a toolchain without prismio-lsp is recognised from what `prismio lsp` printed", () => {
  const stderr = "error[P1099]: the language server is not installed: no /opt/prismio/bin/prismio-lsp\n  note: `prismio build` in a checkout, or an installed toolchain, provides it\n";
  const message = missingServerMessage(stderr);
  assert.match(message, /not installed/);
  assert.match(message, /installed toolchain, provides it/);
  assert.strictEqual(missingServerMessage("error[P1039]: unknown command `lsp`\n"), undefined);
  assert.strictEqual(missingServerMessage(""), undefined);
});

test("project names follow umsValidName", () => {
  for (const ok of ["app", "my-app", "a.b", "_x", "9lives", "App_2"]) { assert.strictEqual(validProjectName(ok), undefined, ok); }
  for (const bad of ["", "bad name", "-x", ".x", "a/b", "ü"]) { assert.ok(validProjectName(bad), bad); }
});

test("the status text names the toolchain version and the server state", () => {
  assert.strictEqual(statusText("running", "0.2.0"), "$(check) Prismio 0.2.0");
  assert.strictEqual(statusText("no-server", "0.2.0"), "$(warning) Prismio 0.2.0");
  assert.strictEqual(statusText("starting", undefined), "$(sync~spin) Prismio");
});
