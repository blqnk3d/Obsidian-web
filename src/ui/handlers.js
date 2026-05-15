import { storeImage, importVault, exportVault, save, deleteImage, renameFile, clearStore, nextUntitledName, saveFile } from '../core/storage.js';
import { insertAtCursor, setContent as setEditorContent, wrapSelection, insertLinePrefix, insertTemplate, insertTable, SNIPPET_TEMPLATES } from './editor.js';
import { scheduleRender } from '../render/preview.js';
import { setFilename, setContent, state, on, addImage } from '../core/state.js';
import { getSettings, updateSettings, SETTINGS_KEY } from '../core/settings.js';
import { makeDraggable } from './drag.js';
import { createPromptModal } from './modal.js';

export function initHandlers() {
  document.addEventListener('paste', handlePaste);
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', handleDrop);

  document.getElementById('export-btn')?.addEventListener('click', () => {
    showExportModal();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      showExportModal();
    }
  });

  const imagesOverlay = document.getElementById('images-overlay');
  const imagesOverlayList = document.getElementById('images-overlay-list');
  const imagesHeader = document.getElementById('images-overlay-header');
  document.getElementById('images-btn')?.addEventListener('click', () => {
    imagesOverlay?.classList.toggle('hidden');
    if (!imagesOverlay?.classList.contains('hidden')) {
      rebuildImagesList(imagesOverlayList);
      const sidebar = document.getElementById('sidebar');
      if (sidebar && !sidebar.classList.contains('hidden')) {
        sidebar.classList.add('hidden');
        localStorage.setItem('sidebar-visible', 'false');
      }
    }
  });
  document.getElementById('images-overlay-close')?.addEventListener('click', () => {
    imagesOverlay?.classList.add('hidden');
  });

  makeDraggable(imagesOverlay, imagesHeader);

  on('image-add', () => {
    if (!imagesOverlay?.classList.contains('hidden')) {
      rebuildImagesList(imagesOverlayList);
    }
  });

  document.getElementById('settings-btn')?.addEventListener('click', () => {
    showSettingsModal();
  });

  document.getElementById('sidebar-import-btn')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) importVault(file);
    };
    input.click();
  });

  window.addEventListener('pagehide', () => {
    save();
  });

  initToolbar();
  initSplitPane();
}

function rebuildImagesList(listEl) {
  listEl.innerHTML = '';
  const names = [...state.images.keys()].sort();
  if (names.length === 0) {
    listEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center;">No images stored. Paste or drop an image to add it.</div>';
    return;
  }
  for (const name of names) {
    const data = state.images.get(name);
    const item = document.createElement('div');
    item.className = 'image-item';
    item.title = 'Click to insert ![[' + name + ']]';
    const img = document.createElement('img');
    img.src = data;
    img.alt = name;
    const label = document.createElement('span');
    label.className = 'image-name';
    label.textContent = name;
    const delBtn = document.createElement('button');
    delBtn.className = 'image-delete';
    delBtn.textContent = '\u2716';
    delBtn.title = 'Delete image';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.images.delete(name);
      deleteImage(name);
      rebuildImagesList(listEl);
    });
    item.appendChild(img);
    item.appendChild(label);
    item.appendChild(delBtn);
    item.addEventListener('click', () => {
      insertAtCursor('![[' + name + ']]');
    });
    listEl.appendChild(item);
  }
}

function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) processImageFile(file, true);
    }
  }
}

function handleDrop(e) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files) return;

  for (const file of files) {
    if (file.type.startsWith('image/')) {
      processImageFile(file);
    }
  }
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/x-icon': 'ico' };
const MAX_IMG_DIM = 1920;
const JPEG_QUALITY = 0.7;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function processImageFile(file, isPaste = false) {
  const dataUrl = await readFileAsDataUrl(file).catch(() => null);
  if (!dataUrl) return;

  const settings = getSettings();

  if (file.type === 'image/svg+xml') {
    const name = uniqueName(generateImageName(file, settings, isPaste));
    await storeImage(name, dataUrl);
    insertAtCursor(`![[${name}]]`);
    return;
  }

  const convertToJpeg = file.type !== 'image/png';
  let name = generateImageName(file, settings, isPaste);

  if (settings.imageNaming === 'prompt') {
    name = await promptImageName(name);
    if (!name) return;
  }

  name = forceExtension(name, convertToJpeg ? '.jpg' : '.png');

  const compressed = await compressImage(dataUrl, convertToJpeg, name);
  name = uniqueName(compressed.name);

  await storeImage(name, compressed.dataUrl);
  insertAtCursor(`![[${name}]]`);
}

function generateImageName(file, settings, isPaste = false) {
  if (!isPaste && file.name && file.name.includes('.')) {
    return file.name;
  }

  const ext = MIME_EXT[file.type] || 'png';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  switch (settings.imageNaming) {
    case 'random':
      return `pasted-image-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    case 'prompt':
    case 'date-index':
    default:
      return `pasted-image-${ts}.${ext}`;
  }
}

function forceExtension(name, ext) {
  const base = name.includes('.') ? name.replace(/\.[^.]+$/, '') : name;
  return base + ext;
}

function uniqueName(name) {
  if (!state.images.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : '';
  let idx = 1;
  while (state.images.has(`${base}_${idx}${ext}`)) {
    idx++;
  }
  return `${base}_${idx}${ext}`;
}

function compressImage(dataUrl, convertToJpeg, name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const needsResize = w > MAX_IMG_DIM || h > MAX_IMG_DIM;

      if (needsResize) {
        if (w > h) { h = Math.round(h * MAX_IMG_DIM / w); w = MAX_IMG_DIM; }
        else { w = Math.round(w * MAX_IMG_DIM / h); h = MAX_IMG_DIM; }
      }

      if (!convertToJpeg && !needsResize) {
        resolve({ dataUrl, name });
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      if (convertToJpeg) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
      }

      ctx.drawImage(img, 0, 0, w, h);

      if (convertToJpeg) {
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), name: forceExtension(name, '.jpg') });
      } else {
        resolve({ dataUrl: canvas.toDataURL('image/png'), name });
      }
    };
    img.onerror = () => resolve({ dataUrl, name });
    img.src = dataUrl;
  });
}

function promptImageName(defaultName) {
  return new Promise((resolve) => {
    createPromptModal({
      labelText: 'Name your image',
      inputValue: defaultName,
      onConfirm: (val) => resolve(val || defaultName),
      onCancel: () => resolve(null),
    });
  });
}

function showSettingsModal() {
  const existing = document.querySelector('.rename-overlay');
  if (existing) return;

  const settings = getSettings();

  const overlay = document.createElement('div');
  overlay.className = 'rename-overlay';

  const box = document.createElement('div');
  box.className = 'rename-box settings-box';

  const label = document.createElement('div');
  label.className = 'rename-label';
  label.textContent = 'Image Naming';

  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:12px;';
  desc.textContent = 'How should pasted / dropped images be named?';

  const select = document.createElement('select');
  select.className = 'rename-input';
  select.innerHTML = `
    <option value="date-index" ${settings.imageNaming === 'date-index' ? 'selected' : ''}>Date + time (e.g. pasted-image-2026-05-14-123045.png)</option>
    <option value="random" ${settings.imageNaming === 'random' ? 'selected' : ''}>Random suffix (e.g. pasted-image-a7f3b2c9.png)</option>
    <option value="prompt" ${settings.imageNaming === 'prompt' ? 'selected' : ''}>Prompt each time</option>
  `;

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:6px;';
  hint.textContent = 'Note: when dragging a file with a name, the original name is kept. Other rules apply to clipboard pastes.';

  /* ── Storage section ── */
  const storageDiv = document.createElement('div');
  storageDiv.style.cssText = 'border-top:1px solid var(--border);margin-top:14px;padding-top:12px;';

  const storageLabel = document.createElement('div');
  storageLabel.className = 'rename-label';
  storageLabel.textContent = 'Storage';
  storageLabel.style.marginBottom = '8px';

  const storageRows = document.createElement('div');
  storageRows.style.cssText = 'font-size:12px;color:var(--text-secondary);line-height:1.7;';

  const notesCount = state.files.length;
  const imgCount = state.images.size;
  let imgBytes = 0;
  for (const data of state.images.values()) {
    imgBytes += Math.round(data.length * 0.75);
  }
  const fmtSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  storageRows.innerHTML = `
    <div>Notes: ${notesCount}</div>
    <div>Images: ${imgCount} (${fmtSize(imgBytes)} actual)</div>
    <div id="storage-browser-line">Browser quota: loading…</div>
  `;

  const barOuter = document.createElement('div');
  barOuter.style.cssText = 'height:4px;background:var(--bg-tertiary);border-radius:2px;margin-top:6px;overflow:hidden;';
  const barInner = document.createElement('div');
  barInner.id = 'storage-bar';
  barInner.style.cssText = 'height:100%;width:0;background:var(--accent);border-radius:2px;transition:width 0.3s;';
  barOuter.appendChild(barInner);

  storageDiv.appendChild(storageLabel);
  storageDiv.appendChild(storageRows);
  storageDiv.appendChild(barOuter);

  navigator.storage?.estimate().then(({ usage, quota }) => {
    const pct = Math.min(100, Math.round((usage / quota) * 100));
    const el = document.getElementById('storage-browser-line');
    const bar = document.getElementById('storage-bar');
    if (el) el.textContent = `Browser: ${fmtSize(usage)} / ${fmtSize(quota)} (${pct}%)`;
    if (bar) bar.style.width = pct + '%';
  }).catch(() => {
    const el = document.getElementById('storage-browser-line');
    if (el) el.textContent = 'Browser quota: not available';
  });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear all data';
  clearBtn.style.cssText = 'margin-top:14px;padding:6px 12px;font-size:12px;border:1px solid var(--accent);border-radius:4px;background:transparent;color:var(--accent);cursor:pointer;width:100%;';
  clearBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Permanently delete all notes and images?')) return;
    await clearStore('files');
    state.images.clear();
    await clearStore('images');
    state.fileContents.clear();
    state.files = [];
    localStorage.removeItem(SETTINGS_KEY);
    const name = nextUntitledName();
    state.fileContents.set(name, '');
    state.files.push({ name, updated_at: new Date().toISOString() });
    setFilename(name);
    setEditorContent('');
    setContent('');
    scheduleRender('');
    await saveFile(name, '');
    overlay.remove();
  });
  storageDiv.appendChild(clearBtn);

  const buttons = document.createElement('div');
  buttons.className = 'rename-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'rename-btn-primary';
  saveBtn.textContent = 'Save';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'rename-btn-secondary';
  closeBtn.textContent = 'Close';

  buttons.appendChild(saveBtn);
  buttons.appendChild(closeBtn);
  box.appendChild(label);
  box.appendChild(desc);
  box.appendChild(select);
  box.appendChild(hint);
  box.appendChild(storageDiv);
  box.appendChild(buttons);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  saveBtn.addEventListener('click', () => {
    updateSettings({ imageNaming: select.value });
    overlay.remove();
  });
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function showExportModal() {
  const existing = document.querySelector('.rename-overlay');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.className = 'rename-overlay';

  const box = document.createElement('div');
  box.className = 'rename-box settings-box';

  const label = document.createElement('div');
  label.className = 'rename-label';
  label.textContent = 'Export';

  const list = document.createElement('div');
  list.style.marginTop = '10px';

  const options = [
    { label: 'Markdown (.md)', desc: 'Download the current note as a .md file', action: () => {
      const blob = new Blob([state.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = state.filename || 'untitled.md';
      a.click();
      URL.revokeObjectURL(url);
    }},
    { label: 'JSON', desc: 'Export all notes and images as a .json vault', action: () => exportVault() },
    { label: 'PDF', desc: 'Open the browser print dialog to save as PDF', action: () => {
      setTimeout(() => window.print(), 0);
    }},
  ];

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.className = 'export-option';

    const text = document.createElement('div');
    const lbl = document.createElement('div');
    lbl.className = 'export-option-label';
    lbl.textContent = opt.label;
    const dsc = document.createElement('div');
    dsc.className = 'export-option-desc';
    dsc.textContent = opt.desc;

    text.appendChild(lbl);
    text.appendChild(dsc);
    btn.appendChild(text);

    btn.addEventListener('click', () => { opt.action(); overlay.remove(); });
    list.appendChild(btn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'rename-btn-secondary';
  closeBtn.textContent = 'Close';
  closeBtn.style.marginTop = '4px';

  box.appendChild(label);
  box.appendChild(list);
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

/* ── Toolbar ── */

function initToolbar() {
  document.querySelectorAll('.tb-dropdown-wrap').forEach((wrap) => {
    const btn = wrap.querySelector('.tb-btn');
    const dd = wrap.querySelector('.tb-dropdown');
    if (!btn || !dd) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dd.classList.toggle('tb-dropdown-open');
    });
    dd.querySelectorAll('button').forEach((item) => {
      item.addEventListener('click', () => {
        dd.classList.remove('tb-dropdown-open');
      });
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.tb-dropdown-open').forEach((dd) => dd.classList.remove('tb-dropdown-open'));
  });

  bindToolbar('[data-tb="ul"]', () => insertLinePrefix('- '));
  bindToolbar('[data-tb="ol"]', () => insertLinePrefix('1. '));
  bindToolbar('[data-tb="hr"]', () => insertAtCursor('\n---\n'));
  bindToolbar('[data-tb="wikilink"]', () => wrapSelection('[[', ']]'));

  document.querySelectorAll('[data-tb="heading"] + .tb-dropdown button').forEach((btn) => {
    btn.addEventListener('click', () => {
      insertLinePrefix('#'.repeat(Number(btn.dataset.level)) + ' ');
    });
  });

  document.querySelectorAll('[data-tb="format"] + .tb-dropdown button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'bold') wrapSelection('**', '**');
      else if (cmd === 'italic') wrapSelection('*', '*');
      else if (cmd === 'highlight') wrapSelection('==', '==');
    });
  });

  document.querySelectorAll('[data-tb="callout"] + .tb-dropdown button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      insertAtCursor(`> [!${type.toUpperCase()}]\n> `);
    });
  });

  document.querySelectorAll('[data-tb="snippets"] + .tb-dropdown button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const template = SNIPPET_TEMPLATES[btn.dataset.snippet];
      if (template) insertTemplate(template);
    });
  });

  document.querySelectorAll('[data-tb="table"] + .tb-dropdown button').forEach((btn) => {
    btn.addEventListener('click', () => {
      insertTable(Number(btn.dataset.rows), Number(btn.dataset.cols));
    });
  });
}

function bindToolbar(selector, fn) {
  const el = document.querySelector(selector);
  if (el) el.addEventListener('click', fn);
}

function initSplitPane() {
  const container = document.getElementById('split-pane');
  const editorPane = document.getElementById('editor-pane');
  const previewPane = document.getElementById('preview-pane');
  const divider = document.getElementById('split-divider');
  if (!container || !editorPane || !previewPane || !divider) {
    return;
  }

  function setSplit(r) {
    r = Math.max(0.15, Math.min(0.85, r));
    editorPane.style.maxWidth = (r * 100) + '%';
    previewPane.style.maxWidth = ((1 - r) * 100) + '%';
  }

  const saved = localStorage.getItem('split-ratio');
  if (saved) setSplit(parseFloat(saved));

  let drag = false;
  divider.addEventListener('mousedown', (ev) => {
    drag = true;
    divider.classList.add('active');
    ev.preventDefault();
  });

  document.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    setSplit((ev.clientX - container.getBoundingClientRect().left) / container.offsetWidth);
  });

  document.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = false;
    divider.classList.remove('active');
    localStorage.setItem('split-ratio', (editorPane.offsetWidth / container.offsetWidth));
  });
}
