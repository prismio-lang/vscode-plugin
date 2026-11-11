// The status bar item for .psm and build.ums: the toolchain's version and the server's state. Clicking it
// shows the output.
import * as vscode from "vscode";
import {STATE_WORDS, statusText} from "./pure";
import {Server} from "./server";
import {prismioPath, toolchainVersion} from "./toolchain";

export class StatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
    private version: string | undefined;
    private readonly subscriptions: vscode.Disposable[];

    constructor(private readonly server: Server) {
        this.item.name = "Prismio";
        this.item.command = "prismio.showOutput";
        this.subscriptions = [
            server.onDidChange(() => {
                void this.refreshVersion();
                this.render();
            }),
            vscode.window.onDidChangeActiveTextEditor(() => this.render()),
        ];
        void this.refreshVersion();
        this.render();
    }

    private async refreshVersion(): Promise<void> {
        const prismio = prismioPath();
        this.version = prismio ? await toolchainVersion(prismio) : undefined;
        this.render();
    }

    private render(): void {
        this.item.text = statusText(this.server.state, this.version);
        const tooltip = new vscode.MarkdownString(`**Prismio**${this.version ? " " + this.version : ""}: language server ${STATE_WORDS[this.server.state]}`);
        if (this.server.detail) {
            tooltip.appendMarkdown(`\n\n\`${this.server.detail.replace(/`/g, "'")}\``);
        }
        tooltip.appendMarkdown("\n\nClick to show the output.");
        this.item.tooltip = tooltip;
        this.item.backgroundColor = this.server.state === "failed" || this.server.state === "no-server"
            ? new vscode.ThemeColor("statusBarItem.errorBackground")
            : this.server.state === "no-toolchain" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
        const language = vscode.window.activeTextEditor?.document.languageId;
        if (language === "prismio" || language === "ums") {
            this.item.show();
        } else {
            this.item.hide();
        }
    }

    dispose(): void {
        this.subscriptions.forEach((s) => s.dispose());
        this.item.dispose();
    }
}
