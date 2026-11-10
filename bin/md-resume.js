#!/usr/bin/env node
// Offline CLI: converts a Markdown resume into a standalone HTML file using the
// same renderer as the web app. Open the result in a browser and print to PDF.
// Exit codes: 0 success, 1 runtime failure (e.g. unreadable file), 2 usage error.
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { markdownToHtml, buildStandaloneHtml, extractTitle } from '../src/markdown.js';

const THEMES = ['classic', 'modern', 'compact'];
const USAGE = `Usage: md-resume <input.md> [-o output.html] [--theme ${THEMES.join('|')}]

Converts a Markdown resume to a self-contained HTML file.
Writes to stdout when -o is omitted.

Options:
  -o, --output <file>   Output HTML file (also --output=<file>)
  -t, --theme <name>    Resume theme (default: classic; also --theme=<name>)
  -h, --help            Show this help
  --                    Treat everything after it as the input file name

Exit codes: 0 success, 1 runtime failure, 2 usage error.`;

export function parseArgs(argv) {
  const opts = { input: null, output: null, theme: 'classic', help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    // Long options may carry their value inline: --output=file.html
    let inline;
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    if (eq !== -1) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const value = () => {
      const v = inline ?? argv[i + 1];
      // A following "-x" is the next option, not a value; use --name=-x for such values.
      if (v === undefined || v === '' || (inline === undefined && v.startsWith('-'))) {
        throw new Error(`Option ${arg} requires a value`);
      }
      if (inline === undefined) i += 1;
      return v;
    };
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '-o' || arg === '--output') opts.output = value();
    else if (arg === '-t' || arg === '--theme') opts.theme = value();
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (opts.help) return opts; // help wins over any other validation
  if (positional.length > 1) throw new Error(`Unexpected argument: ${positional[1]}`);
  opts.input = positional[0] ?? null;
  if (!THEMES.includes(opts.theme)) throw new Error(`Unknown theme: ${opts.theme}`);
  if (!opts.input) throw new Error('Missing input file');
  if (opts.output && resolve(opts.output) === resolve(opts.input)) {
    throw new Error('Output file is the same as the input file; refusing to overwrite it');
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const [markdown, css] = await Promise.all([
    readFile(opts.input, 'utf8'),
    readFile(join(root, 'styles', 'resume.css'), 'utf8'),
  ]);
  const html = buildStandaloneHtml(markdownToHtml(markdown), {
    title: extractTitle(markdown),
    css,
    theme: opts.theme,
  });
  if (opts.output) {
    await writeFile(opts.output, html);
    console.error(`Wrote ${opts.output}`);
  } else {
    process.stdout.write(html);
  }
}

// True when this file is the program being run rather than imported (the tests import it).
// argv[1] is a symlink when the CLI is started through the package "bin" (npm link, npx,
// global install), and Node also accepts the entry point without its extension, so compare
// real paths instead of raw strings.
function isMain() {
  if (!process.argv[1]) return false;
  const self = realpathSync(fileURLToPath(import.meta.url));
  return [process.argv[1], `${process.argv[1]}.js`].some((candidate) => {
    try {
      return realpathSync(candidate) === self;
    } catch {
      return false;
    }
  });
}

if (isMain()) {
  // A reader that closes early (e.g. `md-resume cv.md | head`) is not an error.
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
