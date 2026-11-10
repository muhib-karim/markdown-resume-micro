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

// ---------------------------------------------------------------------------
// Regression tests: each of these failed (or hung) before the fix it guards.
// ---------------------------------------------------------------------------

const md = markdownToHtml;
const EXT = ' target="_blank" rel="noopener noreferrer"';

test('external link followed by _italic_ keeps the link tag intact', () => {
  assert.equal(
    renderInline('[Acme](https://acme.com) _2020 - 2023_'),
    `<a href="https://acme.com"${EXT}>Acme</a> <em>2020 - 2023</em>`,
  );
  assert.equal(
    renderInline('[a](https://a.com) uses my_var_ here'),
    `<a href="https://a.com"${EXT}>a</a> uses my_var_ here`,
  );
});

test('emphasis markers inside a URL never reach the href', () => {
  assert.equal(
    renderInline('[src](https://github.com/u/r/blob/main/pkg/__init__.py)'),
    `<a href="https://github.com/u/r/blob/main/pkg/__init__.py"${EXT}>src</a>`,
  );
  assert.equal(
    renderInline('[a](https://x.com/_a) and [b](https://x.com/b_)'),
    `<a href="https://x.com/_a"${EXT}>a</a> and <a href="https://x.com/b_"${EXT}>b</a>`,
  );
  assert.equal(renderInline('[x](https://x.com/~~a~~)'), `<a href="https://x.com/~~a~~"${EXT}>x</a>`);
});

test('link labels are still formatted', () => {
  assert.equal(
    renderInline('[**bold** and `code`](https://x.com)'),
    `<a href="https://x.com"${EXT}><strong>bold</strong> and <code>code</code></a>`,
  );
  assert.equal(renderInline('*see [site](/cv.pdf)*'), '<em>see <a href="/cv.pdf">site</a></em>');
});

test('*** and ___ render properly nested bold italic', () => {
  assert.equal(renderInline('***bold italic***'), '<strong><em>bold italic</em></strong>');
  assert.equal(renderInline('___bold italic___'), '<strong><em>bold italic</em></strong>');
  assert.equal(renderInline('_a __b___'), '<em>a <strong>b</strong></em>');
});

test('URLs may contain balanced parentheses', () => {
  assert.equal(
    renderInline('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))'),
    `<a href="https://en.wikipedia.org/wiki/Foo_(bar)"${EXT}>Foo</a>`,
  );
  assert.equal(renderInline('([a](https://x.com))'), `(<a href="https://x.com"${EXT}>a</a>)`);
  assert.equal(renderInline('[x](javascript:alert(1))'), '<a href="#">x</a>');
});

test('NUL characters and code spans cannot forge placeholders or become hrefs', () => {
  assert.equal(renderInline('a \u00000\u0000 b `c`'), 'a \u{FFFD}0\u{FFFD} b <code>c</code>');
  assert.equal(renderInline('[x](`javascript:alert(1)`)'), '[x](<code>javascript:alert(1)</code>)');
});

test('multi-backtick code spans', () => {
  assert.equal(renderInline('``a`b``'), '<code>a`b</code>');
  assert.equal(renderInline('`` `x` ``'), '<code>`x`</code>');
  assert.equal(renderInline("it's `unclosed"), 'it&#39;s `unclosed');
});

test('headings keep a trailing # that is part of the text', () => {
  assert.equal(md('## C#'), '<h2 id="c">C#</h2>');
  assert.equal(md('### Languages: C, C++, C#'), '<h3 id="languages-c-c-c">Languages: C, C++, C#</h3>');
  assert.equal(md('## Title ##'), '<h2 id="title">Title</h2>');
  assert.equal(extractTitle('# Jane Doe — C#'), 'Jane Doe — C#');
});

test('headings accept any whitespace after the hashes', () => {
  assert.equal(md('#\u{A0}Jane Doe'), '<h1 id="jane-doe">Jane Doe</h1>');
  assert.equal(md('#\u{3000}张伟'), '<h1 id="张伟">张伟</h1>');
  assert.equal(md('## Skills\u{A0}##'), '<h2 id="skills">Skills</h2>');
  assert.equal(extractTitle('#\u{A0}Jane Doe'), 'Jane Doe');
});

test('duplicate headings get unique ids', () => {
  assert.equal(
    md('### Engineer\n\n### Engineer\n\n### Engineer 2'),
    '<h3 id="engineer">Engineer</h3>\n<h3 id="engineer-2">Engineer</h3>\n<h3 id="engineer-2-2">Engineer 2</h3>',
  );
  assert.equal(md('# A\n\n> # A'), '<h1 id="a">A</h1>\n<blockquote><h1 id="a-2">A</h1></blockquote>');
});

test('non-ASCII names produce usable ids and filenames', () => {
  assert.equal(toFilename('José Álvarez', 'html'), 'jose-alvarez.html');
  assert.equal(toFilename('Zoë Müller-Lüdenscheidt', 'md'), 'zoe-muller-ludenscheidt.md');
  assert.equal(toFilename('张伟', 'md'), '张伟.md');
  assert.equal(toFilename('Сергей Й', 'md'), 'сергей-й.md');
  assert.equal(md('# 张伟'), '<h1 id="张伟">张伟</h1>');
  assert.equal(slugify('Jane - Doe'), 'jane-doe');
  assert.equal(slugify('-x-'), 'x');
  // Fullwidth angle brackets are text, not a tag to strip.
  assert.equal(md('# a \u{FF1C}b **c** d\u{FF1E} e'), '<h1 id="a-b-c-d-e">a \u{FF1C}b <strong>c</strong> d\u{FF1E} e</h1>');
});

test('long titles give a bounded, well-formed filename', () => {
  assert.ok(toFilename('a'.repeat(500), 'html').length <= 85);
  // The cut must not split a surrogate pair.
  assert.equal(toFilename(`${'x'.repeat(79)}\u{20000}y`, 'html'), `${'x'.repeat(79)}\u{20000}.html`);
});

test('a leading byte-order mark is ignored', () => {
  assert.equal(md('\u{FEFF}# Jane Doe'), '<h1 id="jane-doe">Jane Doe</h1>');
  assert.equal(extractTitle('\u{FEFF}# Jane Doe'), 'Jane Doe');
});

test('inline formatting spans soft-wrapped lines', () => {
  assert.equal(md('**bold text that\nwraps** end'), '<p><strong>bold text that wraps</strong> end</p>');
  assert.equal(md('see [my\nsite](https://x.com)'), `<p>see <a href="https://x.com"${EXT}>my site</a></p>`);
  assert.equal(md('*a  \nb*'), '<p>*a<br>b*</p>'); // emphasis does not cross a hard break
  assert.equal(md('C:\\path\\'), '<p>C:\\path\\</p>'); // a trailing backslash on the last line is literal
});

test('a very long paragraph is still formatted, line by line', () => {
  const html = md(Array.from({ length: 130 }, () => `some **bold** text ${'x'.repeat(62)}`).join('\n'));
  assert.equal((html.match(/<strong>bold<\/strong>/g) || []).length, 130);
  assert.equal(md(`${'x'.repeat(4000)}  \n**y**`), `<p>${'x'.repeat(4000)}<br><strong>y</strong></p>`);
});

test('blank lines between items do not split a list', () => {
  assert.equal(md('- a\n\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(md('1. a\n\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(md('- parent\n\n  - child\n- next'), '<ul><li>parent<ul><li>child</li></ul></li><li>next</li></ul>');
  assert.equal(md('- a\n\ntext\n\n- b'), '<ul><li>a</li></ul>\n<p>text</p>\n<ul><li>b</li></ul>');
  assert.equal(md('- a\n\n1. b'), '<ul><li>a</li></ul>\n<ol><li>b</li></ol>');
});

test('a thematic break ends a list', () => {
  assert.equal(md('- a\n* * *\n- b'), '<ul><li>a</li></ul>\n<hr>\n<ul><li>b</li></ul>');
  assert.equal(md('- a\n\n---'), '<ul><li>a</li></ul>\n<hr>');
});

test('only bullets and "1." interrupt a paragraph', () => {
  assert.equal(md('I joined in\n2019. Then left.'), '<p>I joined in 2019. Then left.</p>');
  assert.equal(md('Steps:\n1. one\n2. two'), '<p>Steps:</p>\n<ol><li>one</li><li>two</li></ol>');
  assert.equal(md('Skills:\n- a'), '<p>Skills:</p>\n<ul><li>a</li></ul>');
  assert.equal(md('99999999999999999999999. x'), '<p>99999999999999999999999. x</p>');
});

test('a line that merely starts with an inline ``` span is not a fence', () => {
  assert.equal(md('```x``` is inline\n\nafter'), '<p><code>x</code> is inline</p>\n<p>after</p>');
  assert.equal(md('```js\nlet a;\n```\nafter'), '<pre><code>let a;</code></pre>\n<p>after</p>');
});

test('extractTitle agrees with what the renderer shows as the first H1', () => {
  assert.equal(extractTitle('```\n# not a title\n```\n# Real Name'), 'Real Name');
  assert.equal(extractTitle('- a\n  ```\n# Name'), 'Name');
  assert.equal(extractTitle('> # Quoted\n\n# Top'), 'Top');
  assert.equal(extractTitle('# \n# Second'), 'Second');
  assert.equal(extractTitle('#\nfoo'), 'Resume');
  assert.equal(extractTitle('# Jane_Doe'), 'Jane_Doe');
  assert.equal(extractTitle('# `jd` <jd@x.io> & co'), 'jd <jd@x.io> & co');
});

test('pathological input is bounded: no hang, no stack overflow', () => {
  const started = Date.now();
  md(`# a${' '.repeat(50000)}x`);
  extractTitle(`# a${'\t'.repeat(50000)}x`);
  md(`a${' '.repeat(199996)}x\nb`);
  md(`# ${'\u{FF1C}'.repeat(66000)}`);
  toFilename('<'.repeat(199998), 'html');
  md('# a\n'.repeat(20000));
  assert.equal((md(`${'>'.repeat(50000)} x`).match(/<blockquote>/g) || []).length, 33);
  // Far over the inline cap: must bail out instead of running the regexes.
  for (const unit of ['[', ' _a', '*a ', '`a']) renderInline(unit.repeat(100000));
  // Just under the cap, where the regexes do run: 20 worst-case runs per shape.
  for (const unit of ['__a ', '[', ' _a', '*a ', '`a ', '~~a ']) {
    md(Array.from({ length: 20 }, () => unit.repeat(Math.floor(3999 / unit.length))).join('\n\n'));
  }
  assert.ok(Date.now() - started < 10000, `took ${Date.now() - started} ms`);
});

test('over-long inline runs are escaped, not formatted', () => {
  const long = `<b>${'x'.repeat(4001)}</b> **y**`;
  assert.equal(renderInline(long), `&lt;b&gt;${'x'.repeat(4001)}&lt;/b&gt; **y**`);
});

test('exported document forbids scripts via CSP', () => {
  assert.match(
    buildStandaloneHtml('<p>x</p>'),
    /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'/,
  );
});
