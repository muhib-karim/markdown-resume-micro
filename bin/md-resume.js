#!/usr/bin/env node
// Offline CLI: converts a Markdown resume into a standalone HTML file using the
// same renderer as the web app. Open the result in a browser and print to PDF.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { markdownToHtml, buildStandaloneHtml, extractTitle } from '../src/markdown.js';

const THEMES = ['classic', 'modern', 'compact'];
const USAGE = `Usage: md-resume <input.md> [-o output.html] [--theme ${THEMES.join('|')}]

Converts a Markdown resume to a self-contained HTML file.
Writes to stdout when -o is omitted.

Options:
  -o, --output <file>   Output HTML file
  -t, --theme <name>    Resume theme (default: classic)
  -h, --help            Show this help`;

export function parseArgs(argv) {
  const opts = { input: null, output: null, theme: 'classic', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '-o' || arg === '--output') opts.output = argv[++i];
    else if (arg === '-t' || arg === '--theme') opts.theme = argv[++i];
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (!opts.input) opts.input = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!THEMES.includes(opts.theme)) throw new Error(`Unknown theme: ${opts.theme}`);
  if (!opts.help && !opts.input) throw new Error('Missing input file');
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
