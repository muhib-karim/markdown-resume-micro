// Copies the static site into _site/ for GitHub Pages. No bundling needed.
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const entries = ['index.html', 'styles', 'src', 'examples/resume.md'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of entries) {
  await cp(join(root, entry), join(out, entry), { recursive: true });
}
await cp(join(root, 'docs', 'banner.svg'), join(out, 'banner.svg'));
console.log(`Built static site in ${out}`);
