import { state, setContent, setFilename, setSaveStatus, addImage, getExportData, loadImportData } from './state.js';

const DB_NAME = 'static-obsidian';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const IMAGE_GRACE_MS = 60000;

let db = null;
const pendingDeletions = new Map();

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('images')) {
        d.createObjectStore('images', { keyPath: 'name' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

async function saveToDB(store, data) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadFromDB(store, id) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromDB(store, id) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function save() {
  setSaveStatus('saving');
  try {
    cleanupUnusedImages();
    const data = {
      id: 'note',
      filename: state.filename,
      content: state.content,
      updated_at: new Date().toISOString(),
    };
    await saveToDB(STORE_NAME, data);
    for (const [name, base64] of state.images) {
      await saveToDB('images', { name, data: base64 });
    }
    setSaveStatus('saved');
  } catch (e) {
    setSaveStatus('error');
    console.error('Save failed:', e);
  }
}

function cleanupUnusedImages() {
  const refs = new Set();
  const refRe = /!\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = refRe.exec(state.content)) !== null) {
    const inner = m[1].trim();
    const name = inner.split('|')[0];
    refs.add(name);
    pendingDeletions.delete(name);
  }

  const now = Date.now();
  for (const name of state.images.keys()) {
    if (refs.has(name)) continue;
    if (pendingDeletions.has(name)) {
      if (now - pendingDeletions.get(name) >= IMAGE_GRACE_MS) {
        state.images.delete(name);
        deleteFromDB('images', name).catch(() => {});
        pendingDeletions.delete(name);
      }
    } else {
      pendingDeletions.set(name, now);
    }
  }
}

export async function load() {
  try {
    const data = await loadFromDB(STORE_NAME, 'note');
    if (data) {
      setFilename(data.filename || 'untitled.md');
      setContent(data.content || '');
      state.metadata = { updated_at: data.updated_at };
    }

    const imgStore = await loadAllImages();
    for (const img of imgStore) {
      state.images.set(img.name, img.data);
    }

    setSaveStatus('saved');
  } catch (e) {
    console.error('Load failed:', e);
  }
}

async function loadAllImages() {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly');
    const req = tx.objectStore('images').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export function exportVault() {
  const data = getExportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.filename.replace(/\.md$/, '')}-vault.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importVault(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      loadImportData(data);
      save();
    } catch (err) {
      console.error('Import failed:', err);
    }
  };
  reader.readAsText(file);
}

export async function deleteImage(name) {
  state.images.delete(name);
  await deleteFromDB('images', name);
}

export function storeImage(name, base64) {
  addImage(name, base64);
  return saveToDB('images', { name, data: base64 }).catch(console.error);
}

export async function init() {
  await openDB();
  await load();
}
