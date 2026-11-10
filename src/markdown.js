// Minimal, dependency-free Markdown -> HTML converter tuned for resumes.
// Pure functions only (no DOM access) so it can be unit-tested under Node.
//
// Supported syntax:
//   # ... ###### headings, paragraphs, line breaks (two trailing spaces or "\"),
//   **bold**, *italic* / _italic_, ***both***, `code` / ``co`de``, ~~strike~~, [links](url),
//   unordered (-, *, +) and ordered (1.) lists with nesting by indentation,
//   > blockquotes, --- horizontal rules, and fenced ``` code blocks.
// All raw HTML in the input is escaped; link URLs are restricted to safe schemes.

const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.{0,2}\/|[^:]*$)/i;
// The inline regexes are quadratic in the worst case, so the text they run on is bounded:
// a longer paragraph is rendered line by line, any other longer run is escaped but not formatted.
const MAX_INLINE_LENGTH = 4000;
const MAX_QUOTE_DEPTH = 32;
const MAX_FILENAME_LENGTH = 80;
const REPLACEMENT_CHAR = '\u{FFFD}';

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtml(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function sanitizeUrl(url) {
  const trimmed = String(url).trim();
  // Strip control characters and whitespace that browsers ignore inside schemes.
  const normalized = trimmed.replace(/[\u0000-\u001F\u007F\s]+/g, '');
  return SAFE_URL.test(normalized) ? trimmed : '#';
}

// A newline in `text` is rendered as a hard line break (<br>).
export function renderInline(text) {
  // NUL is reserved for the placeholders below; replacing it in the input makes them unforgeable.
  let src = String(text).replace(/\u0000/g, REPLACEMENT_CHAR);
  if (src.length > MAX_INLINE_LENGTH) return escapeHtml(src).replace(/\n/g, '<br>');

  // Generated markup is stashed behind placeholders so later passes only ever see text.
  const stashed = [];
  const stash = (html) => `\u0000${stashed.push(html) - 1}\u0000`;

  // Code spans first so their contents are not formatted: `code` or ``co`de``.
  src = src.replace(/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (_, ticks, code) => {
    const inner = /^ .* $/.test(code) && code.trim() ? code.slice(1, -1) : code;
    return stash(`<code>${escapeHtml(inner)}</code>`);
  });

  src = escapeHtml(src);

  // Links. The URL may contain one level of balanced parentheses.
  src = src.replace(/\[([^\]]+)\]\(((?:[^()\s\u0000]|\([^()\s\u0000]*\))+)\)/g, (_, label, url) => {
    // url was already HTML-escaped; unescape for validation, then re-escape.
    const raw = unescapeHtml(url);
    const external = /^https?:/i.test(raw.trim());
    const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `${stash(`<a href="${escapeHtml(sanitizeUrl(raw))}"${rel}>`)}${label}${stash('</a>')}`;
  });

  src = src
    .replace(/\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/(^|[^\w_])___(?!\s)(.+?)(?<!\s)___(?![\w_])/g, '$1<strong><em>$2</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\n/g, '<br>');

  return src.replace(/\u0000(\d+)\u0000/g, (_, i) => stashed[Number(i)]);
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HEADING_START = /^(#{1,6})\s+/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE_OPEN = /^\s*`{3,}[^`]*$/;
const FENCE_CLOSE = /^\s*`{3,}\s*$/;
const QUOTE = /^\s*>/;

function normalize(markdown) {
  return String(markdown ?? '')
    .replace(/^\u{FEFF}/u, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, REPLACEMENT_CHAR);
}

// Returns { level, text } for an ATX heading line, otherwise null. Written without
// backtracking-prone regexes: this runs on every line of every keystroke.
function parseHeading(line) {
  const m = HEADING_START.exec(line);
  if (!m) return null;
  let text = line.slice(m[0].length).trimEnd();
  // An optional closing sequence ("## Title ##") only counts when preceded by whitespace,
  // so "## C#" keeps its "#".
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  if (end < text.length && (end === 0 || /\s/.test(text[end - 1]))) {
    text = text.slice(0, end).trimEnd();
  }
  return { level: m[1].length, text };
}

function indentWidth(ws) {
  return ws.replace(/\t/g, '    ').length;
}

function renderList(lines, start) {
  // Returns [html, nextIndex]. Handles nesting based on indentation.
  const first = lines[start].match(LIST_ITEM);
  const baseIndent = indentWidth(first[1]);
  const ordered = /\d/.test(first[2]);
  const tag = ordered ? 'ol' : 'ul';
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let i = start;

  while (i < lines.length) {
    if (lines[i].trim() === '') {
      // Blank lines only end the list when what follows is not another item of it.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const next = j < lines.length && !HR.test(lines[j]) ? lines[j].match(LIST_ITEM) : null;
      if (!next || indentWidth(next[1]) < baseIndent) break;
      i = j;
      continue;
    }
    if (HR.test(lines[i])) break;
    const m = lines[i].match(LIST_ITEM);
    if (!m) break;
    const indent = indentWidth(m[1]);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      const [nested, next] = renderList(lines, i);
      if (items.length) items[items.length - 1] += nested;
      else items.push(nested);
      i = next;
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break;
    let content = m[3];
    i += 1;
    // Lazy continuation lines (indented, not a new item or blank).
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !LIST_ITEM.test(lines[i]) &&
      /^\s+/.test(lines[i])
    ) {
      content += ' ' + lines[i].trim();
      i += 1;
    }
    items.push(renderInline(content));
  }

  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const body = items.map((item) => `<li>${item}</li>`).join('');
  return [`<${tag}${startAttr}>${body}</${tag}>`, i];
}

function renderParagraph(paraLines) {
  const parts = paraLines.map((line, idx) => {
    const last = idx === paraLines.length - 1;
    // endsWith, not a regex: / {2,}$/ is quadratic on a long run of spaces inside a line.
    const hardBreak = !last && (line.endsWith('  ') || line.endsWith('\\'));
    const text = (hardBreak && line.endsWith('\\') ? line.slice(0, -1) : line).trim();
    return { text, separator: last ? '' : hardBreak ? '\n' : ' ' };
  });
  const joined = parts.map((part) => part.text + part.separator).join('');
  // Normally the whole paragraph is one inline run, so formatting can span soft-wrapped lines.
  // A very long paragraph is rendered line by line instead, which keeps every run short.
  const html = joined.length <= MAX_INLINE_LENGTH
    ? renderInline(joined)
    : parts.map((part) => renderInline(part.text) + (part.separator === '\n' ? '<br>' : part.separator)).join('');
  return `<p>${html}</p>`;
}

// Only bullets and ordered items numbered 1 may interrupt a paragraph ("in\n2019. Then ..." is prose).
function listInterruptsParagraph(line) {
  const m = line.match(LIST_ITEM);
  return m !== null && (!/\d/.test(m[2]) || parseInt(m[2], 10) === 1);
}

function endsParagraph(line) {
  return (
    line.trim() === '' ||
    HEADING_START.test(line) ||
    HR.test(line) ||
    FENCE_OPEN.test(line) ||
    QUOTE.test(line) ||
    listInterruptsParagraph(line)
  );
}

export function slugify(text) {
  return String(text)
    // Tags and entities go first: compatibility normalisation below can turn look-alikes such as
    // a fullwidth "less-than" into real angle brackets, which must stay ordinary text.
    .replace(/<[^<>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, '')
    .normalize('NFKD')
    .replace(/([A-Za-z])[\u{300}-\u{36F}]+/gu, '$1') // fold accents on Latin letters (e-acute becomes e)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueId(base, ctx) {
  if (!base) return '';
  let n = ctx.counts.get(base) ?? 0;
  let id;
  do {
    n += 1;
    id = n === 1 ? base : `${base}-${n}`;
  } while (ctx.ids.has(id));
  ctx.counts.set(base, n);
  ctx.ids.add(id);
  return id;
}

function newContext() {
  return { ids: new Set(), counts: new Map(), depth: 0, title: '' };
}

function renderBlocks(lines, ctx) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (FENCE_OPEN.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence (or run past end if unterminated)
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      const inner = renderInline(heading.text);
      const id = uniqueId(slugify(inner), ctx);
      const idAttr = id ? ` id="${id}"` : '';
      out.push(`<h${heading.level}${idAttr}>${inner}</h${heading.level}>`);
      if (heading.level === 1 && ctx.depth === 0 && !ctx.title) {
        // Document title: the text content of the first non-empty top-level H1.
        ctx.title = unescapeHtml(inner.replace(/<[^<>]*>/g, '')).trim();
      }
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const [html, next] = renderList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (QUOTE.test(line)) {
      const quote = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      // Beyond the depth cap the remainder is rendered as plain paragraph text instead of recursing.
      const inner = ctx.depth < MAX_QUOTE_DEPTH
        ? renderBlocks(quote, { ...ctx, depth: ctx.depth + 1 })
        : renderParagraph(quote);
      out.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    const para = [line];
    i += 1;
    while (i < lines.length && !endsParagraph(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(renderParagraph(para));
  }

  return out.join('\n');
}

export function markdownToHtml(markdown) {
  return renderBlocks(normalize(markdown).split('\n'), newContext());
}

// Wraps rendered resume HTML in a standalone document for the "Download HTML" export.
export function buildStandaloneHtml(bodyHtml, { title = 'Resume', css = '', theme = 'classic' } = {}) {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // The export needs no scripts or network access at all, so forbid them outright.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>${css}</style>`,
    '</head>',
    '<body class="resume-export">',
    `<article class="resume theme-${escapeHtml(theme)}">`,
    bodyHtml,
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// Uses the first non-empty top-level H1 as the document title (e.g. the candidate's name).
// It runs the block parser itself, so it always agrees with what markdownToHtml renders.
export function extractTitle(markdown, fallback = 'Resume') {
  const ctx = newContext();
  renderBlocks(normalize(markdown).split('\n'), ctx);
  return ctx.title || fallback;
}

export function toFilename(title, ext) {
  // Cut by code point so a surrogate pair is never split.
  const base = [...slugify(title)].slice(0, MAX_FILENAME_LENGTH).join('').replace(/-$/, '') || 'resume';
  return `${base}.${ext}`;
}
