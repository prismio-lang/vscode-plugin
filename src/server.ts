// The language client: starts `prismio lsp`, restarts it, follows the trace setting, and says what state
// it is in (the status bar shows it). One instance for the extension's life, disposed once.
import * as vscode from "vscode";
import {LanguageClient, LanguageClientOptions, ServerOptions, State, Trace} from "vscode-languageclient/node";
import {ServerState} from "./pure";
import {hostedEnv, prismioPath, probeLanguageServer} from "./toolchain";

export type {ServerState};

export function traceOf(setting: string): Trace {
    return setting === "verbose" ? Trace.Verbose : setting === "messages" ? Trace.Messages : Trace.Off;
}

export class Server implements vscode.Disposable {
    state: ServerState = "stopped";
    detail = "";
    private client: LanguageClient | undefined;
    // What one run of the server holds (its state listener, its file watcher): released when that run stops, so
    // restarting again and again leaves nothing behind.
    private run: vscode.Disposable[] = [];
    private level: Trace = Trace.Off;
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;

    constructor(private readonly output: vscode.OutputChannel) {
    }

    // How many things the current run holds; the end-to-end suite checks that a restart does not grow it.
    get held(): number {
        return this.run.length;
    }

    get trace(): string {
        return Trace.toString(this.level);
    }

    private set(state: ServerState, detail = ""): void {
        this.state = state;
        this.detail = detail;
        this.emitter.fire();
    }

    async start(): Promise<void> {
        const prismio = prismioPath();
        if (prismio === undefined) {
            this.set("no-toolchain");
            void vscode.window.showWarningMessage(
                "Prismio: no `prismio` found. Install the toolchain, or set `prismio.path`. Highlighting works without it; nothing else does.");
            return;
        }
        this.set("starting");
        const missing = await probeLanguageServer(prismio);
        if (missing !== undefined) {
            this.output.appendLine(`${prismio}: ${missing}`);
            this.set("no-server", missing);
            void vscode.window.showErrorMessage(
                "Prismio: this toolchain has no language server (`prismio lsp` says it is not installed). Install a complete toolchain, or set `prismio.path`.",
                "Show Output").then((choice) => {
                if (choice) {
                    this.output.show();
                }
            });
            return;
        }
        // PRISMIO_INTERNAL_HOSTED: see toolchain.hostedEnv.
        const serverOptions: ServerOptions = {command: prismio, args: ["lsp"], options: {env: hostedEnv()}};
        const watcher = vscode.workspace.createFileSystemWatcher("**/{*.psm,build.ums}");
        const clientOptions: LanguageClientOptions = {
            // A manifest goes to the server too: it publishes the compiler's UMS#### diagnostics and completes blocks and keys.
            documentSelector: [{scheme: "file", language: "prismio"}, {scheme: "file", language: "ums"}],
            outputChannel: this.output,
            // The server watches build.ums and the .psm files it does not have open.
            synchronize: {fileEvents: watcher},
        };
        const client = new LanguageClient("prismio", "Prismio", serverOptions, clientOptions);
        this.run = [watcher, client.onDidChangeState((e) => {
            if (this.client !== client) {
                return;
            }
            if (e.newState === State.Running) {
                this.set("running");
            } else if (e.newState === State.Starting) {
                this.set("starting");
            } else if (this.state !== "failed") {
                this.set("stopped");
            }
        })];
        this.client = client;
        this.level = traceOf(vscode.workspace.getConfiguration("prismio").get<string>("trace.server", "off"));
        try {
            await client.start();
        } catch (error) {
            this.output.appendLine(`could not start \`${prismio} lsp\`: ${String(error)}`);
            this.set("failed", String(error));
            void vscode.window.showErrorMessage(`Prismio: could not start \`${prismio} lsp\` (see the Prismio output).`);
        }
    }

    // The client reads `prismio.trace.server` once, when it starts; this carries a later change to the running one.
    applyTrace(): void {
        const trace = vscode.workspace.getConfiguration("prismio").get<string>("trace.server", "off");
        this.level = traceOf(trace);
        this.client?.setTrace(this.level).catch((error) => this.output.appendLine(`could not change the trace: ${String(error)}`));
    }

    async stop(): Promise<void> {
        const client = this.client;
        const run = this.run;
        this.client = undefined;
        this.run = [];
        try {
            await client?.stop();
        } catch { /* it was not running */
        }
        run.forEach((d) => d.dispose());
        if (this.state !== "no-toolchain" && this.state !== "no-server") {
            this.set("stopped");
        }
    }

    async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    dispose(): void {
        void this.stop();
        this.emitter.dispose();
    }
}
