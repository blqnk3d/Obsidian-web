import { init as initStorage, save, renameFile, nextUntitledName } from './core/storage.js';
import { state, setContent, setFilename, on } from './core/state.js';
import { initParser } from './parser/config.js';
import { initPreview, scheduleRender } from './render/preview.js';
import { initEditor, setContent as setEditorContent, searchAndJump } from './ui/editor.js';
import { initHandlers } from './ui/handlers.js';
import { initSidebar } from './ui/sidebar.js';
import { makeDraggable } from './ui/drag.js';
import { createPromptModal } from './ui/modal.js';

let saveTimer = null;
const SAVE_DEBOUNCE = 500;

async function init() {
  const editorEl = document.getElementById('editor');
  const previewEl = document.getElementById('preview');
  const sidebarEl = document.getElementById('sidebar');

  initParser();
  initEditor(editorEl, handleEditorChange);
  initPreview(previewEl);
  initHandlers();
  if (sidebarEl) initSidebar(sidebarEl);

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
    const el = document.getElementById('filename');
    if (el) el.textContent = name;
  });

  initSidebarWindow();
  promptRenameUntitled();
}

function initSidebarWindow() {
  const sidebar = document.getElementById('sidebar');
  const header = document.getElementById('sidebar-header');
  const hideBtn = document.getElementById('sidebar-hide-btn');
  const showBtn = document.getElementById('show-sidebar-btn');

  if (!sidebar || !header) return;

  let positioned = false;

  /* ── Persist visibility ── */
  const stored = localStorage.getItem('sidebar-visible');
  if (stored === 'false') {
    sidebar.classList.add('hidden');
  }

  function positionUnderButton() {
    if (positioned) return;
    const rect = showBtn?.getBoundingClientRect();
    if (!rect) return;
    sidebar.style.left = Math.max(12, rect.left) + 'px';
    sidebar.style.top = (rect.bottom + 4) + 'px';
    sidebar.style.right = 'auto';
    positioned = true;
  }

  if (!sidebar.classList.contains('hidden')) {
    positionUnderButton();
  }

  makeDraggable(sidebar, header, () => { positioned = true; });

  /* ── Toggle via Files button ── */
  showBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
    if (!sidebar.classList.contains('hidden')) {
      if (!positioned) positionUnderButton();
      const imgOverlay = document.getElementById('images-overlay');
      if (imgOverlay && !imgOverlay.classList.contains('hidden')) {
        imgOverlay.classList.add('hidden');
      }
    }
    localStorage.setItem('sidebar-visible', !sidebar.classList.contains('hidden'));
  });

  /* ── Hide via ─ button ── */
  hideBtn?.addEventListener('click', () => {
    sidebar.classList.add('hidden');
    localStorage.setItem('sidebar-visible', 'false');
  });

  /* ── Reposition on resize if not dragged ── */
  window.addEventListener('resize', () => {
    if (!positioned && !sidebar.classList.contains('hidden')) {
      positionUnderButton();
    }
  });
}

function promptRenameUntitled() {
  const name = state.filename;
  if (!name.startsWith('untitled')) return;
  if (!state.content || !state.content.trim()) return;

  const modal = createPromptModal({
    labelText: 'Name your note',
    inputValue: name,
    confirmText: 'Save As',
    cancelText: 'Later',
    onConfirm: async (newName) => {
      if (!newName) newName = nextUntitledName();
      if (!newName.includes('.')) newName += '.md';
      if (newName === state.filename || state.files.find(f => f.name === newName && f.name !== state.filename)) return;
      const oldName = state.filename;
      await renameFile(oldName, newName);
      state.fileContents.set(newName, state.content);
      setFilename(newName);
    },
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
