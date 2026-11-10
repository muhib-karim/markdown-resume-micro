# Security policy

## Supported versions

Only the latest commit on `main` is supported. That is also the version served at
<https://muhib-karim.github.io/markdown-resume-micro/>.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**, or go straight to
<https://github.com/muhib-karim/markdown-resume-micro/security/advisories/new>.

If that form is not available to you, open an issue that says only that you have a security
report, with no details, and a private channel will be arranged.

A useful report includes:

- the Markdown input (or CLI command line) that triggers the problem,
- what happens and what you expected instead,
- the browser and version, or the Node.js version for the CLI.

This is a volunteer-maintained project, so there is no guaranteed response time.

## Scope

In scope:

- Markdown that leads to script execution, an unsafe link target, or injected markup in the
  live preview or in an exported HTML file (the renderer in `src/markdown.js`).
- A way around the Content-Security-Policy of the app or of exported files.
- Input that makes the editor or the CLI hang, crash or exhaust memory.
- The CLI reading or writing files other than the ones named on its command line.

Out of scope:

- Anything that requires a compromised browser, a malicious extension or local access to the
  user's machine.
- Content a user types into their own editor: the app has no server and no accounts, and resume
  text never leaves the browser.
- GitHub Pages or GitHub itself.

## How the project limits risk

- All HTML in the Markdown input is escaped; link URLs pass through an allow-list
  (`http`, `https`, `mailto`, `tel`, relative and fragment links).
- The app page sets a Content-Security-Policy that only allows same-origin scripts and styles;
  exported files set one that allows no scripts at all.
- There are no runtime, development or build dependencies.
- GitHub Actions are pinned to commit SHAs and updated through Dependabot.
