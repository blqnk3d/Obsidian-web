import { init as initStorage, save, renameFile, nextUntitledName } from './core/storage.js';
import { state, setContent, setFilename, on } from './core/state.js';
import { initParser } from './parser/config.js';
import { initPreview, scheduleRender } from './render/preview.js';
import { initEditor, setContent as setEditorContent, searchAndJump } from './ui/editor.js';
import { initHandlers, showConflictModal, showGitSettingsModal } from './ui/handlers.js';
import { initSidebar } from './ui/sidebar.js';
import { makeDraggable } from './ui/drag.js';
import { createPromptModal } from './ui/modal.js';
import { showToast } from './ui/toast.js';
import { pullFromRemote, pushToRemote, getGitSettings, getDirtyFiles, getDirtyImages, markDirty, clearDirty } from './core/git.js';

let saveTimer = null;
const SAVE_DEBOUNCE = 500;
let syncIntervalId = null;

async function init() {
  const editorEl = document.getElementById('editor');
  const previewEl = document.getElementById('preview');
  const sidebarEl = document.getElementById('sidebar');

  initParser();
  initEditor(editorEl, handleEditorChange);
  initPreview(previewEl);
  initHandlers();
  if (sidebarEl) initSidebar(sidebarEl);

  initSyncIndicator();

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

  window.addEventListener('git-settings-changed', () => {
    console.log('[auto-sync] git-settings-changed event received');
    scheduleAutoSync();
  });

  /* Auto-sync */
  console.log('[auto-sync] init: calling scheduleAutoSync()');
  scheduleAutoSync();

  const git = getGitSettings();
  console.log('[auto-sync] init: git settings', { owner: git.owner, repo: git.repo, hasToken: !!git.token, autoSync: git.autoSync });
  if (git.owner && git.repo && git.token && git.autoSync) {
    console.log('[auto-sync] init: triggering autoPull()');
    autoPull().catch(() => {});
  }
}

function initSyncIndicator() {
  const topbar = document.getElementById('topbar');
  const settingsBtn = document.getElementById('settings-btn');
  if (!topbar || !settingsBtn) return;

  const el = document.createElement('div');
  el.id = 'sync-indicator';
  el.title = 'Click to open settings';
  el.innerHTML = '<span class="sync-dot off"></span><span class="sync-text">Sync</span>';
  el.addEventListener('click', () => {
    showGitSettingsModal();
  });
  topbar.insertBefore(el, settingsBtn);
}

function updateSyncIndicator(status, msg) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  const dot = el.querySelector('.sync-dot');
  const text = el.querySelector('.sync-text');
  if (dot) dot.className = 'sync-dot ' + status;
  if (text) text.textContent = msg || 'Sync';
  if (el.title) el.title = msg || 'Click to open settings';
}

function scheduleAutoSync() {
  if (syncIntervalId) { clearInterval(syncIntervalId); syncIntervalId = null; }
  const git = getGitSettings();
  console.log('[auto-sync] scheduleAutoSync: autoSync=' + git.autoSync + ' owner="' + git.owner + '" repo="' + git.repo + '" hasToken=' + !!git.token);
  if (!git.autoSync) { console.log('[auto-sync] scheduleAutoSync: bailing — autoSync disabled'); return; }
  if (!git.owner) { console.log('[auto-sync] scheduleAutoSync: bailing — owner empty'); return; }
  if (!git.repo) { console.log('[auto-sync] scheduleAutoSync: bailing — repo empty'); return; }
  if (!git.token) { console.log('[auto-sync] scheduleAutoSync: bailing — token empty'); return; }
  console.log('[auto-sync] scheduleAutoSync: starting interval at ' + (git.syncInterval / 1000) + 's');
  syncIntervalId = setInterval(() => {
    autoPush().catch(() => {});
  }, git.syncInterval);
}

async function autoPull() {
  const git = getGitSettings();
  if (!git.owner || !git.repo || !git.token || !git.autoSync) {
    console.log('[auto-sync] autoPull: bailing — config incomplete');
    return;
  }

  console.log('[auto-sync] autoPull: starting pull');
  updateSyncIndicator('syncing', 'Syncing...');
  try {
    const result = await pullFromRemote((msg) => {
      const el = document.getElementById('sync-indicator');
      if (el) el.querySelector('.sync-text').textContent = msg;
    });
    console.log('[auto-sync] autoPull: done, synced=' + result.synced + ' files=' + JSON.stringify(result.files));
    updateSyncIndicator('synced', 'Synced');
    if (result.synced > 0) {
      showToast(`Pulled ${result.synced} file(s)`, 'info', 2000);
    }
  } catch (e) {
    console.log('[auto-sync] autoPull: failed — ' + e.message);
    updateSyncIndicator('synced', 'Synced');
  }
}

async function autoPush() {
  const git = getGitSettings();
  if (!git.owner || !git.repo || !git.token || !git.autoSync) {
    console.log('[auto-sync] autoPush: bailing — config incomplete');
    return;
  }

  const dirty = getDirtyFiles();
  const dirtyImgs = getDirtyImages();
  console.log('[auto-sync] autoPush: dirty files count=' + dirty.size + ' files=' + JSON.stringify([...dirty]) + ' images=' + dirtyImgs.size);
  if (dirty.size === 0 && dirtyImgs.size === 0) {
    console.log('[auto-sync] autoPush: nothing dirty, skipping');
    return;
  }

  console.log('[auto-sync] autoPush: pushing ' + dirty.size + ' dirty files');
  updateSyncIndicator('syncing', 'Syncing...');
  try {
    const r = await pushToRemote(
      (msg) => {
        const el = document.getElementById('sync-indicator');
        if (el) el.querySelector('.sync-text').textContent = msg;
      },
      [...dirty]
    );
    console.log('[auto-sync] autoPush: pushed ' + r.pushed + ' files conflicts=' + (r.conflicts?.length || 0));
    updateSyncIndicator('synced', 'Synced');
    if (r.conflicts && r.conflicts.length > 0) {
      showToast(`Conflict on ${r.conflicts.map(c => c.fileName).join(', ')} — open Git settings to resolve`, 'error', 6000);
    } else if (r.pushed > 0) {
      showToast(`Pushed ${r.pushed} file(s)`, 'success', 2000);
    }
  } catch (e) {
    console.log('[auto-sync] autoPush: failed — ' + e.message);
    updateSyncIndicator('error', 'Sync error');
    showToast('Auto-sync failed: ' + e.message, 'error', 4000);
  }
}

function initSidebarWindow() {
  const sidebar = document.getElementById('sidebar');
  const header = document.getElementById('sidebar-header');
  const hideBtn = document.getElementById('sidebar-hide-btn');
  const showBtn = document.getElementById('show-sidebar-btn');

  if (!sidebar || !header) return;

  let positioned = false;

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

  hideBtn?.addEventListener('click', () => {
    sidebar.classList.add('hidden');
    localStorage.setItem('sidebar-visible', 'false');
  });

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
  console.log('[auto-sync] markDirty("' + state.filename + '") from handleEditorChange');
  markDirty(state.filename);
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
