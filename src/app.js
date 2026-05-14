import { init as initStorage, save } from './core/storage.js';
import { state, setContent, on } from './core/state.js';
import { initParser } from './parser/config.js';
import { initPreview, scheduleRender } from './render/preview.js';
import { initEditor, setContent as setEditorContent, searchAndJump } from './ui/editor.js';
import { initHandlers } from './ui/handlers.js';

let saveTimer = null;
const SAVE_DEBOUNCE = 500;

async function init() {
  const editorEl = document.getElementById('editor');
  const previewEl = document.getElementById('preview');

  initParser();
  initEditor(editorEl, handleEditorChange);
  initPreview(previewEl);
  initHandlers();

  await initStorage();

  previewEl.addEventListener('dblclick', (e) => {
    const target = findSourceTarget(e.target);
    if (target) searchAndJump(target);
  });

  setEditorContent(state.content);
  scheduleRender(state.content);

  on('content-change', (content) => {
    scheduleRender(content);
    debounceSave();
  });

  on('filename-change', (name) => {
    document.getElementById('filename').textContent = name;
  });
}

function handleEditorChange(content) {
  setContent(content);
}

function debounceSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DEBOUNCE);
}

function findSourceTarget(el) {
  const callout = el.closest('.callout');
  if (callout) {
    const typeMatch = callout.className.match(/callout-(\w+)/);
    const type = typeMatch ? typeMatch[1] : 'info';
    const header = callout.querySelector('.callout-header');
    const title = header ? header.textContent.trim() : '';
    return title && title.toLowerCase() !== type
      ? '> [!' + type + '] ' + title
      : '> [!' + type + ']';
  }

  const img = el.closest('img');
  if (img && img.alt) return '![[' + img.alt + ']]';

  const heading = el.closest('h1,h2,h3,h4,h5,h6');
  if (heading) {
    const level = parseInt(heading.tagName[1]);
    return '#'.repeat(level) + ' ' + heading.textContent.trim();
  }

  const wikilink = el.closest('a[data-wikilink]');
  if (wikilink) return '[[' + wikilink.getAttribute('data-wikilink') + ']]';

  const code = el.closest('pre,code');
  if (code) return code.textContent.trim().split('\n')[0].trim();

  const tableCell = el.closest('th,td');
  if (tableCell) return tableCell.textContent.trim();

  const listItem = el.closest('li');
  if (listItem) return listItem.textContent.trim().split('\n')[0].trim();

  const para = el.closest('p');
  if (para) return para.textContent.trim().split('\n')[0].trim();

  const blockquote = el.closest('blockquote');
  if (blockquote) return blockquote.textContent.trim().split('\n')[0].trim();

  return null;
}

document.addEventListener('DOMContentLoaded', init);
