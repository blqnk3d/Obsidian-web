import { storeImage, importVault, exportVault, save, deleteImage, renameFile } from '../core/storage.js';
import { insertAtCursor, getContent } from './editor.js';
import { setFilename, state, on, addImage } from '../core/state.js';

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

function processImageFile(file) {
  if (file.type === 'image/svg+xml') {
    const svgReader = new FileReader();
    svgReader.onload = (e) => {
      let name = file.name || `pasted-image-${Date.now()}.svg`;
      storeImage(name, e.target.result);
      insertAtCursor(`![[${name}]]`);
    };
    svgReader.readAsDataURL(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    let name = file.name;
    if (!name || !name.includes('.')) {
      const ext = MIME_EXT[file.type] || 'png';
      name = `pasted-image-${Date.now()}.${ext}`;
    }

    const isPng = file.type === 'image/png';
    const compressed = await compressImage(dataUrl, isPng, name);
    name = compressed.name;

    await storeImage(name, compressed.dataUrl);
    insertAtCursor(`![[${name}]]`);
  };
  reader.onerror = () => console.warn('Image read failed');
  reader.readAsDataURL(file);
}

function compressImage(dataUrl, isPng, origName) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      let needsResize = w > MAX_IMG_DIM || h > MAX_IMG_DIM;

      if (needsResize) {
        if (w > h) { h = Math.round(h * MAX_IMG_DIM / w); w = MAX_IMG_DIM; }
        else { w = Math.round(w * MAX_IMG_DIM / h); h = MAX_IMG_DIM; }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      if (isPng) {
        if (!needsResize) {
          resolve({ dataUrl, name: origName });
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL('image/png'), name: origName });
        return;
      }

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      let name = origName;
      const jpgName = origName.replace(/\.[^.]+$/, '.jpg');
      if (jpgName !== origName) name = jpgName;

      resolve({ dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), name });
    };
    img.onerror = () => resolve({ dataUrl, name: origName });
    img.src = dataUrl;
  });
}
