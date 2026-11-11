# Prismio for VS Code

Support for the [Prismio](https://prismio.org) language. The extension is a thin client of the
toolchain's own language server, `prismio lsp`: every feature below is computed by the same compiler
that builds your program, so the editor and the build cannot disagree about the language.

- Diagnostics as you type, with unsaved buffers of every open file, checked as the program they belong to,
  and the compiler's own diagnostics for `build.ums`
- Completion: members after a `.`, names in scope, types, modules on an `import` line, and library
  functions that add their own `import`; blocks and keys in `build.ums`
- Hover (signature and documentation, the standard library's too), signature help, inlay hints for
  inferred types and parameter names
- Go to definition (into the standard library's source) and type definition, find references, document
  highlights, outline and workspace symbols
- Semantic highlighting, folding, rename, the "add import" quick fix
- Formatting: `prismio fmt`, for the document or a range
- Highlighting for `build.ums`, and snippets for the common declarations and statements
- Run and Debug code lenses above `fn main` and each runnable target, and tasks from `build.ums`: build,
  run, test, and every `command` the manifest declares
- **Prismio: New Project**, and a status bar item with the toolchain's version and the server's state
- The Prismio logo on `.psm` files (and the manifest's mark on `build.ums`) in the explorer and on tabs

## Requirements

VS Code 1.100 or newer, and the Prismio toolchain 0.2.0 or newer (it ships `prismio-lsp`), with `prismio` on `PATH` or in `~/.prismio/bin`, or its path in the setting
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
| Prismio: Run an Executable Target | runs one executable target of `build.ums` as a task |
| Prismio: New Project | writes what `prismio init` writes in a folder you pick, and opens it |
| Prismio: Show Server Output | the server's log; also a click on the status bar item |

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
this extension and throwaway copies of `test/fixtures/demo` and `test/fixtures/second` as one workspace, and asks the editor's own provider
commands (hover, definition, completion, rename, formatting, ...) what they see.
The extension stays small on purpose: logic that wants more than a few hundred lines of TypeScript
belongs in the server (`docs/LSP_PLAN.md` in the compiler repository).
