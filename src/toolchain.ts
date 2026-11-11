// Finding the toolchain: the `prismio` to run, and what it says about itself.
import {execFile} from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {missingServerMessage, parseVersion} from "./pure";

// The `prismio` to run: the setting, else the first on PATH, else the installer's directory.
export function findPrismio(configured: string, pathVariable = process.env.PATH ?? "", home = os.homedir()): string | undefined {
    if (configured.trim() !== "") {
        return configured.trim();
    }
    const name = process.platform === "win32" ? "prismio.exe" : "prismio";
    const candidates = pathVariable.split(path.delimiter).filter((d) => d !== "").map((d) => path.join(d, name));
    candidates.push(path.join(home, ".prismio", "bin", name));
    return candidates.find((c) => fs.existsSync(c));
}

export function prismioPath(): string | undefined {
    return findPrismio(vscode.workspace.getConfiguration("prismio").get<string>("path", ""));
}

// The toolchain's own environment: inside a project that names its own compiler, a launcher named `prismio`
// hands the command to that project's host, which may be any generation. The editor wants the toolchain it
// was pointed at, whatever folder is open.
export const hostedEnv = (): NodeJS.ProcessEnv => ({...process.env, PRISMIO_INTERNAL_HOSTED: "1"});

export function toolchainVersion(prismio: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        execFile(prismio, ["--version"], {
            env: hostedEnv(),
            timeout: 5000
        }, (error, stdout) => resolve(error ? undefined : parseVersion(stdout)));
    });
}

// Whether the toolchain has a language server: `prismio lsp` with nothing on its input either serves until
// the input ends, or says it is not installed (see missingServerMessage). Asked of the toolchain, not guessed from its layout.
export function probeLanguageServer(prismio: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        const child = execFile(prismio, ["lsp"], {
            env: hostedEnv(),
            timeout: 5000
        }, (_error, _stdout, stderr) => resolve(missingServerMessage(stderr)));
        child.stdin?.end();
    });
}
