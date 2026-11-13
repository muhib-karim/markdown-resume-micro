# Contributing

Thanks for taking the time to help. This is a small project with one unusual rule — it has
no dependencies at all — so this guide is short.

## Setup

There is nothing to install.

- **Node.js 22.8 or newer** runs the lint, the unit tests, the CLI and the site build.
- **Chrome or Chromium** additionally runs the headless-browser tests.
- To use the app locally, serve the repository root with any static file server, for example
  `python3 -m http.server 8000`, and open <http://localhost:8000>.

## Before you open a pull request

```bash
npm run lint            # syntax of every JS file, text hygiene, project rules
npm test                # all test suites
npm run test:coverage   # the same suites with the coverage gate
npm run build           # assembles _site/
```

CI runs these on Node 22, 24 and 26, including the coverage gate and the browser tests.

The browser tests in `test/browser.test.js` skip themselves when no Chrome/Chromium binary is
found. Point `CHROME_BIN` at a binary that is not on your `PATH`, and
set `REQUIRE_BROWSER=1` if you want a missing browser to fail the run instead of skipping it.

## Ground rules

- **Zero dependencies.** No runtime, development or build packages, and no lockfile. The lint
  enforces this. If a change seems to need a package, open an issue to discuss it first.
- **Every bug fix comes with a regression test** that fails without the fix. New behaviour comes
  with tests too. Tests use Node's built-in `node:test` runner.
- **The renderer is security-sensitive.** The output of `src/markdown.js` is assigned to
  `innerHTML` and written into exported files. Never emit input that has not been through
  `escapeHtml`, send every URL through `sanitizeUrl`, and keep generated tags behind the
  placeholder mechanism so later passes cannot touch them.
- **Keep the renderer fast on hostile input.** It runs on every keystroke. Avoid regular
  expressions that can backtrack on a long line, and extend the "pathological input" test when
  you add a pattern.
- **Keep `examples/resume.md` and `src/sample.js` identical.** A test compares them byte for byte.
- **No invisible characters in source files.** Write byte-order marks, zero-width characters
  and similar as escapes such as `\u{FEFF}`. The lint rejects the literal characters.
- **GitHub Actions are pinned to commit SHAs** with the version in a trailing comment.
  Dependabot proposes the updates.
- **Style:** two-space indentation, LF line endings, single quotes, semicolons — match the
  surrounding code. `.editorconfig` covers the basics.

## Pull requests

Keep each pull request focused on one thing, and say how you tested it. If the change is
visible in the page, a before/after screenshot helps.

## Security issues

Please do not report vulnerabilities in a public issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is released under the project's
[MIT licence](LICENSE).
