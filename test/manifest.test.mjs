// What the extension reads out of build.ums to offer tasks, lenses and the debug entry. Loads the compiled
// module (run `npm run compile` first; `npm test` does).
import assert from "node:assert";
import { test } from "node:test";
import { parseManifest, runnable } from "../out/src/manifest.js";

const MANIFEST = `project {
    name = "demo"
    version = "0.1.0"
    prismio = "0.2.0"
}

# executable("commented") { }
targets {
    executable("app") {
        entry = "src/main.psm"
        native {
            source("c/codec.c")
        }
    }
    library("core") {
        entry = "src/core.psm"
    }
    test("unit") {
        entry = "tests/unit.psm"
    }
    kernel("boot") {
        entry = "boot.psm"
    }
    executable("tiny") { entry = "tiny.psm" }
}

commands {
    command("dist") {
        description = "braces { in a string }"
        run("tools/package.py", args)
    }
    command("lint") { shell("echo") }
}
`;

test("targets keep their kind, entry and line; kernel is not a target kind", () => {
  const { targets } = parseManifest(MANIFEST);
  assert.deepStrictEqual(targets.map((t) => [t.kind, t.name, t.entry, t.line]), [
    ["executable", "app", "src/main.psm", 8],
    ["library", "core", "src/core.psm", 14],
    ["test", "unit", "tests/unit.psm", 17],
    ["executable", "tiny", "tiny.psm", 23],
  ]);
});

test("only an executable can run or be debugged", () => {
  assert.deepStrictEqual(runnable(parseManifest(MANIFEST).targets).map((t) => t.name), ["app", "tiny"]);
});

test("commands are found, a brace in a string or a comment does not confuse the scan", () => {
  const { commands, targets } = parseManifest(MANIFEST);
  assert.deepStrictEqual(commands.map((c) => [c.name, c.line]), [["dist", 27], ["lint", 31]]);
  assert.ok(!targets.some((t) => t.name === "commented"));
});

test("a declaration outside targets or commands is not a target", () => {
  const { targets, commands } = parseManifest(`dependencies {\n    executable("x") { }\n}\ncommands {\n    executable("y") { }\n}\n`);
  assert.deepStrictEqual([targets, commands], [[], []]);
});

test("an empty or broken manifest gives nothing and does not throw", () => {
  assert.deepStrictEqual(parseManifest(""), { targets: [], commands: [] });
  assert.doesNotThrow(() => parseManifest("targets {\n  executable(\"a\" {\n"));
});
