// End-to-end checks of the real page in headless Chrome/Chromium, using only Node built-ins
// (http server + DevTools protocol over the global WebSocket). Skipped when no browser is
// installed; set REQUIRE_BROWSER=1 to turn that skip into a failure (CI does).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function findBrowser() {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((bin) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0);
}
const browserPath = findBrowser();
const skip = browserPath ? false : 'needs Chrome/Chromium (set CHROME_BIN)';

test('a browser is available when REQUIRE_BROWSER is set', { skip: !process.env.REQUIRE_BROWSER }, () => {
  assert.ok(browserPath, 'REQUIRE_BROWSER is set but no usable browser was found');
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let chrome;
let ws;
let base;
let tmp;
const pending = new Map();
const events = [];
let nextId = 0;

// Sends one DevTools protocol command and resolves with its result.
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  nextId += 1;
  pending.set(nextId, { resolve, reject });
  ws.send(JSON.stringify({ id: nextId, method, params, sessionId }));
});

before(async () => {
  if (skip) return;
  tmp = mkdtempSync(join(tmpdir(), 'md-resume-browser-'));

  // Serves the repository root: the site is static, so no build step is needed.
  server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = join(root, normalize(path));
      if (!file.startsWith(root)) throw new Error('outside root');
      const body = await readFile(file); // read first: a missing file must become a clean 404
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;

  chrome = spawn(browserPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=0',
    `--user-data-dir=${join(tmp, 'profile')}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let log = '';
    chrome.stderr.on('data', (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    chrome.on('exit', (code) => reject(new Error(`browser exited (${code}): ${log.slice(-400)}`)));
  });

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('DevTools connection failed'));
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const waiter = pending.get(msg.id);
    if (waiter) {
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  };
});

after(async () => {
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    // Ask the browser to shut down cleanly (so its helper processes stop touching the profile),
    // fall back to SIGKILL, and only then delete the profile directory.
    const gone = new Promise((resolve) => chrome.once('exit', resolve));
    send('Browser.close').catch(() => {});
    const timer = setTimeout(() => chrome.kill('SIGKILL'), 5000);
    await gone;
    clearTimeout(timer);
  }
  ws?.close();
  server?.closeAllConnections?.();
  server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// Opens a fresh tab on `url` (default: the app with empty storage) and returns helpers bound to it.
async function open(url = base) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  for (const domain of ['Page', 'Runtime', 'Log', 'DOM']) await cdp(`${domain}.enable`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

  const load = async (action) => {
    const mark = events.length;
    await action();
    for (let i = 0; i < 100; i += 1) {
      const loaded = events.slice(mark).some((e) => e.sessionId === sessionId && e.method === 'Page.loadEventFired');
      if (loaded) return sleep(200);
      await sleep(50);
    }
    throw new Error('page load timed out');
  };

  const page = {
    cdp,
    reload: () => load(() => cdp('Page.reload')),
    // Evaluates an expression in the page and returns its (awaited) value.
    async run(expression) {
      const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    // Replaces the editor content the way typing would: sets the value and fires "input".
    type: (markdown) => page.run(`(() => {
      const editor = document.getElementById('editor');
      editor.value = ${JSON.stringify(markdown)};
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    })()`),
    async key(key, code, text) {
      for (const type of text ? ['rawKeyDown', 'char', 'keyUp'] : ['rawKeyDown', 'keyUp']) {
        await cdp('Input.dispatchKeyEvent', {
          type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text,
        });
      }
    },
    problems: () => events.filter((e) => e.sessionId === sessionId).flatMap((e) => {
      if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') return [e.params.entry.text];
      if (e.method === 'Runtime.exceptionThrown') return [e.params.exceptionDetails.text];
      return [];
    }),
    close: () => send('Target.closeTarget', { targetId }),
  };

  await load(() => cdp('Page.navigate', { url }));
  if (url === base) {
    await page.run('localStorage.clear()');
    await page.reload();
  }
  return page;
}

// Page-side hooks that capture downloads and confirm() prompts instead of performing them.
const HOOKS = `
  window.__blobs = [];
  {
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__blobs.push(blob); return make(blob); };
  }
  HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  window.__confirms = [];
  window.__answer = false;
  window.confirm = (message) => { window.__confirms.push(message); return window.__answer; };
`;

// WCAG contrast ratio of two computed "rgb(...)" colours, as page-side source.
const CONTRAST = `(fg, bg) => {
  const lum = (colour) => {
    const [r, g, b] = colour.match(/[\\d.]+/g).slice(0, 3).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}`;

test('loads without console errors or CSP violations', { skip }, async () => {
  const page = await open();
  assert.equal(await page.run(`document.querySelector('#preview h1').textContent`), 'Jane Doe');
  assert.deepEqual(page.problems(), []);
  await page.close();
});

test('every toolbar control is reachable and operable from the keyboard', { skip }, async () => {
  const page = await open();
  const order = [];
  for (let i = 0; i < 8; i += 1) {
    await page.key('Tab', 9);
    order.push(await page.run(`document.activeElement.id || document.activeElement.className`));
  }
  assert.deepEqual(order, [
    'theme', 'load-sample', 'open-md', 'export-md', 'export-html', 'print', 'editor', 'pane preview-pane',
  ]);

  await page.cdp('Page.setInterceptFileChooserDialog', { enabled: true });
  const mark = events.length;
  await page.run(`document.getElementById('open-md').focus()`);
  await page.key('Enter', 13, '\r');
  await sleep(300);
  assert.ok(
    events.slice(mark).some((e) => e.method === 'Page.fileChooserOpened'),
    'Enter on "Open .md" opens the file chooser',
  );
  await page.close();
});

test('button text and the editor focus ring meet WCAG AA contrast', { skip }, async () => {
  const page = await open();
  const { button, ring, offset } = await page.run(`(() => {
    const ratio = ${CONTRAST};
    const primary = getComputedStyle(document.querySelector('button.primary'));
    const editor = document.getElementById('editor');
    editor.focus();
    const focused = getComputedStyle(editor);
    return {
      button: ratio(primary.color, primary.backgroundColor),
      ring: ratio(focused.outlineColor, focused.backgroundColor),
      offset: parseFloat(focused.outlineOffset),
    };
  })()`);
  assert.ok(button >= 4.5, `primary button contrast ${button.toFixed(2)}`);
  assert.ok(ring >= 3, `focus ring contrast ${ring.toFixed(2)}`);
  assert.ok(offset <= 0, 'focus ring is drawn inside the pane so it is not clipped');
  await page.close();
});

test('user content renders intact and cannot pick up the app styles', { skip }, async () => {
  const page = await open();
  await page.type('# Jane Doe\n\n[Acme](https://acme.com) _2020 - 2023_\n\n## Editor\n\n## C#\n');
  const dom = await page.run(`(() => {
    const preview = document.getElementById('preview');
    const [first, second] = preview.querySelectorAll('h2');
    return {
      target: preview.querySelector('a').getAttribute('target'),
      italic: preview.querySelector('p em')?.textContent,
      second: second.textContent,
      sameFont: getComputedStyle(first).fontFamily === getComputedStyle(second).fontFamily,
    };
  })()`);
  assert.deepEqual(dom, { target: '_blank', italic: '2020 - 2023', second: 'C#', sameFont: true });
  await page.close();
});

test('a failed save is reported instead of "Saved locally"', { skip }, async () => {
  const page = await open();
  await page.run(`Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }`);
  await page.type('# Not saved');
  await sleep(600);
  assert.match(await page.run(`document.getElementById('status').textContent`), /^Not saved/);
  await page.close();
});

test('the last edit survives leaving the page immediately', { skip }, async () => {
  const page = await open();
  await page.type('# Typed just before leaving');
  await page.reload();
  assert.equal(await page.run(`document.getElementById('editor').value`), '# Typed just before leaving');
  await page.close();
});

test('Export HTML stays styled when the stylesheet cannot be fetched', { skip }, async () => {
  const page = await open();
  await page.run(HOOKS);
  await page.type('# José Álvarez\n\ntext');
  await page.run(`window.fetch = () => Promise.reject(new TypeError('offline'))`);
  await page.run(`document.getElementById('export-html').click()`);
  await sleep(300);
  const out = await page.run(`window.__blobs.at(-1).text().then((html) => ({
    name: window.__download,
    styled: html.includes('.theme-compact'),
    csp: html.includes("default-src 'none'"),
  }))`);
  assert.deepEqual(out, { name: 'jose-alvarez.html', styled: true, csp: true });
  await page.close();
});

test('Open .md asks before replacing the current content', { skip }, async () => {
  const page = await open();
  const file = join(tmp, 'other.md');
  writeFileSync(file, '# Other\n');
  await page.run(HOOKS);
  await page.type('MY UNSAVED WORK');
  const { root: doc } = await page.cdp('DOM.getDocument');
  const { nodeId } = await page.cdp('DOM.querySelector', { nodeId: doc.nodeId, selector: '#import-md' });

  await page.cdp('DOM.setFileInputFiles', { files: [file], nodeId });
  await sleep(300);
  assert.equal(await page.run(`window.__confirms.length`), 1);
  assert.equal(await page.run(`document.getElementById('editor').value`), 'MY UNSAVED WORK');

  await page.run(`window.__answer = true`);
  await page.cdp('DOM.setFileInputFiles', { files: [file], nodeId });
  await sleep(300);
  assert.equal(await page.run(`document.getElementById('editor').value`), '# Other\n');
  await page.close();
});

test('printing uses the bare resume title, and exported files print with page margins', { skip }, async () => {
  const page = await open();
  await page.run(`window.__titles = []; window.addEventListener('beforeprint', () => window.__titles.push(document.title));`);
  await page.cdp('Page.printToPDF');
  assert.deepEqual(await page.run(`window.__titles`), ['Jane Doe']);
  assert.equal(await page.run(`document.title`), 'Jane Doe · Markdown Resume');
  await page.close();

  const exported = join(tmp, 'cv.html');
  const cli = spawnSync(process.execPath, [
    join(root, 'bin', 'md-resume.js'), join(root, 'examples', 'resume.md'), '-o', exported,
  ]);
  assert.equal(cli.status, 0);
  const doc = await open(pathToFileURL(exported).href);
  await doc.cdp('Emulation.setEmulatedMedia', { media: 'print' });
  const print = await doc.run(`(() => ({
    padding: getComputedStyle(document.querySelector('article')).padding,
    margin: getComputedStyle(document.body).margin,
    pageRule: [...document.styleSheets].some((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('@page'))),
  }))()`);
  assert.deepEqual(print, { padding: '0px', margin: '0px', pageRule: true });
  await doc.close();
});
