# Changelog

What changes in the Prismio extension for VS Code. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-11

First release. The extension is a client of the toolchain's own language server, `prismio lsp`: everything that has
to understand the language is answered by the compiler you point it at, so the editor and the build cannot disagree.
It needs VS Code 1.100 or newer and a Prismio toolchain that ships `prismio-lsp` (0.2.0).

### Language features, from the server

- **Diagnostics as you type**, with the unsaved buffers of every open file, each file checked as part of the program
  it belongs to; and the compiler's own `UMS####` diagnostics for `build.ums`.
- **Completion**: members after a `.`, names in scope, type names, modules on an `import` line, library functions
  that are not imported yet (accepting one adds the `import`), and blocks and keys in `build.ums`.
- **Hover** with the signature and documentation comment, also for the standard library; **signature help** that
  follows the argument you are on; **inlay hints** for the type of a `let` and the parameter names at a call.
- **Navigation**: go to definition (into the standard library's source too), go to type definition, find
  references, document highlights, the outline and workspace symbols.
- **Rename**, and the **add-import quick fix** for a name whose module is already in the program.
- **Semantic highlighting** and **folding**.
- **Formatting** with `prismio fmt`, for the document or a range, the same rules as the command line.

### In the extension

- A TextMate grammar generated from the compiler's token tables (`prismio dump-tokens`), so `.psm` files are
  highlighted before the server answers and without a toolchain. Nested block comments and `///` / `/** */`
  documentation comments are their own scopes.
- **`build.ums` highlighting**: comments, blocks, keys, calls, strings with `${NAME}` and `$$`, `const` and `enum`.
- **Snippets** for `main`, `fn`, `struct`, `enum`, `codeset`, `impl`, `if`/`else`, `while`, `for`, a range `for`,
  `match`, `let`, `let mut`, `println` and `extern`; a test compiles every one with `prismio check`.
- **Run and Debug from `build.ums`**: tasks for build, test, each executable target and every `command` the manifest
  declares; **Run** and **Debug** code lenses above `fn main` and above each runnable target and command; **Prismio:
  Build and Debug a Target** starts CodeLLDB (or `cppdbg` with LLDB) on the debug build. Library and test targets are
  not offered as runnable. Every folder of a multi-root workspace gets its own.
- **Problem matchers** `$prismio` and `$prismio-ums` turn the errors `prismio build` prints into links.
- **Prismio: New Project** writes what `prismio init` writes in a folder you pick and opens it.
- A **status bar item** with the toolchain's version and the server's state; clicking it shows the Prismio output.
  A toolchain without `prismio-lsp` is named as the problem.
- **Prismio: Restart Language Server**; changing `prismio.path` restarts it, and `prismio.trace.server` applies to
  the running server.
- Editor defaults for Prismio files: 4-space indentation and `prismio fmt` as the formatter. Enter continues a `///`
  line and the ` * ` lines of a `/** */` comment.
- The Prismio logo on `.psm` files and the manifest's mark on `build.ums`.

### Tested

37 end-to-end checks in real VS Code against the 0.2.0 toolchain, run from the source tree and from the packaged
`.vsix`, plus 34 unit, grammar, snippet, packaging and problem-matcher tests.

### Known issues

- The add-import quick fix is offered only when the module is already in the program; for a library function no file
  imports yet, accept it from completion instead, which adds the import. The diagnostic in that case can name an
  internal symbol (`println$pack$Int`). Both are the language server's.
- Type names are not completed inside a parameter list that is not closed yet, or in a struct written on one line.
