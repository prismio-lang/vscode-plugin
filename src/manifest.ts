// What build.ums declares that the editor offers to run: its targets and its commands, with the line each
// is declared on. A scan of lines, not a parse: the manifest's own checker is the toolchain's (the server
// publishes its UMS#### diagnostics), and a wrong guess here only offers one task too many or too few.
// Nothing in this file touches the editor, so a unit test can load it.

export type TargetKind = "executable" | "library" | "test";

export interface Target {
    kind: TargetKind;
    name: string;
    entry?: string;
    line: number
}

export interface Command {
    name: string;
    line: number
}

export interface Manifest {
    targets: Target[];
    commands: Command[]
}

// `ums/model/lowering.psm` lowerTarget knows these three kinds and no others.
const KINDS = new Set<string>(["executable", "library", "test"]);

// A line without its comment, and the same line with its strings blanked as well, so that braces and quotes
// inside a string do not count as structure.
function scan(line: string): { text: string; masked: string } {
    let text = "";
    let masked = "";
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inString) {
            if (c === "\\" && i + 1 < line.length) {
                text += c + line[i + 1];
                masked += "  ";
                i++;
                continue;
            }
            if (c === "\"") {
                inString = false;
                masked += c;
            } else {
                masked += " ";
            }
            text += c;
            continue;
        }
        if (c === "\"") {
            inString = true;
            text += c;
            masked += c;
            continue;
        }
        if (c === "#" || (c === "/" && line[i + 1] === "/")) {
            break;
        }
        text += c;
        masked += c;
    }
    return {text, masked};
}

const isTarget = (item: unknown): item is Target => typeof item === "object" && item !== null && "kind" in item;

export function parseManifest(text: string): Manifest {
    const targets: Target[] = [];
    const commands: Command[] = [];
    // One entry per open brace: the name of the block, or the target or command it declares.
    const open: (string | Target | Command)[] = [];
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        const {text: line, masked} = scan(lines[index]);
        let declared: Target | Command | undefined;
        const declaration = /^\s*([A-Za-z_][\w-]*)\s*\(\s*"((?:[^"\\]|\\.)*)"/.exec(line);
        if (declaration && masked.includes("{")) {
            if (open.length === 1 && open[0] === "targets" && KINDS.has(declaration[1])) {
                declared = {kind: declaration[1] as TargetKind, name: declaration[2], line: index};
                targets.push(declared);
            } else if (open.length === 1 && open[0] === "commands" && declaration[1] === "command") {
                declared = {name: declaration[2], line: index};
                commands.push(declared);
            }
        }
        // `entry = "..."` directly inside a target's block, or on the line that opens it.
        const entry = /\bentry\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
        const owner = declared ?? (open.length === 2 ? open[1] : undefined);
        if (entry && isTarget(owner)) {
            owner.entry = entry[1];
        }
        for (let i = 0; i < masked.length; i++) {
            if (masked[i] === "{") {
                open.push(declared ?? /([A-Za-z_][\w-]*)\s*$/.exec(masked.slice(0, i))?.[1] ?? "");
                declared = undefined;
            } else if (masked[i] === "}") {
                open.pop();
            }
        }
    }
    return {targets, commands};
}

// What `prismio run <target>` can run.
export const runnable = (targets: Target[]): Target[] => targets.filter((t) => t.kind === "executable");
