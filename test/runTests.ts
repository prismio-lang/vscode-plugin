// Runs test/suite inside a real VS Code (the installed one by default) with this extension loaded
// and a throwaway copy of the demo project open, so the extension is exercised against the real
// toolchain: `PRISMIO=/path/to/prismio npm test`. `VSCODE_PATH` names another VS Code executable.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const prismio = process.env.PRISMIO;
  if (!prismio) { throw new Error("set PRISMIO to the prismio executable to test against"); }
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prismio-vscode-"));
  const workspace = path.join(root, "demo");
  fs.cpSync(path.join(extensionDevelopmentPath, "test", "fixtures", "demo"), workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, ".vscode"));
  fs.writeFileSync(path.join(workspace, ".vscode", "settings.json"), JSON.stringify({ "prismio.path": prismio }));
  const vscodeExecutablePath = process.env.VSCODE_PATH ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
  try {
    await runTests({
      vscodeExecutablePath: fs.existsSync(vscodeExecutablePath) ? vscodeExecutablePath : undefined,
      extensionDevelopmentPath,
      extensionTestsPath: path.join(__dirname, "suite", "index"),
      extensionTestsEnv: { PRISMIO_INTERNAL_HOSTED: "1" },
      launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", `--user-data-dir=${path.join(root, "user")}`],
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
