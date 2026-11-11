// Prismio: New Project. The files are `prismio init`'s own (build.ums, src/main.psm, .gitignore), so the
// editor, the command line and the JetBrains wizard write the same project; this only asks where and what.
import {execFile} from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import {validProjectName} from "./pure";
import {hostedEnv, prismioPath} from "./toolchain";

// Runs `prismio init <name>` in `parent` and returns the new project's folder.
export function initProject(prismio: string, parent: string, name: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(prismio, ["init", name], {cwd: parent, env: hostedEnv(), timeout: 30000}, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${stderr}${stdout}`.trim() || String(error)));
            } else {
                resolve(path.join(parent, name));
            }
        });
    });
}

export async function newProject(): Promise<void> {
    const prismio = prismioPath();
    if (!prismio) {
        void vscode.window.showErrorMessage("Prismio: no `prismio` found. Install the toolchain, or set `prismio.path`.");
        return;
    }
    const parent = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Select Folder for the Project",
        title: "Prismio: New Project: the folder that will hold it",
    });
    if (!parent || parent.length === 0) {
        return;
    }
    const name = await vscode.window.showInputBox({
        prompt: "Project name",
        value: "app",
        validateInput: validProjectName
    });
    if (!name) {
        return;
    }
    try {
        const folder = await initProject(prismio, parent[0].fsPath, name);
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folder), {forceNewWindow: false});
    } catch (error) {
        void vscode.window.showErrorMessage(`Prismio: ${String(error instanceof Error ? error.message : error)}`);
    }
}
