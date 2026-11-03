# Changelog

## Unreleased

- **Logos.** The extension has an icon (`images/icon.png`, 128 px, the Prismio logo), and `.psm` and `build.ums` files have file icons (`images/psm.png`, `images/ums.svg`, each language's `icon`), shown by the default file icon theme in the explorer and on tabs. `test/grammar.test.mjs` checks that they exist, are referenced and ship in the `.vsix`.
- End-to-end checks for a definition into the standard library (the source the server writes out of a `.plib`) and for find references: 11 checks in VS Code 1.143 against the compiler's language server of 2026-10-29. Nothing in the extension changed; the server did.

## 0.1.0

First release: a client of `prismio lsp`, a generated TextMate grammar, language configuration,
tasks and a debug entry from `build.ums`.
