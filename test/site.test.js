// Static checks that the page, its scripts and the Pages build stay consistent with each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

// Local files index.html points at (data: and absolute URLs contain ":" and are skipped).
const pageAssets = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);

// Every module reachable from an entry file through relative static imports.
function moduleGraph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(join(root, entry), 'utf8');
  for (const [, spec] of source.matchAll(/from '(\.[^']+)'/g)) moduleGraph(join(dirname(entry), spec), seen);
  return seen;
}
const siteFiles = [...new Set(['index.html', ...pageAssets, ...moduleGraph('src/app.js')])];

test('every element id app.js looks up exists exactly once in index.html', () => {
  const app = readFileSync(join(root, 'src/app.js'), 'utf8');
  const ids = [...app.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 9, 'expected to find the getElementById calls');
  for (const id of ids) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `id="${id}"`);
  }
});

test('index.html keeps its CSP, declares an icon and loads only local files', () => {
  assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'self'/);
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.equal(/(?:href|src)="(?:https?:)?\/\//.test(html), false);
  assert.ok(siteFiles.length >= 6);
  for (const file of siteFiles) assert.ok(existsSync(join(root, file)), file);
});

test('the Pages build contains every file the page needs', () => {
  const out = mkdtempSync(join(tmpdir(), 'md-resume-site-'));
  try {
    const res = spawnSync(process.execPath, [join(root, 'scripts', 'build-site.js'), out], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    for (const file of siteFiles) assert.ok(existsSync(join(out, file)), `missing from build: ${file}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
