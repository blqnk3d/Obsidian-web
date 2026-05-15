import { state, setContent, setFilename, setFileList, setSaveStatus, addImage, getExportData, loadImportData } from './state.js';

const DB_NAME = 'static-obsidian';
const DB_VERSION = 2;
const IMAGE_GRACE_MS = 60000;

let db = null;
const pendingDeletions = new Map();

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('vault')) {
        d.createObjectStore('vault', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('images')) {
        d.createObjectStore('images', { keyPath: 'name' });
      }
      if (!d.objectStoreNames.contains('files')) {
        d.createObjectStore('files', { keyPath: 'name' });
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

async function getAllFromDB(store) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function migrateFromVault() {
  const old = await loadFromDB('vault', 'note');
  if (!old) return;
  await saveFile(old.filename || 'untitled.md', old.content || '', old.updated_at);
}

export function listFiles() {
  return state.files;
}

export async function saveFile(name, content, timestamp) {
  const now = timestamp || new Date().toISOString();
  const data = { name, content, updated_at: now };
  await saveToDB('files', data);
  const idx = state.files.findIndex(f => f.name === name);
  if (idx >= 0) {
    state.files[idx] = { name, updated_at: now };
  } else {
    state.files.push({ name, updated_at: now });
  }
  setFileList(state.files);
  state.fileContents.set(name, content);
}

export async function loadFile(name) {
  const data = await loadFromDB('files', name);
  if (!data) return '';
  state.fileContents.set(name, data.content);
  return data.content;
}

export async function deleteFile(name) {
  state.fileContents.delete(name);
  state.files = state.files.filter(f => f.name !== name);
  setFileList(state.files);
  await deleteFromDB('files', name);
}

export async function renameFile(oldName, newName) {
  const content = state.fileContents.get(oldName) || '';
  const now = new Date().toISOString();
  state.fileContents.set(newName, content);
  state.fileContents.delete(oldName);
  await saveToDB('files', { name: newName, content, updated_at: now });
  await deleteFromDB('files', oldName);
  state.files = state.files.filter(f => f.name !== oldName);
  state.files.push({ name: newName, updated_at: now });
  setFileList(state.files);
}

export async function save() {
  setSaveStatus('saving');
  try {
    state.fileContents.set(state.filename, state.content);
    cleanupUnusedImages();
    await saveFile(state.filename, state.content);
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
  for (const content of state.fileContents.values()) {
    let m;
    while ((m = refRe.exec(content)) !== null) {
      const name = m[1].trim().split('|')[0];
      refs.add(name);
      pendingDeletions.delete(name);
    }
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
    const files = await getAllFromDB('files');
    if (files.length === 0) {
      await migrateFromVault();
      const retry = await getAllFromDB('files');
      if (retry.length > 0) {
        state.files = retry.map(f => ({ name: f.name, updated_at: f.updated_at }));
        for (const f of retry) state.fileContents.set(f.name, f.content);
      }
    } else {
      state.files = files.map(f => ({ name: f.name, updated_at: f.updated_at }));
      for (const f of files) state.fileContents.set(f.name, f.content);
    }

    setFileList(state.files);

    const sorted = [...state.files].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    const latest = sorted[0];

    if (latest) {
      const content = state.fileContents.get(latest.name) || '';
      setFilename(latest.name);
      setContent(content);
    } else {
      const name = nextUntitledName();
      setFilename(name);
      setContent('');
      state.fileContents.set(name, '');
      state.files.push({ name, updated_at: new Date().toISOString() });
      setFileList(state.files);
    }

    const imgStore = await getAllFromDB('images');
    for (const img of imgStore) {
      state.images.set(img.name, img.data);
    }

    setSaveStatus('saved');
  } catch (e) {
    console.error('Load failed:', e);
  }
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

export function nextUntitledName() {
  let idx = 0;
  const existing = new Set(state.files.map(f => f.name));
  while (true) {
    const name = idx === 0 ? 'untitled.md' : `untitled${idx}.md`;
    if (!existing.has(name)) return name;
    idx++;
  }
}

export async function clearStore(storeName) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function init() {
  await openDB();
  await load();
}
