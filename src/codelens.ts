// Run and Debug above `fn main` in a target's entry file, and above each runnable target and each command in
// build.ums: the editor's version of the JetBrains gutter buttons. Each lens starts the same task the
// command palette and Terminal > Run Task do.
import * as path from "node:path";
import * as vscode from "vscode";
import {Manifest, parseManifest} from "./manifest";
import {readManifest} from "./tasks";

const MAIN = /^\s*(?:(?:public|private|internal|export|inline|cold|hot)\s+)*fn\s+main\s*\(/;

function lens(line: number, title: string, command: string, ...args: unknown[]): vscode.CodeLens {
    const range = new vscode.Range(line, 0, line, 0);
    return new vscode.CodeLens(range, {title, command, arguments: args});
}

// The lenses of a manifest document: a target that can run, a test target, a command.
export function manifestLenses(manifest: Manifest, folder: string): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (const target of manifest.targets) {
        if (target.kind === "executable") {
            lenses.push(lens(target.line, `$(play) Run ${target.name}`, "prismio.runTarget", folder, target.name),
                lens(target.line, "$(bug) Debug", "prismio.debugTarget", folder, target.name));
        } else if (target.kind === "test") {
            lenses.push(lens(target.line, `$(beaker) Run tests`, "prismio.runTests", folder));
        }
    }
    for (const command of manifest.commands) {
        lenses.push(lens(command.line, `$(play) Run ${command.name}`, "prismio.runManifestCommand", folder, command.name));
    }
    return lenses;
}

export class PrismioCodeLenses implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.emitter.event;
    private readonly subscription = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.path.endsWith("build.ums")) {
            this.emitter.fire();
        }
    });

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!folder) {
            return [];
        }
        // The manifest as the editor has it, so a lens follows an unsaved edit.
        const manifestPath = path.join(folder.uri.fsPath, "build.ums");
        const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === manifestPath);
        const manifest = open ? parseManifest(open.getText()) : readManifest(folder);
        if (!manifest) {
            return [];
        }
        const folderArg = folder.uri.toString();
        if (document.languageId === "ums") {
            return document.uri.fsPath === manifestPath ? manifestLenses(manifest, folderArg) : [];
        }
        const targets = manifest.targets.filter((t) => t.kind === "executable" && t.entry !== undefined
            && path.resolve(folder.uri.fsPath, t.entry) === document.uri.fsPath);
        if (targets.length === 0) {
            return [];
        }
        const lenses: vscode.CodeLens[] = [];
        for (let line = 0; line < document.lineCount; line++) {
            if (!MAIN.test(document.lineAt(line).text)) {
                continue;
            }
            for (const target of targets) {
                lenses.push(lens(line, `$(play) Run ${target.name}`, "prismio.runTarget", folderArg, target.name),
                    lens(line, "$(bug) Debug", "prismio.debugTarget", folderArg, target.name));
            }
        }
        return lenses;
    }

    dispose(): void {
        this.subscription.dispose();
        this.emitter.dispose();
    }
}
