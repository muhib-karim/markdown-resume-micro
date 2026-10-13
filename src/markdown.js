// Minimal, dependency-free Markdown -> HTML converter tuned for resumes.
// Pure functions only (no DOM access) so it can be unit-tested under Node.
//
// Supported syntax:
//   # / ## / ### headings, paragraphs, line breaks (two trailing spaces or "\"),
//   **bold**, *italic* / _italic_, `code`, ~~strike~~, [links](url),
//   unordered (-, *, +) and ordered (1.) lists with nesting by indentation,
//   > blockquotes, --- horizontal rules, and fenced ``` code blocks.
// All raw HTML in the input is escaped; link URLs are restricted to safe schemes.

const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.{0,2}\/|[^:]*$)/i;

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url) {
  const trimmed = String(url).trim();
  // Strip control characters and whitespace that browsers ignore inside schemes.
  const normalized = trimmed.replace(/[\u0000-\u001F\u007F\s]+/g, '');
  return SAFE_URL.test(normalized) ? trimmed : '#';
}

export function renderInline(text) {
  // Pull code spans out first so their contents are not formatted.
  const codeSpans = [];
  let src = String(text).replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  src = escapeHtml(src);

  src = src.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    // url was already HTML-escaped; unescape for validation, then re-escape.
    const raw = url
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const safe = escapeHtml(sanitizeUrl(raw));
    const external = /^https?:/i.test(raw.trim());
    const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${safe}"${rel}>${label}</a>`;
  });

  src = src
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');

  return src.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;

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
    const hardBreak = !last && (/ {2,}$/.test(line) || /\\$/.test(line));
    const clean = line.replace(/\\$/, '').trim();
    return renderInline(clean) + (hardBreak ? '<br>' : last ? '' : ' ');
  });
  return `<p>${parts.join('')}</p>`;
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence (or run past end if unterminated)
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      const inner = renderInline(heading[2]);
      const id = slugify(inner);
      const idAttr = id ? ` id="${id}"` : '';
      out.push(`<h${level}${idAttr}>${inner}</h${level}>`);
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

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !/^\s*>/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(renderParagraph(para));
  }

  return out.join('\n');
}

// Wraps rendered resume HTML in a standalone document for the "Download HTML" export.
export function buildStandaloneHtml(bodyHtml, { title = 'Resume', css = '', theme = 'classic' } = {}) {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${css}</style>`,
    '</head>',
    '<body>',
    `<article class="resume theme-${escapeHtml(theme)}">`,
    bodyHtml,
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// Uses the first H1 as the document title (e.g. the candidate's name).
export function extractTitle(markdown, fallback = 'Resume') {
  const match = String(markdown ?? '').match(/^#\s+(.+?)\s*#*\s*$/m);
  if (!match) return fallback;
  const plain = match[1].replace(/[*_`~]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
  return plain || fallback;
}

export function toFilename(title, ext) {
  const base = slugify(title) || 'resume';
  return `${base}.${ext}`;
}
