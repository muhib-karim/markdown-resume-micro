import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  sanitizeUrl,
  renderInline,
  markdownToHtml,
  buildStandaloneHtml,
  extractTitle,
  slugify,
  toFilename,
} from '../src/markdown.js';
import { SAMPLE_RESUME } from '../src/sample.js';

test('escapeHtml escapes all special characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('headings h1-h3 get ids', () => {
  assert.equal(markdownToHtml('# Jane Doe'), '<h1 id="jane-doe">Jane Doe</h1>');
  assert.equal(markdownToHtml('## Work Experience'), '<h2 id="work-experience">Work Experience</h2>');
  assert.equal(markdownToHtml('### Role'), '<h3 id="role">Role</h3>');
});

test('heading requires a space after #', () => {
  assert.equal(markdownToHtml('#hashtag'), '<p>#hashtag</p>');
});

test('bold, italic, strike and code inline formatting', () => {
  assert.equal(renderInline('**bold**'), '<strong>bold</strong>');
  assert.equal(renderInline('__bold__'), '<strong>bold</strong>');
  assert.equal(renderInline('*it*'), '<em>it</em>');
  assert.equal(renderInline('_it_'), '<em>it</em>');
  assert.equal(renderInline('~~old~~'), '<del>old</del>');
  assert.equal(renderInline('use `a < b`'), 'use <code>a &lt; b</code>');
});

test('code spans are not formatted', () => {
  assert.equal(renderInline('`**x**`'), '<code>**x**</code>');
});

test('underscores inside words are not italic', () => {
  assert.equal(renderInline('snake_case_name'), 'snake_case_name');
});

test('lone asterisks are left alone', () => {
  assert.equal(renderInline('5 * 3 = 15'), '5 * 3 = 15');
});

test('links render with external attributes for http(s)', () => {
  assert.equal(
    renderInline('[GitHub](https://github.com/x)'),
    '<a href="https://github.com/x" target="_blank" rel="noopener noreferrer">GitHub</a>',
  );
  assert.equal(renderInline('[Mail](mailto:a@b.c)'), '<a href="mailto:a@b.c">Mail</a>');
});

test('dangerous link schemes are neutralised', () => {
  assert.equal(renderInline('[x](javascript:alert(1))').includes('javascript'), false);
  assert.equal(sanitizeUrl('javascript:alert(1)'), '#');
  assert.equal(sanitizeUrl(' JaVaScRiPt:alert(1)'), '#');
  assert.equal(sanitizeUrl('java\tscript:alert(1)'), '#');
  assert.equal(sanitizeUrl('data:text/html,<script>'), '#');
  assert.equal(sanitizeUrl('vbscript:x'), '#');
});

test('safe urls are kept', () => {
  for (const url of ['https://a.b', 'http://a.b', 'mailto:a@b', 'tel:+1555', '#top', '/cv.pdf', './cv.pdf', 'cv.pdf']) {
    assert.equal(sanitizeUrl(url), url);
  }
});

test('raw HTML is escaped, not rendered', () => {
  const html = markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('link href cannot break out of attribute', () => {
  const html = renderInline('[x](https://a.b/"onmouseover="alert(1))');
  assert.ok(!html.includes('" onmouseover'));
  assert.ok(!/href="[^"]*"onmouseover/.test(html));
});

test('paragraphs join soft-wrapped lines', () => {
  assert.equal(markdownToHtml('one\ntwo\n\nthree'), '<p>one two</p>\n<p>three</p>');
});

test('hard line breaks with two trailing spaces or backslash', () => {
  assert.equal(markdownToHtml('a  \nb'), '<p>a<br>b</p>');
  assert.equal(markdownToHtml('a\\\nb'), '<p>a<br>b</p>');
});

test('unordered list', () => {
  assert.equal(markdownToHtml('- a\n- b\n* c'), '<ul><li>a</li><li>b</li><li>c</li></ul>');
});

test('ordered list keeps start number', () => {
  assert.equal(markdownToHtml('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(markdownToHtml('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>');
});

test('nested lists', () => {
  assert.equal(
    markdownToHtml('- parent\n  - child\n  - child2\n- next'),
    '<ul><li>parent<ul><li>child</li><li>child2</li></ul></li><li>next</li></ul>',
  );
});

test('list item continuation lines', () => {
  assert.equal(markdownToHtml('- long item\n  continues here'), '<ul><li>long item continues here</li></ul>');
});

test('horizontal rules', () => {
  assert.equal(markdownToHtml('---'), '<hr>');
  assert.equal(markdownToHtml('* * *'), '<hr>');
});

test('blockquote', () => {
  assert.equal(markdownToHtml('> quoted **text**'), '<blockquote><p>quoted <strong>text</strong></p></blockquote>');
});

test('fenced code blocks are escaped verbatim', () => {
  assert.equal(markdownToHtml('```\n<b>x</b>\n# not heading\n```'), '<pre><code>&lt;b&gt;x&lt;/b&gt;\n# not heading</code></pre>');
});

test('unterminated fence does not hang', () => {
  assert.equal(markdownToHtml('```\ncode'), '<pre><code>code</code></pre>');
});

test('CRLF input is handled', () => {
  assert.equal(markdownToHtml('# A\r\n\r\ntext'), '<h1 id="a">A</h1>\n<p>text</p>');
});

test('empty and nullish input', () => {
  assert.equal(markdownToHtml(''), '');
  assert.equal(markdownToHtml(undefined), '');
  assert.equal(markdownToHtml(null), '');
});

test('extractTitle uses first h1 and strips formatting', () => {
  assert.equal(extractTitle('intro\n# **Jane** Doe\n## x'), 'Jane Doe');
  assert.equal(extractTitle('# [Jane](https://x.y)'), 'Jane');
  assert.equal(extractTitle('no heading'), 'Resume');
  assert.equal(extractTitle('## only h2', 'CV'), 'CV');
});

test('slugify and toFilename', () => {
  assert.equal(slugify('Jane Doe!'), 'jane-doe');
  assert.equal(toFilename('Jane Doe', 'pdf'), 'jane-doe.pdf');
  assert.equal(toFilename('!!!', 'html'), 'resume.html');
});

test('buildStandaloneHtml produces a full document with escaped title', () => {
  const doc = buildStandaloneHtml('<p>x</p>', { title: '<Jane>', css: 'p{}', theme: 'modern' });
  assert.ok(doc.startsWith('<!DOCTYPE html>'));
  assert.ok(doc.includes('<title>&lt;Jane&gt;</title>'));
  assert.ok(doc.includes('<style>p{}</style>'));
  assert.ok(doc.includes('<article class="resume theme-modern">\n<p>x</p>\n</article>'));
});

test('sample resume renders expected structure', () => {
  const html = markdownToHtml(SAMPLE_RESUME);
  assert.equal((html.match(/<h1 /g) || []).length, 1);
  assert.ok((html.match(/<h2 /g) || []).length >= 4);
  assert.ok(html.includes('<a href="mailto:jane@example.com">'));
  assert.ok(html.includes('<code>Terraform</code>'));
  assert.equal(extractTitle(SAMPLE_RESUME), 'Jane Doe');
});

test('examples/resume.md matches the in-app sample', async () => {
  const { readFile } = await import('node:fs/promises');
  const file = await readFile(new URL('../examples/resume.md', import.meta.url), 'utf8');
  assert.equal(file, SAMPLE_RESUME);
});
