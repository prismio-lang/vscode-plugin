// Packages the extension as prismio-vscode-<version>.vsix. The extension is bundled into out/extension.js by
// esbuild (vscode:prepublish), so the package carries no node_modules: vsce cannot list a pnpm node_modules,
// and a bundle is what loads fastest.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = `prismio-vscode-${version}.vsix`;
execFileSync("pnpm", ["exec", "vsce", "package", "--no-dependencies", "--out", out],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
