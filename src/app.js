import { init as initStorage, save, renameFile, nextUntitledName } from './core/storage.js';
import { state, setContent, setFilename, on } from './core/state.js';
import { initParser } from './parser/config.js';
import { initPreview, scheduleRender } from './render/preview.js';
import { initEditor, setContent as setEditorContent, searchAndJump } from './ui/editor.js';
import { initHandlers } from './ui/handlers.js';
import { initSidebar } from './ui/sidebar.js';

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

  /* ── Persist visibility ── */
  const stored = localStorage.getItem('sidebar-visible');
  if (stored === 'false') {
    sidebar.classList.add('hidden');
    showBtn?.classList.remove('hidden');
  }

  /* ── Drag by header ── */
  let dragging = false;
  let startX, startY, origLeft, origTop;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.window-controls')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origLeft = sidebar.offsetLeft;
    origTop = sidebar.offsetTop;
    sidebar.style.left = origLeft + 'px';
    sidebar.style.top = origTop + 'px';
    sidebar.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let newLeft = origLeft + dx;
    let newTop = origTop + dy;

    newLeft = Math.max(-sidebar.offsetWidth + 60, Math.min(newLeft, window.innerWidth - 60));
    newTop = Math.max(40, Math.min(newTop, window.innerHeight - 60));

    sidebar.style.left = newLeft + 'px';
    sidebar.style.top = newTop + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    sidebar.style.transition = '';
  });

  /* ── Hide / Show ── */
  hideBtn?.addEventListener('click', () => {
    sidebar.classList.add('hidden');
    showBtn?.classList.remove('hidden');
    localStorage.setItem('sidebar-visible', 'false');
  });

  showBtn?.addEventListener('click', () => {
    sidebar.classList.remove('hidden');
    showBtn?.classList.add('hidden');
    localStorage.setItem('sidebar-visible', 'true');

    if (parseInt(sidebar.style.left) < 40 || !sidebar.style.left) {
      sidebar.style.left = '';
      sidebar.style.top = '';
    }
  });
}

function promptRenameUntitled() {
  const name = state.filename;
  if (!name.startsWith('untitled')) return;
  if (!state.content || !state.content.trim()) return;

  const overlay = document.createElement('div');
  overlay.className = 'rename-overlay';

  const box = document.createElement('div');
  box.className = 'rename-box';

  const label = document.createElement('div');
  label.className = 'rename-label';
  label.textContent = 'Name your note';

  const input = document.createElement('input');
  input.className = 'rename-input';
  input.type = 'text';
  input.value = name;
  input.spellcheck = false;

  const buttons = document.createElement('div');
  buttons.className = 'rename-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'rename-btn-primary';
  saveBtn.textContent = 'Save As';

  const laterBtn = document.createElement('button');
  laterBtn.className = 'rename-btn-secondary';
  laterBtn.textContent = 'Later';

  buttons.appendChild(saveBtn);
  buttons.appendChild(laterBtn);

  box.appendChild(label);
  box.appendChild(input);
  box.appendChild(buttons);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  input.focus();
  input.select();

  const commit = async () => {
    let newName = input.value.trim() || nextUntitledName();
    if (!newName.includes('.')) newName += '.md';
    if (newName === state.filename || state.files.find(f => f.name === newName && f.name !== state.filename)) {
      overlay.remove();
      return;
    }
    const oldName = state.filename;
    await renameFile(oldName, newName);
    state.fileContents.set(newName, state.content);
    setFilename(newName);
    overlay.remove();
  };

  saveBtn.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') overlay.remove();
  });
  laterBtn.addEventListener('click', () => overlay.remove());
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
