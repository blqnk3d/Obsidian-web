/* ============================================================
   db.js — IndexedDB persistence layer (Obs.db)
   Stores: notes(path) · files(path) · trash(path) · meta(key)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};

  const DB_NAME = 'obsidian-web-vault';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB not available')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'path' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
        if (!db.objectStoreNames.contains('trash')) db.createObjectStore('trash', { keyPath: 'path' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is blocked — please close other tabs of this app.'));
    });
    return dbPromise;
  }

  function reqP(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function store(name, mode) {
    const db = await open();
    return db.transaction(name, mode || 'readonly').objectStore(name);
  }

  const db = {
    open,

    /* ---- notes ---- */
    async getAllNotes() { return reqP((await store('notes')).getAll()); },
    async getNote(path) { return reqP((await store('notes')).get(path)); },
    async putNote(note) { return reqP((await store('notes', 'readwrite')).put(note)); },
    async deleteNote(path) { return reqP((await store('notes', 'readwrite')).delete(path)); },

    /* ---- attachment files ---- */
    async getAllFiles() { return reqP((await store('files')).getAll()); },
    async getFile(path) { return reqP((await store('files')).get(path)); },
    async putFile(rec) { return reqP((await store('files', 'readwrite')).put(rec)); },
    async deleteFile(path) { return reqP((await store('files', 'readwrite')).delete(path)); },

    /* ---- trash ---- */
    async getAllTrash() { return reqP((await store('trash')).getAll()); },
    async getTrash(path) { return reqP((await store('trash')).get(path)); },
    async putTrash(rec) { return reqP((await store('trash', 'readwrite')).put(rec)); },
    async deleteTrash(path) { return reqP((await store('trash', 'readwrite')).delete(path)); },
    async clearTrash() { return reqP((await store('trash', 'readwrite')).clear()); },

    /* ---- meta (settings etc.) ---- */
    async getMeta(key) { const r = await reqP((await store('meta')).get(key)); return r ? r.value : undefined; },
    async setMeta(key, value) { return reqP((await store('meta', 'readwrite')).put({ key, value })); },

    /* ---- maintenance ---- */
    async wipeAll() {
      const d = await open();
      const names = Array.from(d.objectStoreNames);
      await new Promise((res, rej) => {
        const tx = d.transaction(names, 'readwrite');
        for (const n of names) tx.objectStore(n).clear();
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    },
    async estimateUsage() {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }
      return { usage: 0, quota: 0 };
    }
  };

  Obs.db = db;
})(typeof window !== 'undefined' ? window : globalThis);
