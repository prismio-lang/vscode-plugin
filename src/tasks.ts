// The tasks and the debug entry that build.ums declares. A task is `prismio <command> [target]` run in the
// folder that holds the manifest; the editor's CodeLenses and the command palette start the same tasks.
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {Manifest, parseManifest, runnable} from "./manifest";
import {prismioPath} from "./toolchain";

export interface PrismioTaskDefinition extends vscode.TaskDefinition {
    command: string;
    target?: string;
    release?: boolean
}

// `$prismio` reads a compiler diagnostic (two lines: the message, then ` --> file:line:col`); `$prismio-ums`
// reads a manifest error (one line: `build.ums:7:5: error[UMS2104]: ...`).
const MATCHERS = ["$prismio", "$prismio-ums"];

export function readManifest(folder: vscode.WorkspaceFolder): Manifest | undefined {
    try {
        return parseManifest(fs.readFileSync(path.join(folder.uri.fsPath, "build.ums"), "utf8"));
    } catch {
        return undefined;
    }
}

export function makeTask(folder: vscode.WorkspaceFolder, def: PrismioTaskDefinition, prismio: string): vscode.Task {
    const args = [def.command];
    if (def.release === true) {
        args.push("--release");
    }
    if (def.target) {
        args.push(def.target);
    }
    const task = new vscode.Task(def, folder, `${def.command}${def.target ? " " + def.target : ""}`, "prismio",
        new vscode.ProcessExecution(prismio, args, {cwd: folder.uri.fsPath}), MATCHERS);
    if (def.command === "build") {
        task.group = vscode.TaskGroup.Build;
    }
    if (def.command === "test") {
        task.group = vscode.TaskGroup.Test;
    }
    return task;
}

// The tasks a manifest offers: build; test when a test target exists; run for each executable (a library
// cannot run); and each command the manifest declares.
export function tasksFor(folder: vscode.WorkspaceFolder, manifest: Manifest, prismio: string): vscode.Task[] {
    const tasks = [makeTask(folder, {type: "prismio", command: "build"}, prismio)];
    if (manifest.targets.some((t) => t.kind === "test")) {
        tasks.push(makeTask(folder, {type: "prismio", command: "test"}, prismio));
    }
    for (const target of runnable(manifest.targets)) {
        tasks.push(makeTask(folder, {type: "prismio", command: "run", target: target.name}, prismio));
    }
    for (const command of manifest.commands) {
        tasks.push(makeTask(folder, {type: "prismio", command: command.name}, prismio));
    }
    return tasks;
}

export const taskProvider: vscode.TaskProvider = {
    provideTasks(): vscode.Task[] {
        const prismio = prismioPath();
        const tasks: vscode.Task[] = [];
        if (prismio === undefined) {
            return tasks;
        }
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const manifest = readManifest(folder);
            if (manifest) {
                tasks.push(...tasksFor(folder, manifest, prismio));
            }
        }
        return tasks;
    },
    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const prismio = prismioPath();
        // The folder the task belongs to, not the first one open.
        const folder = typeof task.scope === "object" && "uri" in task.scope ? task.scope : vscode.workspace.workspaceFolders?.[0];
        const def = task.definition as PrismioTaskDefinition;
        return prismio && folder && def.command ? makeTask(folder, def, prismio) : undefined;
    },
};

export function folderOfUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
}

// The folder a command acts on: the one given (a CodeLens knows its file), else the only folder with a
// manifest, else the user's choice.
async function chooseFolder(given?: vscode.WorkspaceFolder): Promise<vscode.WorkspaceFolder | undefined> {
    if (given) {
        return given;
    }
    const withManifest = (vscode.workspace.workspaceFolders ?? []).filter((f) => readManifest(f) !== undefined);
    if (withManifest.length <= 1) {
        return withManifest[0];
    }
    const picked = await vscode.window.showQuickPick(withManifest.map((f) => ({
        label: f.name,
        folder: f
    })), {placeHolder: "Project folder"});
    return picked?.folder;
}

export async function runTask(folder: vscode.WorkspaceFolder, def: PrismioTaskDefinition): Promise<void> {
    const prismio = prismioPath();
    if (!prismio) {
        void vscode.window.showErrorMessage("Prismio: no `prismio` found. Install the toolchain, or set `prismio.path`.");
        return;
    }
    await vscode.tasks.executeTask(makeTask(folder, def, prismio));
}

// Builds a target in the debug profile (which carries DWARF) and starts the debugger the user has. Only an
// executable can be debugged.
export async function debugTarget(givenFolder?: vscode.WorkspaceFolder, givenTarget?: string): Promise<void> {
    const folder = await chooseFolder(givenFolder);
    const prismio = prismioPath();
    if (!folder || !prismio) {
        void vscode.window.showErrorMessage("Prismio: open a project folder with a build.ums.");
        return;
    }
    const targets = runnable(readManifest(folder)?.targets ?? []).map((t) => t.name);
    const target = givenTarget ?? (targets.length <= 1 ? targets[0] : await vscode.window.showQuickPick(targets, {placeHolder: "Target to debug"}));
    if (!target) {
        void vscode.window.showErrorMessage("Prismio: build.ums declares no executable target.");
        return;
    }
    const build = makeTask(folder, {type: "prismio", command: "build", target}, prismio);
    const done = new Promise<number>((resolve) => {
        const listener = vscode.tasks.onDidEndTaskProcess((e) => {
            if (e.execution.task === build) {
                listener.dispose();
                resolve(e.exitCode ?? 1);
            }
        });
    });
    await vscode.tasks.executeTask(build);
    if ((await done) !== 0) {
        return;
    }
    const type = vscode.extensions.getExtension("vadimcn.vscode-lldb") ? "lldb" : "cppdbg";
    await vscode.debug.startDebugging(folder, {
        type, request: "launch", name: `Prismio: ${target}`,
        program: path.join(folder.uri.fsPath, ".prismio", "build", "debug", process.platform === "win32" ? `${target}.exe` : target),
        args: [], cwd: folder.uri.fsPath, ...(type === "cppdbg" ? {MIMode: "lldb"} : {}),
    });
}
