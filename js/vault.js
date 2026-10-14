/* ============================================================
   vault.js — in-memory vault index over IndexedDB (Obs.vault)
   notes, attachments, links, backlinks, tags, aliases, search,
   rename with link-update, trash, settings.
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const U = Obs.util;
  const bus = Obs.bus;

  const DEFAULT_SETTINGS = {
    theme: 'dark',
    accent: '#8a7cf8',
    vaultName: 'My Vault',
    defaultMode: 'split',            // write | split | read
    dailyFolder: 'Daily',
    dailyFormat: 'YYYY-MM-DD',
    templateFolder: 'Templates',
    attachmentFolder: 'Attachments',
    syncScroll: true,
    updateLinksOnRename: true,
    editorFontSize: 15,
    monoEditor: false,
    showFrontmatter: true,
    newNoteFolder: ''                // '' = vault root
  };

  const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'];
  const TEXT_EXT = ['md', 'markdown', 'txt'];

  const vault = {
    settings: Object.assign({}, DEFAULT_SETTINGS),
    notes: new Map(),      // path -> note record
    files: new Map(),      // path -> file record {path, blob, url, type, size}
    trashCount: 0,
    ready: false,

    /* internal indexes */
    _byName: new Map(),    // lowercase basename w/o ext -> Set<path>
    _byAlias: new Map(),   // lowercase alias -> Set<path>
    _filesByName: new Map(),// lowercase filename -> path
    _backlinks: new Map(), // note path -> Set<source note path>
    _tagIndex: new Map(),  // tag -> Set<note path>
  };

  /* ---------------- helpers ---------------- */
  const isImagePath = p => IMG_EXT.includes(U.extName(p));
  const isNotePath = p => /\.(md|markdown)$/i.test(p);

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function makeNoteRecord(path, content, existing) {
    const now = U.nowIso();
    return {
      path,
      name: U.stripExt(U.baseName(path)),
      folder: U.dirName(path),
      content: content || '',
      created: existing ? existing.created : now,
      modified: now,
      starred: existing ? !!existing.starred : false,
      /* computed (not persisted as source of truth): */
      tags: [], aliases: [], links: [], headings: [], words: 0
    };
  }

  function addToMap(map, key, value) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  }
  function removeFromMap(map, key, value) {
    const s = map.get(key);
    if (s) { s.delete(value); if (!s.size) map.delete(key); }
  }

  /* ---------------- indexing ---------------- */
  function unindexNote(note) {
    removeFromMap(vault._byName, note.name.toLowerCase(), note.path);
    for (const a of note.aliases || []) removeFromMap(vault._byAlias, a.toLowerCase(), note.path);
    for (const t of note.tags || []) removeFromMap(vault._tagIndex, t, note.path);
    vault._backlinks.delete(note.path);
  }

  function indexNote(note) {
    const meta = Obs.md.extractMeta(note.content);
    note.tags = meta.tags;
    note.aliases = meta.aliases;
    note.links = meta.links;
    note.headings = meta.headings;
    note.words = meta.words;
    note.name = U.stripExt(U.baseName(note.path));
    note.folder = U.dirName(note.path);
    addToMap(vault._byName, note.name.toLowerCase(), note.path);
    for (const a of note.aliases) addToMap(vault._byAlias, a.toLowerCase(), note.path);
    for (const t of note.tags) addToMap(vault._tagIndex, t, note.path);
  }

  /** Resolve every note's links + (re)build the backlink index. */
  function rebuildLinks() {
    vault._backlinks.clear();
    for (const note of vault.notes.values()) {
      for (const l of note.links) {
        l.resolvedPath = l.target ? resolveTarget(l.target, note.path) : note.path;
        if (l.resolvedPath && l.resolvedPath !== note.path) {
          if (!vault._backlinks.has(l.resolvedPath)) vault._backlinks.set(l.resolvedPath, new Set());
          vault._backlinks.get(l.resolvedPath).add(note.path);
        }
      }
    }
  }

  /* ---------------- resolution ---------------- */
  /** Resolve a link target (no .md) to an existing note path, or null. */
  function resolveTarget(target, fromPath) {
    if (!target) return fromPath || null;
    let t = U.normalizePath(target);
    if (!t) return null;
    if (vault.notes.has(t)) return t;
    if (vault.notes.has(t + '.md')) return t + '.md';
    const lower = t.toLowerCase();
    const lowerNoExt = lower.replace(/\.(md|markdown)$/, '');
    const byName = vault._byName.get(lowerNoExt);
    if (byName && byName.size) return byName.values().next().value;
    const byAlias = vault._byAlias.get(lowerNoExt);
    if (byAlias && byAlias.size) return byAlias.values().next().value;
    // path suffix match ("folder/note" matches "a/b/folder/note.md")
    const suffix = '/' + lowerNoExt + '.md';
    for (const p of vault.notes.keys()) {
      if (p.toLowerCase().endsWith(suffix)) return p;
    }
    return null;
  }

  function resolveFileTarget(target) {
    let t = U.normalizePath(target);
    if (vault.files.has(t)) return vault.files.get(t);
    const f = vault._filesByName.get(t.toLowerCase());
    if (f) return vault.files.get(f);
    // try inside attachment folder
    const p2 = U.joinPath(vault.settings.attachmentFolder, U.baseName(t));
    if (vault.files.has(p2)) return vault.files.get(p2);
    return null;
  }

  /** For the markdown renderer: resolve to note / image / missing. */
  function resolveForRender(target) {
    if (!target) return { kind: 'missing' };
    const notePath = resolveTarget(target);
    if (notePath) return { kind: 'note', path: notePath, content: vault.notes.get(notePath).content };
    const f = resolveFileTarget(target);
    if (f) return { kind: 'image', path: f.path, url: f.url };
    return { kind: 'missing' };
  }

  /* ---------------- CRUD ---------------- */
  async function init() {
    const stored = await Obs.db.getMeta('settings');
    if (stored && typeof stored === 'object') {
      // Only copy known, primitive setting keys. This blocks prototype
      // pollution (__proto__ / constructor) from a tampered backup.
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.prototype.hasOwnProperty.call(stored, k)) continue;
        const v = stored[k];
        if (v === null || typeof v === 'object') continue;
        vault.settings[k] = v;
      }
    }
    await loadEmptyFolders();

    const notes = await Obs.db.getAllNotes();
    vault.notes.clear();
    for (const rec of notes) {
      const note = makeNoteRecord(rec.path, rec.content, rec);
      note.created = rec.created || note.created;
      note.modified = rec.modified || note.modified;
      note.starred = !!rec.starred;
      vault.notes.set(note.path, note);
      indexNote(note);
    }
    rebuildLinks();

    const files = await Obs.db.getAllFiles();
    vault.files.clear();
    vault._filesByName.clear();
    for (const rec of files) {
      const f = { path: rec.path, blob: rec.blob, type: rec.type || 'application/octet-stream', size: rec.size || (rec.blob && rec.blob.size) || 0, added: rec.added };
      if (typeof URL !== 'undefined' && URL.createObjectURL && f.blob) {
        try { f.url = URL.createObjectURL(f.blob); } catch (e) { f.url = ''; }
      } else f.url = '';
      vault.files.set(f.path, f);
      vault._filesByName.set(U.baseName(f.path).toLowerCase(), f.path);
    }

    vault.trashCount = (await Obs.db.getAllTrash()).length;
    vault.ready = true;
    bus.emit('vault:loaded');
  }

  function uniqueNotePath(folder, name) {
    const dir = U.normalizePath(folder || '');
    const base = U.sanitizePathComponent(name).replace(/\.(md|markdown)$/i, '');
    return U.uniquePath(dir, base, '.md', p => vault.notes.has(p));
  }

  async function createNote(nameOrPath, opts) {
    opts = opts || {};
    let path;
    if (opts.exactPath) path = U.safeRelPath(opts.exactPath) || 'Untitled';
    else if (nameOrPath && nameOrPath.includes('/')) path = U.safeRelPath(nameOrPath) || 'Untitled';
    else path = uniqueNotePath(opts.folder != null ? opts.folder : vault.settings.newNoteFolder, nameOrPath || 'Untitled');
    if (!/\.md$/i.test(path)) path += '.md';
    if (vault.notes.has(path)) return vault.notes.get(path);
    const note = makeNoteRecord(path, opts.content || '');
    vault.notes.set(path, note);
    indexNote(note);
    rebuildLinks();
    await Obs.db.putNote({ path: note.path, content: note.content, created: note.created, modified: note.modified, starred: note.starred });
    bus.emit('vault:changed', { type: 'create', path });
    return note;
  }

  /** Re-resolve only one note's links + its backlink edges (fast path for edits). */
  function relinkNote(note) {
    for (const [target, set] of vault._backlinks) {
      if (set.has(note.path)) { set.delete(note.path); if (!set.size) vault._backlinks.delete(target); }
    }
    for (const l of note.links) {
      l.resolvedPath = l.target ? resolveTarget(l.target, note.path) : note.path;
      if (l.resolvedPath && l.resolvedPath !== note.path) {
        if (!vault._backlinks.has(l.resolvedPath)) vault._backlinks.set(l.resolvedPath, new Set());
        vault._backlinks.get(l.resolvedPath).add(note.path);
      }
    }
  }

  /** Update content of an existing note (caller should debounce). */
  async function setContent(path, content) {
    const note = vault.notes.get(path);
    if (!note) return null;
    if (note.content === content) return note;
    const oldAliases = (note.aliases || []).slice().sort().join('|');
    note.content = content;
    note.modified = U.nowIso();
    indexNote(note);
    // alias changes can affect resolution of OTHER notes' links → full rebuild then
    const newAliases = (note.aliases || []).slice().sort().join('|');
    if (oldAliases !== newAliases) rebuildLinks();
    else relinkNote(note);
    await Obs.db.putNote({ path: note.path, content: note.content, created: note.created, modified: note.modified, starred: note.starred });
    bus.emit('note:content', { path });
    return note;
  }

  async function persistMeta(path) {
    const note = vault.notes.get(path);
    if (note) await Obs.db.putNote({ path: note.path, content: note.content, created: note.created, modified: note.modified, starred: note.starred });
  }

  async function toggleStar(path) {
    const note = vault.notes.get(path);
    if (!note) return false;
    note.starred = !note.starred;
    await persistMeta(path);
    bus.emit('vault:changed', { type: 'star', path });
    return note.starred;
  }

  /** Rename/move a note. Updates wikilink/md-link references when enabled. */
  async function renameNote(oldPath, newPathRaw, opts) {
    opts = opts || {};
    const note = vault.notes.get(oldPath);
    if (!note) throw new Error('Note not found: ' + oldPath);
    let newPath = U.safeRelPath(newPathRaw);
    if (!/\.md$/i.test(newPath)) newPath += '.md';
    if (newPath === oldPath) return note;
    if (vault.notes.has(newPath)) throw new Error('A note already exists at ' + newPath);

    const oldName = note.name;
    const oldNoExt = U.stripExt(oldPath);
    vault.notes.delete(oldPath);
    unindexNote(note);
    note.path = newPath;
    vault.notes.set(newPath, note);
    indexNote(note);

    if (vault.settings.updateLinksOnRename !== false && opts.updateLinks !== false) {
      const newName = U.stripExt(U.baseName(newPath));
      const newNoExt = U.stripExt(newPath);
      const oldLower = oldName.toLowerCase();
      for (const other of vault.notes.values()) {
        if (other.path === newPath) continue;
        let touched = false;
        let content = other.content;
        // wikilinks by name (any case) — keep alias / heading suffixes
        content = content.replace(/(!?)\[\[([^\[\]]+?)\]\]/g, (m, bang, inner) => {
          let targetPart = inner, aliasPart = null;
          const p = inner.indexOf('|');
          if (p >= 0) { targetPart = inner.slice(0, p); aliasPart = inner.slice(p); }
          let tp = targetPart, heading = '';
          const h = tp.indexOf('#');
          if (h >= 0) { heading = tp.slice(h); tp = tp.slice(0, h); }
          const t = tp.trim();
          if (t.toLowerCase() === oldLower || U.normalizePath(t).toLowerCase() === oldNoExt.toLowerCase()) {
            touched = true;
            return bang + '[[' + newName + heading + (aliasPart || '') + ']]';
          }
          return m;
        });
        // markdown-style links to the old path
        content = content.replace(new RegExp('\\]\\((' + escRe(oldPath) + '|' + escRe(oldNoExt) + ')(\\s|\\)|")', 'gi'), (m, g1, g2) => {
          touched = true;
          return '](' + (g1.toLowerCase().endsWith('.md') ? newPath : newNoExt) + g2;
        });
        if (touched) {
          other.content = content;
          other.modified = U.nowIso();
          indexNote(other);
          await Obs.db.putNote({ path: other.path, content: other.content, created: other.created, modified: other.modified, starred: other.starred });
        }
      }
    }

    rebuildLinks();
    await Obs.db.deleteNote(oldPath);
    await Obs.db.putNote({ path: note.path, content: note.content, created: note.created, modified: note.modified, starred: note.starred });
    bus.emit('vault:changed', { type: 'rename', path: newPath, oldPath });
    return note;
  }

  async function deleteNote(path) {
    const note = vault.notes.get(path);
    if (!note) return;
    await Obs.db.putTrash({
      path, kind: 'note', deleted: U.nowIso(),
      data: { path: note.path, content: note.content, created: note.created, modified: note.modified, starred: note.starred }
    });
    await Obs.db.deleteNote(path);
    vault.notes.delete(path);
    unindexNote(note);
    rebuildLinks();
    vault.trashCount++;
    bus.emit('vault:changed', { type: 'delete', path });
  }

  async function deleteFile(path) {
    const f = vault.files.get(path);
    if (!f) return;
    await Obs.db.putTrash({ path, kind: 'file', deleted: U.nowIso(), data: { path: f.path, blob: f.blob, type: f.type, size: f.size } });
    await Obs.db.deleteFile(path);
    if (f.url && typeof URL !== 'undefined') { try { URL.revokeObjectURL(f.url); } catch (e) { /* ignore */ } }
    vault.files.delete(path);
    vault._filesByName.delete(U.baseName(path).toLowerCase());
    vault.trashCount++;
    bus.emit('vault:changed', { type: 'delete-file', path });
  }

  async function renameFile(oldPath, newPath) {
    const f = vault.files.get(oldPath);
    if (!f) return null;
    newPath = U.safeRelPath(newPath);
    if (newPath === oldPath) return f;
    if (!newPath) throw new Error('Invalid file name');
    if (vault.files.has(newPath)) throw new Error('A file already exists at ' + newPath);
    const rec = { path: newPath, blob: f.blob, type: f.type, size: f.size, added: f.added };
    await Obs.db.putFile(rec);
    await Obs.db.deleteFile(oldPath);
    const nf = Object.assign({}, f, { path: newPath });
    vault.files.delete(oldPath);
    vault._filesByName.delete(U.baseName(oldPath).toLowerCase());
    vault.files.set(newPath, nf);
    vault._filesByName.set(U.baseName(newPath).toLowerCase(), newPath);
    bus.emit('vault:changed', { type: 'rename-file', path: newPath, oldPath });
    return nf;
  }

  async function addFileBlob(blob, suggestedPath, opts) {
    opts = opts || {};
    let path;
    if (opts.exactPath) {
      const safe = U.safeRelPath(opts.exactPath) || 'attachment';
      path = safe;
      let n = 2;
      while (vault.files.has(path)) {
        path = U.stripExt(safe) + ' ' + (n++) + '.' + (U.extName(safe) || 'bin');
      }
    } else {
      const dir = U.normalizePath(vault.settings.attachmentFolder || '');
      const base = U.sanitizePathComponent(U.baseName(suggestedPath || 'attachment.png'));
      path = U.uniquePath(dir, U.stripExt(base), '.' + (U.extName(base) || 'png'), p => vault.files.has(p));
    }
    const rec = { path, blob, type: blob.type || 'application/octet-stream', size: blob.size, added: U.nowIso() };
    await Obs.db.putFile(rec);
    const f = Object.assign({}, rec);
    try { f.url = typeof URL !== 'undefined' ? URL.createObjectURL(blob) : ''; } catch (e) { f.url = ''; }
    vault.files.set(path, f);
    vault._filesByName.set(U.baseName(path).toLowerCase(), path);
    bus.emit('vault:changed', { type: 'add-file', path });
    return f;
  }

  /* ---- trash ---- */
  async function listTrash() {
    const items = await Obs.db.getAllTrash();
    items.sort((a, b) => (b.deleted || '').localeCompare(a.deleted || ''));
    return items;
  }
  async function restoreFromTrash(path) {
    const rec = await Obs.db.getTrash(path);
    if (!rec) return;
    if (rec.kind === 'note') {
      let p = rec.data.path, n = 2;
      while (vault.notes.has(p)) { p = U.stripExt(rec.data.path) + ' (restored ' + (n++) + ').md'; }
      rec.data.path = p;
      await Obs.db.putNote(rec.data);
      const note = makeNoteRecord(p, rec.data.content, rec.data);
      note.starred = !!rec.data.starred;
      vault.notes.set(p, note);
      indexNote(note);
      rebuildLinks();
    } else {
      let p = rec.data.path, n = 2;
      const ext = U.extName(rec.data.path);
      while (vault.files.has(p)) { p = U.stripExt(rec.data.path) + ' (restored ' + (n++) + ')' + (ext ? '.' + ext : ''); }
      const f = { path: p, blob: rec.data.blob, type: rec.data.type, size: rec.data.size, added: U.nowIso() };
      await Obs.db.putFile(f);
      try { f.url = typeof URL !== 'undefined' ? URL.createObjectURL(f.blob) : ''; } catch (e) { f.url = ''; }
      vault.files.set(p, f);
      vault._filesByName.set(U.baseName(p).toLowerCase(), p);
    }
    await Obs.db.deleteTrash(path);
    vault.trashCount = Math.max(0, vault.trashCount - 1);
    bus.emit('vault:changed', { type: 'restore', path });
  }
  async function purgeTrash(path) {
    await Obs.db.deleteTrash(path);
    vault.trashCount = Math.max(0, vault.trashCount - 1);
    bus.emit('trash:changed');
  }
  async function emptyTrash() {
    await Obs.db.clearTrash();
    vault.trashCount = 0;
    bus.emit('trash:changed');
  }

  /* ---------------- queries ---------------- */
  function allNotes() { return Array.from(vault.notes.values()); }
  function getNote(path) { return vault.notes.get(path) || null; }

  function allTags() {
    const out = [];
    for (const [tag, set] of vault._tagIndex) out.push({ tag, count: set.size });
    out.sort((a, b) => a.tag.localeCompare(b.tag));
    return out;
  }

  function starredNotes() { return allNotes().filter(n => n.starred).sort((a, b) => U.sortAlpha(a.name, b.name)); }

  function backlinksFor(path) {
    const set = vault._backlinks.get(path);
    if (!set) return [];
    return Array.from(set).map(p => vault.notes.get(p)).filter(Boolean).sort((a, b) => U.sortAlpha(a.name, b.name));
  }

  function outgoingFor(path) {
    const note = vault.notes.get(path);
    if (!note) return [];
    const seen = new Set();
    const out = [];
    for (const l of note.links) {
      if (l.embed && l.target && isImagePath(l.target) && !resolveTarget(l.target)) continue; // image embeds handled separately
      const key = (l.resolvedPath || l.target || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ target: l.target, resolvedPath: l.resolvedPath || null, alias: l.alias, embed: !!l.embed });
    }
    return out;
  }

  /** One shared scan: snippet around first needle + its line number. */
  function locate(content, needles, radius) {
    radius = radius || 60;
    const lower = String(content).toLowerCase();
    const lines = String(content).split('\n');
    for (const nd of needles) {
      if (!nd) continue;
      const idx = lower.indexOf(nd.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - radius);
        const end = Math.min(content.length, idx + nd.length + radius);
        const snippet = (start > 0 ? '…' : '') + content.slice(start, end).replace(/\s+/g, ' ').trim() + (end < content.length ? '…' : '');
        let line = 0, pos = 0;
        while (line < lines.length && pos + lines[line].length < idx) { pos += lines[line].length + 1; line++; }
        return { snippet, line };
      }
    }
    return { snippet: '', line: null };
  }

  function linkSnippetsFor(sourceNote, targetPath, targetNote) {
    const needles = [];
    for (const l of sourceNote.links) {
      if (l.resolvedPath === targetPath) {
        needles.push('[[' + l.target);
        if (l.alias) needles.push('[[' + l.target + '|' + l.alias);
      }
    }
    needles.push('[[' + targetNote.name + ']]');
    return locate(sourceNote.content, needles, 70);
  }

  function unlinkedFor(path) {
    const note = vault.notes.get(path);
    if (!note || note.name.length < 3) return [];
    const linked = vault._backlinks.get(path) || new Set();
    const out = [];
    const needle = note.name.toLowerCase();
    for (const other of vault.notes.values()) {
      if (other.path === path || linked.has(other.path)) continue;
      const idx = other.content.toLowerCase().indexOf(needle);
      if (idx >= 0) {
        const loc = locate(other.content, [note.name], 70);
        out.push({ note: other, snippet: loc.snippet, line: loc.line });
      }
    }
    return out.sort((a, b) => U.sortAlpha(a.note.name, b.note.name));
  }

  function search(query, opts) {
    opts = opts || {};
    const results = [];
    if (!query) return results;
    let matcher;
    if (opts.regex) {
      // Guard against pathological user-supplied regexes.
      if (String(query).length > 500) return results;
      try { matcher = new RegExp(query, opts.caseSensitive ? 'g' : 'gi'); }
      catch (e) { return results; }
    } else {
      const q = opts.caseSensitive ? query : query.toLowerCase();
      matcher = null;
      var plain = q; // eslint-disable-line
    }
    const deadline = Date.now() + 3000;
    for (const note of vault.notes.values()) {
      if (Date.now() > deadline) break;
      const content = opts.caseSensitive ? note.content : note.content.toLowerCase();
      const name = opts.caseSensitive ? note.name : note.name.toLowerCase();
      const raw = note.content;
      let count = 0;
      const matches = [];
      if (matcher) {
        matcher.lastIndex = 0;
        const lines = raw.split('\n');
        for (let li = 0; li < lines.length; li++) {
          matcher.lastIndex = 0;
          let lm;
          while ((lm = matcher.exec(lines[li])) !== null) {
            count++;
            if (matches.length < 3) matches.push({ line: li, text: lines[li].trim(), start: lm.index, len: lm[0].length });
            if (lm.index === matcher.lastIndex) matcher.lastIndex++;
          }
        }
      } else {
        const lines = raw.split('\n');
        for (let li = 0; li < lines.length; li++) {
          const hay = opts.caseSensitive ? lines[li] : lines[li].toLowerCase();
          let from = 0, idx;
          while ((idx = hay.indexOf(plain, from)) >= 0) {
            count++;
            if (matches.length < 3) matches.push({ line: li, text: lines[li].trim(), start: idx, len: query.length });
            from = idx + Math.max(1, query.length);
          }
        }
        const nameHits = name.indexOf(plain) >= 0;
        if (nameHits && count === 0) { count = 1; matches.push({ line: -1, text: note.name, start: name.indexOf(plain), len: query.length }); }
        else if (nameHits) count += 2;
      }
      if (count > 0) results.push({ note, count, matches });
    }
    results.sort((a, b) => b.count - a.count || U.sortAlpha(a.note.name, b.note.name));
    return results;
  }

  /** Fuzzy file picker data for quick switcher. */
  function fuzzyFindNotes(query, limit) {
    const notes = allNotes();
    if (!query) {
      return notes.slice().sort((a, b) => (b.modified || '').localeCompare(a.modified || '')).slice(0, limit || 50);
    }
    const scored = [];
    for (const n of notes) {
      const byName = U.fuzzyScore(query, n.name);
      const s = byName != null ? byName * 2 : U.fuzzyScore(query, U.stripExt(n.path));
      if (s != null) scored.push({ note: n, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit || 50).map(s => s.note);
  }

  /* ---------------- special folders ---------------- */
  function dailyNotePath(date) {
    const d = date || new Date();
    const folder = U.sanitizePathComponent(vault.settings.dailyFolder || 'Daily');
    return U.joinPath(folder, U.fmtDate(d, vault.settings.dailyFormat || 'YYYY-MM-DD') + '.md');
  }

  function templateNotes() {
    const folder = U.normalizePath(vault.settings.templateFolder || 'Templates').toLowerCase();
    if (!folder) return [];
    return allNotes().filter(n => n.path.toLowerCase().startsWith(folder + '/'))
      .sort((a, b) => U.sortAlpha(a.name, b.name));
  }

  function renderTemplate(content, note) {
    const d = new Date();
    return String(content)
      .replace(/\{\{\s*date\s*(?:,\s*([^}]*?))?\s*\}\}/gi, (m, fmt) => U.fmtDate(d, fmt || 'YYYY-MM-DD'))
      .replace(/\{\{\s*time\s*(?:,\s*([^}]*?))?\s*\}\}/gi, (m, fmt) => U.fmtDate(d, fmt || 'HH:mm'))
      .replace(/\{\{\s*datetime\s*(?:,\s*([^}]*?))?\s*\}\}/gi, (m, fmt) => U.fmtDate(d, fmt || 'YYYY-MM-DD HH:mm'))
      .replace(/\{\{\s*title\s*\}\}/gi, note ? note.name : '');
  }

  /* ---------------- folders ---------------- */
  /** All distinct folders (from notes + files), as sorted list. */
  function allFolders() {
    const set = new Set();
    for (const p of vault.notes.keys()) { const d = U.dirName(p); if (d) { const parts = d.split('/'); for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/')); } }
    for (const p of vault.files.keys()) { const d = U.dirName(p); if (d) { const parts = d.split('/'); for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/')); } }
    // persisted empty folders
    for (const f of (vault._emptyFolders || [])) set.add(f);
    return Array.from(set).sort();
  }
  vault._emptyFolders = [];

  async function createFolder(folderPath) {
    const p = U.normalizePath(folderPath).split('/').map(U.sanitizePathComponent).join('/');
    if (!p) return null;
    if (!vault._emptyFolders.includes(p)) {
      vault._emptyFolders.push(p);
      await Obs.db.setMeta('emptyFolders', vault._emptyFolders);
      bus.emit('vault:changed', { type: 'folder', path: p });
    }
    return p;
  }
  async function loadEmptyFolders() {
    const f = await Obs.db.getMeta('emptyFolders');
    vault._emptyFolders = Array.isArray(f) ? f : [];
  }

  /* ---------------- settings ---------------- */
  async function saveSettings(patch) {
    if (patch) Object.assign(vault.settings, patch);
    await Obs.db.setMeta('settings', vault.settings);
    bus.emit('settings:changed', vault.settings);
  }

  /** Revoke every cached blob: object URL (call when the page is going away). */
  function releaseObjectUrls() {
    if (typeof URL === 'undefined' || !URL.revokeObjectURL) return;
    for (const f of vault.files.values()) {
      if (f.url) { try { URL.revokeObjectURL(f.url); } catch (e) { /* ignore */ } f.url = ''; }
    }
  }

  /* ---------------- stats ---------------- */
  function stats() {
    let words = 0;
    for (const n of vault.notes.values()) words += n.words || 0;
    let bytes = 0;
    for (const f of vault.files.values()) bytes += f.size || 0;
    for (const n of vault.notes.values()) bytes += n.content.length;
    return { notes: vault.notes.size, files: vault.files.size, words, bytes, tags: vault._tagIndex.size };
  }

  /** Path/folder completions for prompts (Tab-complete). */
  function completePaths(prefix) {
    const p = String(prefix || '').toLowerCase();
    const out = [];
    for (const f of allFolders()) if (f.toLowerCase().startsWith(p)) out.push(f);
    for (const n of vault.notes.values()) {
      const s = U.stripExt(n.path);
      if (s.toLowerCase().startsWith(p)) out.push(s);
    }
    out.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return out.slice(0, 40);
  }

  Object.assign(vault, {
    init, createNote, setContent, renameNote, deleteNote, deleteFile, renameFile, addFileBlob,
    toggleStar, listTrash, restoreFromTrash, purgeTrash, emptyTrash,
    allNotes, getNote, resolveTarget, resolveFileTarget, resolveForRender,
    allTags, starredNotes, backlinksFor, outgoingFor, unlinkedFor, linkSnippetsFor, locate,
    search, fuzzyFindNotes, dailyNotePath, templateNotes, renderTemplate,
    allFolders, createFolder, saveSettings, stats, persistMeta, completePaths,
    releaseObjectUrls,
    isImagePath, isNotePath, IMG_EXT, TEXT_EXT, DEFAULT_SETTINGS,
    makeNoteRecord, uniqueNotePath, rebuildLinks
  });

  Obs.vault = vault;
})(typeof window !== 'undefined' ? window : globalThis);
