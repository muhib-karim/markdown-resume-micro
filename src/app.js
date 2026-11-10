// Browser glue: wires the editor, live preview, themes, local autosave and exports.
// Everything stays in the browser; the only request made is for the app's own stylesheet on export.
import {
  markdownToHtml,
  buildStandaloneHtml,
  extractTitle,
  toFilename,
} from './markdown.js';
import { SAMPLE_RESUME } from './sample.js';
import { createStore } from './storage.js';

const STORAGE_KEY = 'markdown-resume-micro:content';
const THEME_KEY = 'markdown-resume-micro:theme';
const SAVE_DELAY_MS = 400;
const MAX_IMPORT_BYTES = 1024 * 1024;
const SAVE_FAILED = 'Not saved: browser storage is full or blocked. Use "Save .md" to keep a copy.';

// Every lookup happens here, before any user content is rendered into the page.
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const themeSelect = document.getElementById('theme');
const status = document.getElementById('status');
const fileInput = document.getElementById('import-md');
const store = createStore(() => window.localStorage);

function setStatus(message) {
  status.textContent = message;
}

function render() {
  try {
    preview.innerHTML = markdownToHtml(editor.value);
  } catch (err) {
    // One document the renderer cannot handle must not take the whole UI down.
    preview.textContent = 'This document could not be rendered.';
    setStatus(`Preview failed: ${err.message}`);
  }
  preview.className = `resume theme-${themeSelect.value}`;
  document.title = `${extractTitle(editor.value)} · Markdown Resume`;
}

let saveTimer;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  setStatus(store.set(STORAGE_KEY, editor.value) ? 'Saved locally' : SAVE_FAILED);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

// Closing or hiding the tab inside the debounce window must not drop the last keystrokes.
function flushPendingSave() {
  if (saveTimer !== undefined) saveNow();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Offline fallback: serialise the resume stylesheet the page has already loaded.
function resumeCssFromPage() {
  try {
    const sheet = [...document.styleSheets].find(
      (s) => s.href && new URL(s.href).pathname.endsWith('/styles/resume.css'),
    );
    return sheet ? [...sheet.cssRules].map((rule) => rule.cssText).join('\n') : '';
  } catch {
    return '';
  }
}

async function resumeCss() {
  // Inline the resume stylesheet so the exported HTML is self-contained.
  try {
    const res = await fetch('styles/resume.css');
    if (res.ok) return await res.text();
  } catch {
    // offline or blocked: fall through to the copy already in the page
  }
  return resumeCssFromPage();
}

async function exportHtml() {
  const title = extractTitle(editor.value);
  const css = await resumeCss();
  const html = buildStandaloneHtml(markdownToHtml(editor.value), {
    title,
    css,
    theme: themeSelect.value,
  });
  download(toFilename(title, 'html'), html, 'text/html');
  if (!css) setStatus('Exported without styling: the stylesheet could not be loaded.');
}

function exportMarkdown() {
  download(toFilename(extractTitle(editor.value), 'md'), editor.value, 'text/markdown');
}

function importMarkdown(file) {
  if (file.size > MAX_IMPORT_BYTES) {
    setStatus(`"${file.name}" is too large to open (limit 1 MB).`);
    return;
  }
  if (editor.value.trim() && !window.confirm(`Replace the current content with "${file.name}"?`)) return;
  const reader = new FileReader();
  reader.onload = () => {
    editor.value = String(reader.result);
    render();
    scheduleSave();
  };
  reader.onerror = () => setStatus(`Could not read "${file.name}".`);
  reader.readAsText(file);
}

editor.addEventListener('input', () => {
  render();
  scheduleSave();
});

themeSelect.addEventListener('change', () => {
  store.set(THEME_KEY, themeSelect.value);
  render();
});

document.getElementById('print').addEventListener('click', () => window.print());
document.getElementById('export-html').addEventListener('click', exportHtml);
document.getElementById('export-md').addEventListener('click', exportMarkdown);
document.getElementById('open-md').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  if (file) importMarkdown(file);
  fileInput.value = '';
});
document.getElementById('load-sample').addEventListener('click', () => {
  if (editor.value.trim() && !window.confirm('Replace the current content with the sample resume?')) return;
  editor.value = SAMPLE_RESUME;
  render();
  scheduleSave();
});

window.addEventListener('pagehide', flushPendingSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPendingSave();
});

// The browser offers the page title as the PDF file name: use the bare resume title while printing.
window.addEventListener('beforeprint', () => {
  document.title = extractTitle(editor.value);
});
window.addEventListener('afterprint', render);

editor.value = store.get(STORAGE_KEY) ?? SAMPLE_RESUME;
themeSelect.value = store.get(THEME_KEY) ?? 'classic';
if (!themeSelect.value) themeSelect.value = 'classic';
render();
