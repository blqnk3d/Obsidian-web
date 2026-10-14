/* ============================================================
   exportimport.js — vault export/import (Obs.io)
   ZIP (all files) · single .md · JSON backup · imports
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { baseName, extName, normalizePath, stripExt, joinPath, fmtDate, sanitizePathComponent, safeRelPath, downloadBytes, downloadText, downloadBlob, bytesToBase64, base64ToBytes, notice, escapeHtml } = Obs.util;
  const vault = () => Obs.vault;

  const APP_ID = 'obsidian-web';
  const FORMAT_VERSION = 1;
  const MAX_IMPORT_BYTES = 300 * 1024 * 1024;   // whole-backup cap
  const MAX_FILE_BYTES = 100 * 1024 * 1024;     // single attachment cap
  const MAX_IMPORT_ITEMS = 20000;

  /* ---------------- exports ---------------- */

  async function exportVaultZip() {
    const V = vault();
    notice('Building ZIP…', null, 1500);
    const entries = [];
    for (const note of V.notes.values()) entries.push({ path: note.path, data: note.content });
    for (const f of V.files.values()) if (f.blob) entries.push({ path: f.path, data: f.blob });
    entries.push({ path: '.obsidian-web/settings.json', data: JSON.stringify(V.settings, null, 2) });
    entries.push({
      path: '.obsidian-web/backup-info.json',
      data: JSON.stringify({ app: APP_ID, version: FORMAT_VERSION, exported: new Date().toISOString(), stats: V.stats() }, null, 2)
    });
    try {
      const bytes = await Obs.zip.buildZip(entries);
      const name = (sanitizePathComponent(V.settings.vaultName || 'vault').replace(/\s+/g, '-') || 'vault') + '-' + fmtDate(new Date(), 'YYYY-MM-DD') + '.zip';
      downloadBytes(name, bytes, 'application/zip');
      notice(`Exported ${entries.length} files → ${name}`, 'success', 3600);
    } catch (e) {
      console.error(e);
      notice('ZIP export failed: ' + e.message, 'error', 5000);
    }
  }

  function exportNoteMd(path) {
    const note = vault().getNote(path);
    if (!note) { notice('Note not found', 'error'); return; }
    downloadText(baseName(note.path), note.content, 'text/markdown;charset=utf-8');
    notice('Downloaded ' + baseName(note.path), 'success', 1800);
  }

  async function blobToBase64(blob) {
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }

  async function exportJson() {
    const V = vault();
    notice('Building backup…', null, 1500);
    const files = [];
    for (const f of V.files.values()) {
      if (!f.blob) continue;
      files.push({ path: f.path, type: f.type, size: f.size, data: await blobToBase64(f.blob) });
    }
    const data = {
      app: APP_ID,
      version: FORMAT_VERSION,
      exported: new Date().toISOString(),
      settings: V.settings,
      emptyFolders: V._emptyFolders || [],
      notes: [...V.notes.values()].map(n => ({ path: n.path, content: n.content, created: n.created, modified: n.modified, starred: n.starred })),
      files
    };
    const name = (sanitizePathComponent(V.settings.vaultName || 'vault').replace(/\s+/g, '-') || 'vault') + '-backup-' + fmtDate(new Date(), 'YYYY-MM-DD') + '.json';
    downloadText(name, JSON.stringify(data), 'application/json');
    notice('Backup exported: ' + name, 'success', 3200);
  }

  /* ---------------- imports ---------------- */

  function uniqueNotePathFor(path) {
    const V = vault();
    let p = path, n = 2;
    while (V.notes.has(p)) { p = stripExt(path) + ' ' + (n++) + '.md'; }
    return p;
  }

  async function importJsonFile(file) {
    if (file && file.size > MAX_IMPORT_BYTES) {
      notice('Backup is too large to import (max ' + Math.round(MAX_IMPORT_BYTES / 1048576) + ' MB)', 'error', 5000);
      return;
    }
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { notice('Invalid JSON file', 'error'); return; }
    if (!data || data.app !== APP_ID || !Array.isArray(data.notes)) {
      notice('Not an Obsidian Web backup file', 'error');
      return;
    }
    const V = vault();
    let imported = 0, skipped = 0;
    for (const n of data.notes) {
      if (imported + skipped >= MAX_IMPORT_ITEMS) { notice('Import limit reached', 'warning'); break; }
      if (!n || typeof n.path !== 'string') continue;
      const safe = safeRelPath(n.path);
      if (!safe) continue;
      let notePath = /\.(md|markdown)$/i.test(safe) ? safe : safe + '.md';
      if (V.notes.has(notePath)) { skipped++; continue; }
      const note = await V.createNote(null, { exactPath: notePath, content: n.content || '' });
      note.created = n.created || note.created;
      note.modified = n.modified || note.modified;
      note.starred = !!n.starred;
      await V.persistMeta(note.path);
      imported++;
    }
    for (const f of (data.files || [])) {
      if (imported + skipped >= MAX_IMPORT_ITEMS) { notice('Import limit reached', 'warning'); break; }
      if (!f || typeof f.path !== 'string' || typeof f.data !== 'string') continue;
      const safe = safeRelPath(f.path);
      if (!safe) continue;
      if (V.files.has(safe)) { skipped++; continue; }
      try {
        const bytes = base64ToBytes(f.data);
        if (bytes.length > MAX_FILE_BYTES) { skipped++; continue; }
        const blob = new Blob([bytes], { type: f.type || 'application/octet-stream' });
        await V.addFileBlob(blob, safe, { exactPath: safe });
        imported++;
      } catch (e) { skipped++; console.warn('file import failed', f.path, e); }
    }
    if (Array.isArray(data.emptyFolders)) {
      for (const fo of data.emptyFolders) {
        const safe = safeRelPath(fo);
        if (safe && !V._emptyFolders.includes(safe)) await V.createFolder(safe);
      }
    }
    notice(`Imported ${imported} item(s)${skipped ? `, skipped ${skipped}` : ''}`, 'success', 4000);
  }

  async function importFileList(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const V = vault();
    let notes = 0, images = 0, skipped = 0;
    const insertedImages = [];
    for (const f of files) {
      if (notes + images + skipped >= MAX_IMPORT_ITEMS) { notice('Import limit reached', 'warning'); break; }
      if (f.size > MAX_FILE_BYTES) { skipped++; continue; }
      const rel = safeRelPath(f.webkitRelativePath || f.name);
      if (!rel) { skipped++; continue; }
      const ext = extName(f.name);
      try {
        if (V.TEXT_EXT.includes(ext) || f.type === 'text/plain' || f.type === 'text/markdown') {
          let path = rel;
          if (/\.txt$/i.test(path)) path = path.replace(/\.txt$/i, '.md');
          if (!/\.(md|markdown)$/i.test(path)) path += '.md';
          const content = await f.text();
          await V.createNote(null, { exactPath: uniqueNotePathFor(path), content });
          notes++;
        } else if (V.IMG_EXT.includes(ext) || (f.type && f.type.startsWith('image/'))) {
          const stored = await V.addFileBlob(f, rel);
          images++;
          insertedImages.push(stored);
        } else skipped++;
      } catch (e) { skipped++; console.warn('import failed for', f.name, e); }
    }
    // If images were dropped directly onto an open note, embed them there
    if (insertedImages.length && Obs.tabs.active && Obs.tabs.active.type === 'note' && Obs.tabs.view && Obs.tabs.view.insertTemplate && images && notes === 0) {
      const view = Obs.tabs.view;
      for (const img of insertedImages) view.insertTemplate(`\n![[${baseName(img.path)}]]\n`);
      view.noteView && view.noteView.save();
    }
    notice(`Imported ${notes} note(s), ${images} image(s)${skipped ? `, skipped ${skipped}` : ''}`, 'success', 4000);
  }

  /* ---------------- PDF export (via print stylesheet) ---------------- */
  function preparePrintRoot(path) {
    const note = vault().getNote(path);
    const root = document.getElementById('print-root');
    if (!note || !root) return false;
    const html = Obs.md.render(note.content, {
      resolve: t => vault().resolveForRender(t),
      fromPath: note.path,
      renderProperties: true,
      interactive: false
    });
    Obs.sanitize.setHtml(root,
      '<div class="print-doc">' +
      `<div class="markdown-preview print-body">${html}</div></div>`);
    return true;
  }

  function startPrintSession() {
    document.body.classList.add('print-mode');
    const cleanup = () => {
      document.body.classList.remove('print-mode');
      const root = document.getElementById('print-root');
      if (root) root.innerHTML = '';
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    return cleanup;
  }

  function exportNotePdf(path) {
    if (!preparePrintRoot(path)) { notice('Note not found', 'error'); return; }
    startPrintSession();
    notice('Pick “Save as PDF” as the destination in the print dialog', null, 4500);
    setTimeout(() => {
      try { window.print(); }
      catch (e) { document.body.classList.remove('print-mode'); }
    }, 80);
  }

  // Manual Ctrl+P in the browser should also print the open note, not the app chrome
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeprint', () => {
      if (document.body.classList.contains('print-mode')) return;
      const t = Obs.tabs.active;
      if (t && t.type === 'note' && preparePrintRoot(t.path)) startPrintSession();
    });
  }

  /* Wire up the hidden file inputs */
  function bindInputs() {
    const filesInput = document.getElementById('import-files-input');
    const dirInput = document.getElementById('import-dir-input');
    const jsonInput = document.getElementById('import-json-input');
    if (filesInput) filesInput.addEventListener('change', e => { importFileList(e.target.files); e.target.value = ''; });
    if (dirInput) dirInput.addEventListener('change', e => { importFileList(e.target.files); e.target.value = ''; });
    if (jsonInput) jsonInput.addEventListener('change', e => { if (e.target.files[0]) importJsonFile(e.target.files[0]); e.target.value = ''; });
  }

  Obs.io = { exportVaultZip, exportNoteMd, exportNotePdf, exportJson, importJsonFile, importFileList, bindInputs };
})(typeof window !== 'undefined' ? window : globalThis);
