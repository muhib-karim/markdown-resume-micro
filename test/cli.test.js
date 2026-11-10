import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// Regression tests: each of these failed before the fix it guards, except the
// exit-code test, which pins behaviour that was already right but untested.
// ---------------------------------------------------------------------------

const run = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'md-resume-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('runs when started through a symlink, as the package "bin" does', { skip: process.platform === 'win32' }, () => {
  withTempDir((dir) => {
    const link = join(dir, 'md-resume');
    symlinkSync(cli, link);
    const help = run([link, '--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: md-resume/);
    assert.match(run([link, example]).stdout, /^<!DOCTYPE html>/);
  });
});

test('runs when the entry point is given without its extension', () => {
  const res = run([cli.replace(/\.js$/, ''), '--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage: md-resume/);
});

test('options that need a value reject a missing one', () => {
  assert.throws(() => parseArgs(['a.md', '-o']), /Option -o requires a value/);
  assert.throws(() => parseArgs(['a.md', '--theme']), /Option --theme requires a value/);
  assert.throws(() => parseArgs(['a.md', '-o', '-t', 'modern']), /Option -o requires a value/);
  assert.throws(() => parseArgs(['a.md', '--output=']), /Option --output requires a value/);
  const res = run([cli, example, '-o']);
  assert.equal(res.status, 2);
  assert.equal(res.stdout, '');
});

test('--option=value and -- are accepted', () => {
  assert.deepEqual(parseArgs(['--theme=modern', '--output=b.html', 'a.md']), {
    input: 'a.md', output: 'b.html', theme: 'modern', help: false,
  });
  assert.equal(parseArgs(['--', '-odd-name.md']).input, '-odd-name.md');
});

test('--help wins over other validation', () => {
  assert.equal(parseArgs(['--help', '--theme', 'neon']).help, true);
  assert.equal(run([cli, '--help', '--theme', 'neon']).status, 0);
});

test('refuses to overwrite the input file', () => {
  withTempDir((dir) => {
    const file = join(dir, 'cv.md');
    writeFileSync(file, '# Jane\n');
    const res = run([cli, file, '-o', file]);
    assert.equal(res.status, 2);
    assert.equal(readFileSync(file, 'utf8'), '# Jane\n');
  });
});

test('runtime failures exit 1 with a one-line message', () => {
  withTempDir((dir) => {
    const res = run([cli, join(dir, 'missing.md'), '-o', join(dir, 'out.html')]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: ENOENT/);
    assert.equal(res.stderr.trim().split('\n').length, 1);
    assert.equal(existsSync(join(dir, 'out.html')), false);
  });
});

test('a BOM-prefixed file still yields its heading and title', () => {
  withTempDir((dir) => {
    const file = join(dir, 'bom.md');
    writeFileSync(file, '\u{FEFF}# Jane Doe\n');
    const { stdout } = run([cli, file]);
    assert.match(stdout, /<title>Jane Doe<\/title>/);
    assert.match(stdout, /<h1 id="jane-doe">Jane Doe<\/h1>/);
  });
});

test('a reader that closes the pipe early is not an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-resume-'));
  try {
    const big = join(dir, 'big.md');
    writeFileSync(big, `# Big\n\n${'- a line of text that is long enough to matter\n'.repeat(20000)}`);
    const child = spawn(process.execPath, [cli, big], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.once('data', () => child.stdout.destroy());
    const code = await new Promise((done) => child.on('close', done));
    assert.equal(code, 0);
    assert.equal(stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
