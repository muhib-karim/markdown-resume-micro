// Zero-dependency lint: syntax of every JS file, text hygiene and project invariants.
// Usage: node scripts/lint.js [repoRoot]   (works on Node >= 18)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const SELF = join('scripts', 'lint.js');
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.yml', '.yaml', '.md', '.svg']);
const TEXT_DOTFILES = new Set(['.gitignore', '.gitattributes', '.editorconfig']);
// Control, zero-width and bidirectional-override characters have no place in source text:
// they are invisible in review ("Trojan Source"). Write them as escapes instead.
const INVISIBLE = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{7F}\u{AD}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}\u{FFFD}]/u;
const BANNED = [
  [/\bdebugger\b/, 'debugger statement'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bdocument\.write\s*\(/, 'document.write()'],
];

const problems = [];
const report = (file, line, message) => {
  problems.push(`${relative(root, file)}${line ? `:${line}` : ''}  ${message}`);
};

// Paths git ignores are build output, not source: skip what .gitignore lists (plain entries only).
const ignored = existsSync(join(root, '.gitignore'))
  ? readFileSync(join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
const ignoredDirs = new Set(['.git', ...ignored.filter((l) => l.endsWith('/')).map((l) => l.slice(0, -1))]);
const ignoredFiles = new Set(ignored.filter((l) => !l.endsWith('/')));
const isIgnored = (file) => {
  const rel = relative(root, file).split(sep).join('/');
  return ignoredFiles.has(rel) || ignoredFiles.has(basename(file));
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ignoredDirs.has(entry.name) ? [] : walk(path);
    return entry.isFile() && !isIgnored(path) ? [path] : [];
  });
}

const files = walk(root).filter((file) => TEXT_EXTENSIONS.has(extname(file)) || TEXT_DOTFILES.has(basename(file)));

// 1-3. Syntax, hygiene and banned constructs, file by file.
for (const file of files) {
  const ext = extname(file);
  const text = readFileSync(file, 'utf8');
  const isJs = ['.js', '.mjs', '.cjs'].includes(ext);

  if (isJs) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status !== 0) {
      const reason = res.stderr.split('\n').find((line) => line.includes('SyntaxError')) ?? 'node --check failed';
      report(file, 0, `syntax error: ${reason.trim()}`);
    }
  }
  if (ext === '.json') {
    try {
      JSON.parse(text);
    } catch (err) {
      report(file, 0, `invalid JSON: ${err.message}`);
    }
  }
  if (text.includes('\r')) report(file, 0, 'CRLF line endings (use LF)');
  if (text.length > 0 && !text.endsWith('\n')) report(file, 0, 'missing final newline');

  text.split('\n').forEach((line, index) => {
    const n = index + 1;
    if (ext !== '.md' && /[ \t]+$/.test(line)) report(file, n, 'trailing whitespace');
    if (line.includes('\t')) report(file, n, 'tab character (indent with spaces)');
    if (INVISIBLE.test(line)) report(file, n, 'invisible or bidirectional control character (write it as an escape)');
    if (isJs && !file.endsWith(SELF)) {
      for (const [pattern, name] of BANNED) if (pattern.test(line)) report(file, n, `${name} is not allowed`);
    }
  });
}

// 4. The project has no dependencies, and that is a feature.
const pkgFile = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  if (pkg[field] && Object.keys(pkg[field]).length > 0) report(pkgFile, 0, `"${field}" must stay empty (zero-dependency project)`);
}
for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) {
  if (existsSync(join(root, lock))) report(join(root, lock), 0, 'lockfile in a zero-dependency project');
}

// 5. Third-party actions must be pinned to a full commit SHA, not a movable tag.
const workflowDir = join(root, '.github', 'workflows');
for (const file of files.filter((f) => f.startsWith(workflowDir + sep))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    const uses = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
    if (uses && !uses[1].startsWith('./') && !/@[0-9a-f]{40}$/.test(uses[1])) {
      report(file, index + 1, `action is not pinned to a commit SHA: ${uses[1]}`);
    }
  });
}

// 6. Relative links and images in the README must point at files that exist.
const readme = join(root, 'README.md');
if (existsSync(readme)) {
  const prose = readFileSync(readme, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const targets = [...prose.matchAll(/\]\(([^)\s]+)\)/g), ...prose.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const target of targets) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue; // absolute URL or in-page anchor
    if (!existsSync(join(root, target.split('#')[0]))) report(readme, 0, `broken relative link: ${target}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\nlint: ${problems.length} problem(s) in ${files.length} files`);
  process.exit(1);
}
console.log(`lint: ${files.length} files clean`);
