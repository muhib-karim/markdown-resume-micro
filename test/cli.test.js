import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../bin/md-resume.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin', 'md-resume.js');
const example = join(root, 'examples', 'resume.md');

test('--help prints usage and exits 0', () => {
  const out = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.match(out, /Usage: md-resume/);
});

test('missing input exits with code 2', () => {
  const res = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Missing input file/);
});

test('parseArgs validates theme and options', () => {
  assert.deepEqual(parseArgs(['a.md', '-o', 'b.html', '-t', 'modern']), {
    input: 'a.md', output: 'b.html', theme: 'modern', help: false,
  });
  assert.throws(() => parseArgs(['a.md', '--theme', 'neon']), /Unknown theme/);
  assert.throws(() => parseArgs(['a.md', '--bogus']), /Unknown option/);
});

test('converts example resume to standalone HTML file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-resume-'));
  try {
    const outFile = join(dir, 'out.html');
    execFileSync(process.execPath, [cli, example, '-o', outFile, '--theme', 'compact'], { stdio: 'pipe' });
    const html = readFileSync(outFile, 'utf8');
    assert.match(html, /<title>Jane Doe<\/title>/);
    assert.match(html, /class="resume theme-compact"/);
    assert.match(html, /\.theme-compact/); // stylesheet inlined
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes to stdout without -o', () => {
  const out = execFileSync(process.execPath, [cli, example], { encoding: 'utf8' });
  assert.match(out, /^<!DOCTYPE html>/);
  assert.match(out, /<h1 id="jane-doe">Jane Doe<\/h1>/);
});
