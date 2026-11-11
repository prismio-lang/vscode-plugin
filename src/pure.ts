// The editor-free pieces: text in, text out. They live apart from the modules that touch VS Code so that a
// unit test can load them (test/pure.test.mjs).

// `prismio 0.2.0` on the first line of `prismio --version`, parsed to `0.2.0`.
export function parseVersion(output: string): string | undefined {
  const match = /^prismio\s+(\S+)/.exec(output.split(/\r?\n/, 1)[0].trim());
  return match ? match[1] : undefined;
}

// `prismio lsp` says `error[P1099]: the language server is not installed` (and a note) when the toolchain has
// no `prismio-lsp`; the message, or undefined when stderr says nothing of the kind.
export function missingServerMessage(stderr: string): string | undefined {
  const match = /error\[P1099\]:[^\n]*(?:\n\s*note:[^\n]*)?/.exec(stderr);
  return match ? match[0] : undefined;
}

// What `umsValidName` accepts: a letter, digit or `_` first, then those plus `-` and `.`.
export function validProjectName(name: string): string | undefined {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)
    ? undefined
    : "A name starts with a letter, a digit or `_`, and may hold those plus `-` and `.`.";
}

export type ServerState = "starting" | "running" | "stopped" | "failed" | "no-toolchain" | "no-server";

export const STATE_ICONS: Record<ServerState, string> = {
  starting: "$(sync~spin)", running: "$(check)", stopped: "$(circle-slash)", failed: "$(error)",
  "no-toolchain": "$(warning)", "no-server": "$(warning)",
};

export const STATE_WORDS: Record<ServerState, string> = {
  starting: "starting", running: "running", stopped: "stopped", failed: "failed to start",
  "no-toolchain": "no toolchain found", "no-server": "this toolchain has no language server",
};

export const statusText = (state: ServerState, version: string | undefined): string =>
  `${STATE_ICONS[state]} Prismio${version ? " " + version : ""}`;
