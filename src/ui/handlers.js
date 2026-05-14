import { storeImage, importVault, exportVault, save, deleteImage } from '../core/storage.js';
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
  filenameEl?.addEventListener('blur', () => {
    filenameEl.contentEditable = 'false';
    const name = filenameEl.textContent.trim() || 'untitled.md';
    if (!name.includes('.')) {
      filenameEl.textContent = name + '.md';
    }
    setFilename(filenameEl.textContent);
    save();
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

function processImageFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;
    let name = file.name;
    if (!name || !name.includes('.')) {
      const ext = MIME_EXT[file.type] || 'png';
      name = `pasted-image-${Date.now()}.${ext}`;
    }
    await storeImage(name, base64);
    insertAtCursor(`![[${name}]]`);
  };
  reader.readAsDataURL(file);
}
