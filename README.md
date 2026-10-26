# Prismio for VS Code

Support for the [Prismio](https://prismio.org) language. The extension is a thin client of the
toolchain's own language server, `prismio lsp`: every feature below is computed by the same compiler
that builds your program, so the editor and the build cannot disagree about the language.

- Diagnostics as you type, with unsaved buffers of every open file, checked as the program they belong to
- Hover (signature, documentation, type), go to definition and type definition, find references,
  document highlights, outline and workspace symbols
- Completion (members after a `.`, names in scope, keywords), signature help, inlay hints for inferred
  types and parameter names
- Semantic highlighting, folding, rename with conflict checks, the "add import" quick fix
- Formatting: `prismio fmt`, for the document or a range
- Tasks and a debug entry from `build.ums`: build, run, test, and every `command` the manifest declares

## Requirements

The Prismio toolchain, with `prismio` on `PATH` or in `~/.prismio/bin`, or its path in the setting
`prismio.path`. The server version is the toolchain's version: to get a newer language, install a newer
toolchain. Without a toolchain the extension still highlights (the grammar is generated from the
compiler's token tables) and says so.

## Settings and commands

| | |
|---|---|
| `prismio.path` | the `prismio` executable; empty searches `PATH`, then `~/.prismio/bin` |
| `prismio.trace.server` | `off`, `messages` or `verbose`: the protocol in the Prismio output channel |
| Prismio: Restart Language Server | after installing a new toolchain |
| Prismio: Build and Debug a Target | builds in the debug profile and starts CodeLLDB (or `cppdbg` with LLDB) |

## Developing it

```bash
npm install
npm run compile
npm run grammar                      # regenerate syntaxes/ from the committed token tables
PRISMIO=/path/to/prismio npm run grammar -- --refresh   # after the compiler's tokens change
PRISMIO=/path/to/prismio npm test    # grammar tests, then the end-to-end suite in a real VS Code
npm run package                      # the .vsix
```

The TextMate grammar is generated from `prismio dump-tokens` and is never edited by hand;
`test/grammar.test.mjs` fails if it is stale. The end-to-end suite starts the installed VS Code with
this extension and a throwaway copy of `test/fixtures/demo`, and asks the editor's own provider
commands (hover, definition, completion, rename, formatting, ...) what they see.
The extension stays small on purpose: logic that wants more than a few hundred lines of TypeScript
belongs in the server (`docs/LSP_PLAN.md` in the compiler repository).
