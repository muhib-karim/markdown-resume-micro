// Browser glue: wires the editor, live preview, themes, local autosave and exports.
// Everything stays in the browser; no network requests are made.
import {
  markdownToHtml,
  buildStandaloneHtml,
  extractTitle,
  toFilename,
} from './markdown.js';
import { SAMPLE_RESUME } from './sample.js';

const STORAGE_KEY = 'markdown-resume-micro:content';
const THEME_KEY = 'markdown-resume-micro:theme';

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const themeSelect = document.getElementById('theme');
const status = document.getElementById('status');

function safeStorage(action) {
  try {
    return action(window.localStorage);
  } catch {
    return null; // storage disabled (private mode, file:// in some browsers)
  }
}

function render() {
  preview.innerHTML = markdownToHtml(editor.value);
  preview.className = `resume theme-${themeSelect.value}`;
  document.title = `${extractTitle(editor.value)} · Markdown Resume`;
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    safeStorage((s) => s.setItem(STORAGE_KEY, editor.value));
    status.textContent = 'Saved locally';
  }, 400);
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

async function resumeCss() {
  // Inline the resume stylesheet so the exported HTML is self-contained.
  const res = await fetch('styles/resume.css');
  return res.ok ? res.text() : '';
}

async function exportHtml() {
  const title = extractTitle(editor.value);
  let css = '';
  try {
    css = await resumeCss();
  } catch {
    css = '';
  }
  const html = buildStandaloneHtml(markdownToHtml(editor.value), {
    title,
    css,
    theme: themeSelect.value,
  });
  download(toFilename(title, 'html'), html, 'text/html');
}

function exportMarkdown() {
  download(toFilename(extractTitle(editor.value), 'md'), editor.value, 'text/markdown');
}

function importMarkdown(file) {
  const reader = new FileReader();
  reader.onload = () => {
    editor.value = String(reader.result);
    render();
    scheduleSave();
  };
  reader.readAsText(file);
}

editor.value = safeStorage((s) => s.getItem(STORAGE_KEY)) ?? SAMPLE_RESUME;
themeSelect.value = safeStorage((s) => s.getItem(THEME_KEY)) ?? 'classic';
if (!themeSelect.value) themeSelect.value = 'classic';
render();

editor.addEventListener('input', () => {
  status.textContent = 'Editing…';
  render();
  scheduleSave();
});

themeSelect.addEventListener('change', () => {
  safeStorage((s) => s.setItem(THEME_KEY, themeSelect.value));
  render();
});

document.getElementById('print').addEventListener('click', () => window.print());
document.getElementById('export-html').addEventListener('click', exportHtml);
document.getElementById('export-md').addEventListener('click', exportMarkdown);
document.getElementById('import-md').addEventListener('change', (e) => {
  const [file] = e.target.files;
  if (file) importMarkdown(file);
  e.target.value = '';
});
document.getElementById('load-sample').addEventListener('click', () => {
  if (editor.value.trim() && !window.confirm('Replace the current content with the sample resume?')) return;
  editor.value = SAMPLE_RESUME;
  render();
  scheduleSave();
});
