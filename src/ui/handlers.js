import { storeImage, importVault, exportVault } from '../core/storage.js';
import { insertAtCursor } from './editor.js';

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

function processImageFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;
    const name = file.name;
    await storeImage(name, base64);
    insertAtCursor(`![[${name}]]`);
  };
  reader.readAsDataURL(file);
}
