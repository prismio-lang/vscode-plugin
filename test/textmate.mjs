// Loads a TextMate grammar from syntaxes/ and tokenizes text the way VS Code does, line by line with the
// state carried across lines, for the grammar tests.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export async function loadGrammar(scopeName, file) {
  const textmate = require("vscode-textmate");
  const oniguruma = require("vscode-oniguruma");
  await oniguruma.loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: (s) => new oniguruma.OnigScanner(s), createOnigString: (s) => new oniguruma.OnigString(s) }),
    loadGrammar: async () => textmate.parseRawGrammar(readFileSync(join(root, "syntaxes", file), "utf8"), file),
  });
  const grammar = await registry.loadGrammar(scopeName);
  // [[text, innermost scope]] for every token of every line of `text`.
  const tokenize = (text) => {
    let state = textmate.INITIAL;
    const lines = [];
    for (const line of text.split("\n")) {
      const result = grammar.tokenizeLine(line, state);
      state = result.ruleStack;
      lines.push(result.tokens.map((t) => [line.slice(t.startIndex, t.endIndex), t.scopes.at(-1), t.scopes]));
    }
    return lines;
  };
  return { grammar, tokenize };
}
