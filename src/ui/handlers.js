import { storeImage, importVault, exportVault, save, deleteImage, renameFile } from '../core/storage.js';
import { insertAtCursor, getContent } from './editor.js';
import { setFilename, state, on, addImage } from '../core/state.js';
import { getSettings, updateSettings } from '../core/settings.js';

export function initHandlers() {
  document.addEventListener('paste', handlePaste);
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', handleDrop);

  document.getElementById('export-btn')?.addEventListener('click', exportVault);

  document.getElementById('import-btn')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) importVault(file);
    };
    input.click();
  });

  const filenameEl = document.getElementById('filename');
  filenameEl?.addEventListener('dblclick', () => {
    filenameEl.contentEditable = 'true';
    filenameEl.focus();
    const sel = window.getSelection();
    sel?.selectAllChildren(filenameEl);
  });
  filenameEl?.addEventListener('blur', async () => {
    filenameEl.contentEditable = 'false';
    let newName = filenameEl.textContent.trim() || 'untitled.md';
    if (!newName.includes('.')) newName += '.md';
    const oldName = state.filename;
    if (newName !== oldName && state.files.find(f => f.name === newName)) {
      filenameEl.textContent = oldName;
      return;
    }
    if (newName !== oldName) {
      await renameFile(oldName, newName);
      state.fileContents.set(newName, state.content);
      setFilename(newName);
    } else {
      filenameEl.textContent = oldName;
    }
  });
  filenameEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      filenameEl.blur();
    }
  });

  document.getElementById('download-md-btn')?.addEventListener('click', () => {
    const blob = new Blob([getContent()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.filename || 'untitled.md';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('print-btn')?.addEventListener('click', () => {
    window.print();
  });

  const imagesOverlay = document.getElementById('images-overlay');
  const imagesOverlayList = document.getElementById('images-overlay-list');
  document.getElementById('images-btn')?.addEventListener('click', () => {
    imagesOverlay?.classList.toggle('hidden');
    if (!imagesOverlay?.classList.contains('hidden')) {
      rebuildImagesList(imagesOverlayList);
    }
  });
  document.getElementById('images-overlay-close')?.addEventListener('click', () => {
    imagesOverlay?.classList.add('hidden');
  });
  imagesOverlay?.addEventListener('click', (e) => {
    if (e.target === imagesOverlay) imagesOverlay.classList.add('hidden');
  });

  on('image-add', () => {
    if (!imagesOverlay?.classList.contains('hidden')) {
      rebuildImagesList(imagesOverlayList);
    }
  });

  document.getElementById('settings-btn')?.addEventListener('click', () => {
    showSettingsModal();
  });

  window.addEventListener('pagehide', () => {
    save();
  });
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
      if (file) processImageFile(file);
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

async function processImageFile(file) {
  const dataUrl = await readFileAsDataUrl(file).catch(() => null);
  if (!dataUrl) return;

  if (file.type === 'image/svg+xml') {
    const name = uniqueName(file.name || `pasted-image-${Date.now()}.svg`);
    await storeImage(name, dataUrl);
    insertAtCursor(`![[${name}]]`);
    return;
  }

  const settings = getSettings();
  const convertToJpeg = file.type !== 'image/png';
  let name = generateImageName(file, settings);

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

function generateImageName(file, settings) {
  if (file.name && file.name.includes('.')) {
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
    const overlay = document.createElement('div');
    overlay.className = 'rename-overlay';

    const box = document.createElement('div');
    box.className = 'rename-box';

    const label = document.createElement('div');
    label.className = 'rename-label';
    label.textContent = 'Name your image';

    const input = document.createElement('input');
    input.className = 'rename-input';
    input.type = 'text';
    input.value = defaultName;
    input.spellcheck = false;

    const buttons = document.createElement('div');
    buttons.className = 'rename-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'rename-btn-primary';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'rename-btn-secondary';
    cancelBtn.textContent = 'Cancel';

    buttons.appendChild(saveBtn);
    buttons.appendChild(cancelBtn);
    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(buttons);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    input.focus();
    input.select();

    const cleanup = (result) => { overlay.remove(); resolve(result); };

    saveBtn.addEventListener('click', () => {
      const val = input.value.trim();
      cleanup(val || defaultName);
    });
    cancelBtn.addEventListener('click', () => cleanup(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
      if (e.key === 'Escape') cancelBtn.click();
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
