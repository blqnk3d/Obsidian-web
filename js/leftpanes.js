/* ============================================================
   leftpanes.js — explorer / search / tags panels (Obs.leftPane)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, qs, debounce, escapeHtml, sortAlpha, baseName, dirName, stripExt, extName, joinPath, normalizePath, sanitizePathComponent } = Obs.util;
  const ui = () => Obs.ui;
  const vault = () => Obs.vault;

  const LS_EXPANDED = 'obs-web-expanded';
  let expanded = new Set(JSON.parse(localStorage.getItem(LS_EXPANDED) || '[]'));
  let bookmarksOpen = JSON.parse(localStorage.getItem('obs-web-bm-open') || 'true');
  let currentPanel = 'files';
  let sortMode = localStorage.getItem('obs-web-sort') || 'name';
  const SORTS = [['name', 'Name (A → Z)'], ['name-desc', 'Name (Z → A)'], ['modified', 'Modified (newest first)'], ['created', 'Created (newest first)']];

  function saveExpanded() { localStorage.setItem(LS_EXPANDED, JSON.stringify([...expanded])); }

  /* ================= tree building ================= */
  function buildTree() {
    const root = { name: '', path: '', folders: new Map(), notes: [], files: [] };
    const ensureFolder = parts => {
      let cur = root, acc = '';
      for (const p of parts) {
        acc = acc ? acc + '/' + p : p;
        if (!cur.folders.has(p)) cur.folders.set(p, { name: p, path: acc, folders: new Map(), notes: [], files: [] });
        cur = cur.folders.get(p);
      }
      return cur;
    };
    for (const note of vault().notes.values()) {
      const f = note.folder ? ensureFolder(note.folder.split('/')) : root;
      f.notes.push(note);
    }
    for (const file of vault().files.values()) {
      const d = dirName(file.path);
      const f = d ? ensureFolder(d.split('/')) : root;
      f.files.push(file);
    }
    for (const folder of (vault()._emptyFolders || [])) ensureFolder(folder.split('/'));
    return root;
  }

  const fileIcon = name => {
    const e = extName(name);
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(e)) return 'image';
    return 'file';
  };

  /* ================= explorer ================= */
  function renderExplorer(content) {
    const tree = el('div.explorer-tree');
    const V = vault();

    if (!V.notes.size && !V.files.size) {
      content.appendChild(el('div.explorer-empty', { html: 'No files yet.<br>Create your first note or import existing ones.' }, [
        el('div', {}, [
          (() => { const b = el('button.btn.primary', { text: 'New note' }); b.addEventListener('click', () => Obs.commands.run('new-note')); return b; })(),
        ]),
        (() => { const b = el('button.btn', { text: 'Import .md files' }); b.addEventListener('click', () => Obs.commands.run('import-files')); return b; })(),
      ]));
      return;
    }

    // bookmarks section
    const starred = V.starredNotes();
    if (starred.length) {
      const bmBody = el('div');
      const header = el('div.tree-section-header', { html: `<span class="chev${bookmarksOpen ? ' open' : ''}">${ui().iconHtml('chevron-right', 11)}</span><span>${ui().iconHtml('star-filled', 11)}</span> Bookmarks <span class="t-count">${starred.length}</span>` });
      header.addEventListener('click', () => {
        bookmarksOpen = !bookmarksOpen;
        localStorage.setItem('obs-web-bm-open', JSON.stringify(bookmarksOpen));
        refresh();
      });
      tree.appendChild(header);
      if (bookmarksOpen) {
        for (const n of starred) bmBody.appendChild(noteItem(n));
        tree.appendChild(bmBody);
      }
    }

    renderFolder(buildTree(), tree);
    content.appendChild(tree);

    // drop onto background = move to vault root
    tree.addEventListener('dragover', e => {
      if (!Array.from(e.dataTransfer.types).includes('text/obs-path')) return;
      if (e.target.closest && e.target.closest('.tree-item.folder')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    tree.addEventListener('drop', e => {
      if (e.target.closest && e.target.closest('.tree-item.folder')) return;
      const p = e.dataTransfer.getData('text/obs-path');
      if (p) { e.preventDefault(); moveDropped(p, ''); }
    });

    // background context menu
    content.addEventListener('contextmenu', bgContextMenu);
  }

  function bgContextMenu(e) {
    if (e.target.closest('.tree-item')) return;
    e.preventDefault();
    ui().menu(e.clientX, e.clientY, [
      { label: 'New note', icon: 'file-plus', onClick: () => Obs.commands.run('new-note') },
      { label: 'New folder', icon: 'folder-plus', onClick: () => newFolderPrompt('') },
      { separator: true },
      { label: 'Import files…', icon: 'upload', onClick: () => Obs.commands.run('import-files') },
      { label: 'Import folder…', icon: 'folder-plus', onClick: () => Obs.commands.run('import-folder') },
    ]);
  }

  function noteItem(note) {
    const active = Obs.tabs.active && Obs.tabs.active.path === note.path;
    const item = el('div.tree-item.file' + (active ? '.active' : '') + (note.starred ? '.is-starred' : ''), { dataset: { path: note.path }, title: note.path }, [
      el('span.t-chev'),
      el('span.t-icon', { html: ui().iconHtml('file-text', 14) }),
      el('span.t-name', { text: note.name }),
      note.starred ? el('span.t-icon', { html: ui().iconHtml('star-filled', 11) }) : null
    ]);
    item.addEventListener('click', () => Obs.tabs.openNote(note.path));
    item.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); noteMenu(e, note); });
    makeDraggable(item, note.path);
    return item;
  }

  function fileItem(file) {
    const item = el('div.tree-item.file', { dataset: { filePath: file.path }, title: file.path }, [
      el('span.t-chev'),
      el('span.t-icon', { html: ui().iconHtml(fileIcon(file.path), 14) }),
      el('span.t-name', { text: baseName(file.path) })
    ]);
    item.addEventListener('click', () => {
      if (file.url) global.open(file.url, '_blank');
    });
    makeDraggable(item, file.path);
    item.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      ui().menu(e.clientX, e.clientY, [
        { label: 'Open in new tab', icon: 'external', onClick: () => file.url && global.open(file.url, '_blank') },
        { label: 'Download', icon: 'download', onClick: () => Obs.util.downloadBlob(baseName(file.path), file.blob) },
        { label: 'Copy path', icon: 'copy', onClick: () => Obs.util.copyText(file.path).then(() => Obs.util.notice('Path copied')) },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => {
            ui().confirm({ title: 'Delete file?', message: `“${file.path}” will be moved to the in-app trash.`, okText: 'Delete', danger: true, onConfirm: () => vault().deleteFile(file.path) });
          } },
      ]);
    });
    return item;
  }

  function noteMenu(e, note) {
    ui().menu(e.clientX, e.clientY, [
      { label: 'Open', icon: 'file-text', onClick: () => Obs.tabs.openNote(note.path) },
      { label: note.starred ? 'Remove bookmark' : 'Bookmark', icon: note.starred ? 'star' : 'star-filled', onClick: async () => { await vault().toggleStar(note.path); } },
      { label: 'Rename / move…', icon: 'pencil', hint: '', onClick: () => renamePrompt(note) },
      { label: 'Open local graph', icon: 'graph', onClick: () => Obs.tabs.openGraph({ rootPath: note.path, depth: 1 }) },
      { separator: true },
      { label: 'Download .md', icon: 'download', onClick: () => Obs.io.exportNoteMd(note.path) },
      { label: 'Export as PDF…', icon: 'file-text', onClick: () => Obs.io.exportNotePdf(note.path) },
      { label: 'Copy path', icon: 'copy', onClick: () => Obs.util.copyText(note.path).then(() => Obs.util.notice('Path copied')) },
      { separator: true },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => {
          ui().confirm({ title: 'Delete note?', message: `“${note.name}” will be moved to the in-app trash. Links from other notes will remain but become unresolved.`, okText: 'Delete', danger: true, onConfirm: async () => { await vault().deleteNote(note.path); Obs.util.notice('Moved to trash', 'success'); } });
        } },
    ]);
  }

  function folderMenu(e, f) {
    ui().menu(e.clientX, e.clientY, [
      { label: 'New note here', icon: 'file-plus', onClick: () => Obs.commands.run('new-note', { folder: f.path }) },
      { label: 'New subfolder', icon: 'folder-plus', onClick: () => newFolderPrompt(f.path) },
      { label: 'Rename folder…', icon: 'pencil', onClick: () => renameFolderPrompt(f.path) },
      { label: 'Copy path', icon: 'copy', onClick: () => navigator.clipboard && navigator.clipboard.writeText(f.path) },
      { separator: true },
      { label: 'Delete folder', icon: 'trash', danger: true, onClick: () => deleteFolderPrompt(f.path) },
    ]);
  }

  function noteCmp(a, b) {
    switch (sortMode) {
      case 'name-desc': return sortAlpha(b.name, a.name);
      case 'modified': return (b.modified || '').localeCompare(a.modified || '');
      case 'created': return (b.created || '').localeCompare(a.created || '');
      default: return sortAlpha(a.name, b.name);
    }
  }
  function fileCmp(a, b) {
    switch (sortMode) {
      case 'name-desc': return sortAlpha(baseName(b.path), baseName(a.path));
      case 'modified':
      case 'created': return (b.added || '').localeCompare(a.added || '');
      default: return sortAlpha(baseName(a.path), baseName(b.path));
    }
  }

  function renderFolder(node, container) {
    const folders = [...node.folders.values()].sort((a, b) => sortAlpha(a.name, b.name));
    for (const f of folders) {
      const open = expanded.has(f.path);
      const count = countIn(f);
      const item = el('div.tree-item.folder' + (open ? '.open' : ''), { dataset: { folder: f.path }, title: f.path }, [
        el('span.t-chev', { html: ui().iconHtml('chevron-right', 11) }),
        el('span.t-icon', { html: ui().iconHtml(open ? 'folder' : 'folder', 14) }),
        el('span.t-name', { text: f.name }),
        el('span.t-count', { text: String(count) })
      ]);
      item.addEventListener('click', () => {
        if (expanded.has(f.path)) expanded.delete(f.path); else expanded.add(f.path);
        saveExpanded();
        refresh();
      });
      item.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); folderMenu(e, f); });
      makeDropTarget(item, f.path);
      container.appendChild(item);
      const children = el('div.tree-children' + (open ? '' : '.collapsed'));
      renderFolder(f, children);
      container.appendChild(children);
    }
    const notes = node.notes.slice().sort(noteCmp);
    for (const n of notes) container.appendChild(noteItem(n));
    const files = node.files.slice().sort(fileCmp);
    for (const f of files) container.appendChild(fileItem(f));
  }

  function countIn(f) {
    let c = f.notes.length + f.files.length;
    for (const sub of f.folders.values()) c += countIn(sub);
    return c;
  }

  /* ---------- drag & drop: move notes/files between folders ---------- */
  function makeDraggable(item, path) {
    item.draggable = true;
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/obs-path', path);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  }

  function makeDropTarget(item, folderPath) {
    item.addEventListener('dragover', e => {
      if (!Array.from(e.dataTransfer.types).includes('text/obs-path')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drop-target');
      const p = e.dataTransfer.getData('text/obs-path');
      if (p) moveDropped(p, folderPath);
    });
  }

  async function moveDropped(path, folder) {
    const V = vault();
    const name = baseName(path);
    const target = joinPath(folder || '', name);
    if (target === path) return;
    const exists = V.notes.has(target) || V.files.has(target);
    if (exists) { Obs.util.notice(`Something named “${name}” already exists in ${folder || 'the vault root'}`, 'error'); return; }
    try {
      if (V.notes.has(path)) await V.renameNote(path, target);
      else if (V.files.has(path)) await V.renameFile(path, target);
      else return;
      Obs.util.notice(`Moved to ${folder || 'vault root'}`, 'success');
      reveal(target);
    } catch (err) { Obs.util.notice(err.message, 'error'); }
  }

  /* ---------- prompts / operations ---------- */
  function newFolderPrompt(parent) {
    ui().prompt({
      title: 'New folder', label: parent ? `Inside “${parent}”` : 'Folder name (Tab completes)', placeholder: 'Folder name',
      completions: v => vault().completePaths(v),
      validate: v => !v ? 'Name required' : null,
      onSubmit: async v => {
        const p = v.split('/').map(sanitizePathComponent).filter(Boolean).join('/');
        await vault().createFolder(parent ? joinPath(parent, p) : p);
        const full = parent ? joinPath(parent, p) : p;
        full.split('/').reduce((acc, part) => { acc = acc ? acc + '/' + part : part; expanded.add(acc); return acc; }, '');
        saveExpanded();
        refresh();
      }
    });
  }

  function renamePrompt(note) {
    ui().prompt({
      title: 'Rename / move note', label: 'Path (folders allowed, no .md needed) — Tab completes', value: stripExt(note.path),
      completions: v => vault().completePaths(v),
      validate: v => {
        if (!v) return 'Name required';
        let p = normalizePath(v); if (!/\.md$/i.test(p)) p += '.md';
        if (p !== note.path && vault().notes.has(p)) return 'Another note already exists there';
        return null;
      },
      onSubmit: async v => {
        try {
          await vault().renameNote(note.path, v);
          Obs.util.notice('Renamed & links updated', 'success');
        } catch (err) { Obs.util.notice(err.message, 'error'); }
      }
    });
  }

  function renameFolderPrompt(oldFolder) {
    ui().prompt({
      title: 'Rename folder', label: 'New path (Tab completes)', value: oldFolder,
      completions: v => vault().completePaths(v),
      validate: v => !v ? 'Name required' : null,
      onSubmit: async v => {
        const newFolder = normalizePath(v).split('/').map(sanitizePathComponent).filter(Boolean).join('/');
        if (!newFolder || newFolder === oldFolder) return;
        const V = vault();
        const prefix = oldFolder + '/';
        const notes = [...V.notes.values()].filter(n => n.path.startsWith(prefix));
        const files = [...V.files.values()].filter(f => f.path.startsWith(prefix));
        for (const n of notes) await V.renameNote(n.path, joinPath(newFolder, n.path.slice(prefix.length)));
        for (const f of files) await V.renameFile(f.path, joinPath(newFolder, f.path.slice(prefix.length)));
        if (V._emptyFolders.includes(oldFolder)) {
          V._emptyFolders = V._emptyFolders.map(p => p === oldFolder ? newFolder : p.startsWith(prefix) ? joinPath(newFolder, p.slice(prefix.length)) : p);
          await Obs.db.setMeta('emptyFolders', V._emptyFolders);
        }
        expanded.delete(oldFolder); expanded.add(newFolder); saveExpanded();
        Obs.bus.emit('vault:changed', { type: 'folder-rename' });
        refresh();
        Obs.util.notice('Folder renamed', 'success');
      }
    });
  }

  function deleteFolderPrompt(folder) {
    const V = vault();
    const prefix = folder + '/';
    const notes = [...V.notes.values()].filter(n => n.path.startsWith(prefix));
    const files = [...V.files.values()].filter(f => f.path.startsWith(prefix));
    ui().confirm({
      title: 'Delete folder?', danger: true, okText: 'Delete',
      message: `“${folder}” contains ${notes.length} note(s) and ${files.length} attachment(s). Everything will be moved to the in-app trash.`,
      onConfirm: async () => {
        for (const n of notes) await V.deleteNote(n.path);
        for (const f of files) await V.deleteFile(f.path);
        V._emptyFolders = (V._emptyFolders || []).filter(p => p !== folder && !p.startsWith(prefix));
        await Obs.db.setMeta('emptyFolders', V._emptyFolders);
        expanded.delete(folder); saveExpanded();
        refresh();
        Obs.util.notice('Folder moved to trash', 'success');
      }
    });
  }

  /** Expand ancestors of a path + refresh. */
  function reveal(path) {
    const parts = path.split('/');
    parts.pop();
    let acc = '';
    for (const p of parts) { acc = acc ? acc + '/' + p : p; expanded.add(acc); }
    saveExpanded();
    refresh();
    setTimeout(() => {
      const item = qs(`#left-panel-content .tree-item[data-path="${global.CSS && CSS.escape ? CSS.escape(path) : path}"]`);
      if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
    }, 30);
  }

  /* ================= search pane ================= */
  let searchOpts = { regex: false, caseSensitive: false };

  function renderSearch(content) {
    const pane = el('div.search-pane');
    const input = el('input.input', { type: 'text', placeholder: 'Search all notes…  ( / regex )', id: 'search-input' });
    const mkToggle = (iconName, title, key) => {
      const b = el('button.icon-btn' + (searchOpts[key] ? '.on' : ''), { html: ui().iconHtml(iconName, 13), title });
      b.addEventListener('click', () => { searchOpts[key] = !searchOpts[key]; b.classList.toggle('on', searchOpts[key]); runSearch(); });
      return b;
    };
    const toggles = el('div.search-toggles', {}, [
      mkToggle('case-sensitive', 'Match case', 'caseSensitive'),
      mkToggle('regex', 'Regular expression', 'regex')
    ]);
    const meta = el('div.search-meta');
    const results = el('div.search-results');
    pane.appendChild(el('div.search-input-row', {}, [input, toggles]));
    pane.appendChild(meta);
    pane.appendChild(results);
    content.appendChild(pane);

    const run = debounce(() => runSearchInto(input.value, meta, results), 160);
    input.addEventListener('input', run);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const first = results.querySelector('.search-result');
        if (first) first.click();
      }
      if (e.key === 'Escape') { input.value = ''; runSearch(); }
    });
    searchState = { input, meta, results };
    setTimeout(() => input.focus(), 30);
    if (input.value) runSearch();
  }

  let searchState = null;
  function runSearch() {
    if (!searchState) return;
    runSearchInto(searchState.input.value, searchState.meta, searchState.results);
  }

  function runSearchInto(query, metaEl, resultsEl) {
    resultsEl.innerHTML = '';
    query = query.trim();
    if (!query) { metaEl.textContent = `${vault().notes.size} notes in vault`; return; }
    if (searchOpts.regex) {
      if (query.length > 500) { metaEl.textContent = 'Regex too long (max 500 characters)'; return; }
      try { new RegExp(query); } catch (e) { metaEl.textContent = 'Invalid regex: ' + e.message; return; }
    }
    const results = vault().search(query, searchOpts);
    metaEl.textContent = `${results.length} note${results.length === 1 ? '' : 's'} · ${results.reduce((a, r) => a + r.count, 0)} matches`;
    for (const r of results.slice(0, 100)) {
      const item = el('div.search-result', {}, [
        el('div.sr-title', {}, [
          el('span', { html: ui().iconHtml('file-text', 12) }),
          el('span', { text: r.note.name }),
          el('span.sr-count', { text: r.count + (r.count === 1 ? ' match' : ' matches') })
        ]),
        r.note.folder ? el('div.sr-path', { text: r.note.folder }) : null,
        el('div.sr-snippet', { html: r.matches.slice(0, 2).map(m => markMatches(m.text, query)).join('<br>') })
      ]);
      item.addEventListener('click', () => Obs.tabs.openNote(r.note.path));
      resultsEl.appendChild(item);
    }
  }

  function markMatches(text, query) {
    const matches = [];
    if (searchOpts.regex) {
      if (String(query).length > 500) query = String(query).slice(0, 500);
      try {
        const re = new RegExp(query, searchOpts.caseSensitive ? 'g' : 'gi');
        let m;
        while ((m = re.exec(text)) !== null) { matches.push({ start: m.index, len: m[0].length }); if (matches.length > 20) break; if (!m[0].length) re.lastIndex++; }
      } catch (e) { /* ignore */ }
    } else {
      const hay = searchOpts.caseSensitive ? text : text.toLowerCase();
      const q = searchOpts.caseSensitive ? query : query.toLowerCase();
      let from = 0, idx;
      while ((idx = hay.indexOf(q, from)) >= 0) { matches.push({ start: idx, len: q.length }); from = idx + Math.max(1, q.length); if (matches.length > 20) break; }
    }
    let out = '', last = 0;
    for (const m of matches) {
      out += escapeHtml(text.slice(last, m.start)) + '<mark>' + escapeHtml(text.substr(m.start, m.len)) + '</mark>';
      last = m.start + m.len;
    }
    out += escapeHtml(text.slice(last));
    return out;
  }

  /* ================= tags pane ================= */
  function renderTags(content) {
    const pane = el('div.tags-pane');
    const tags = vault().allTags();
    if (!tags.length) {
      pane.appendChild(el('div.right-empty', { html: 'No tags yet.<br>Use <code>#tag</code> in your notes or <code>tags:</code> in frontmatter.' }));
      content.appendChild(pane);
      return;
    }
    for (const t of tags) {
      const row = el('div.tag-row', { title: 'Search #' + t.tag }, [
        el('span.tg-icon', { html: ui().iconHtml('hash', 13) }),
        el('span.tg-name', { text: '#' + t.tag }),
        el('span.tg-count', { text: String(t.count) })
      ]);
      row.addEventListener('click', () => {
        setPanel('search');
        searchFor('#' + t.tag);
      });
      pane.appendChild(row);
    }
    content.appendChild(pane);
  }

  /* ================= panel controller ================= */
  const TITLES = { files: 'Files', search: 'Search', tags: 'Tags' };

  function setPanel(name) {
    currentPanel = name;
    qs('#left-panel-title').textContent = TITLES[name] || name;
    const actions = qs('#left-panel-actions');
    actions.innerHTML = '';
    if (name === 'files') {
      const b1 = el('button.icon-btn', { html: ui().iconHtml('file-plus', 14), title: 'New note' });
      b1.addEventListener('click', () => Obs.commands.run('new-note'));
      const b2 = el('button.icon-btn', { html: ui().iconHtml('folder-plus', 14), title: 'New folder' });
      b2.addEventListener('click', () => newFolderPrompt(lastSelectedFolder()));
      const b3 = el('button.icon-btn', { html: ui().iconHtml('chevron-left', 14), title: 'Collapse all folders' });
      b3.addEventListener('click', () => { expanded.clear(); saveExpanded(); refresh(); });
      const b4 = el('button.icon-btn', { html: ui().iconHtml('sort', 14), title: 'Sort notes…' });
      b4.addEventListener('click', () => {
        ui().menu(null, null, SORTS.map(([id, label]) => ({
          label, icon: sortMode === id ? 'check' : '',
          onClick: () => { sortMode = id; localStorage.setItem('obs-web-sort', id); refresh(); }
        })), { anchor: b4, align: 'right' });
      });
      actions.append(b1, b2, b3, b4);
    }
    refresh();
    // ribbon highlight
    document.querySelectorAll('#ribbon .ribbon-btn[data-side]').forEach(b => b.classList.toggle('active', b.dataset.side === name));
    if (global.innerWidth <= 760) document.getElementById('app').classList.remove('left-collapsed');
  }

  function lastSelectedFolder() {
    const active = Obs.tabs.active;
    if (active && active.path) return dirName(active.path);
    return vault().settings.newNoteFolder || '';
  }

  function refresh() {
    const content = qs('#left-panel-content');
    if (!content) return;
    content.innerHTML = '';
    content.removeEventListener('contextmenu', bgContextMenu);
    if (currentPanel === 'files') renderExplorer(content);
    else if (currentPanel === 'search') renderSearch(content);
    else if (currentPanel === 'tags') renderTags(content);
  }

  function searchFor(q) {
    setPanel('search');
    setTimeout(() => {
      if (searchState) { searchState.input.value = q; runSearch(); }
    }, 10);
  }

  /* refresh hooks */
  Obs.bus.on('vault:changed', () => { if (currentPanel === 'files' || currentPanel === 'tags') debounceRefresh(); });
  Obs.bus.on('note:content', () => { if (currentPanel === 'search') debounceSearchRefresh(); });
  Obs.bus.on('tab:activated', () => { if (currentPanel === 'files') refresh(); });
  const debounceRefresh = debounce(refresh, 120);
  const debounceSearchRefresh = debounce(() => runSearch(), 400);

  Obs.leftPane = { setPanel, refresh, searchFor, reveal, get currentPanel() { return currentPanel; } };
})(typeof window !== 'undefined' ? window : globalThis);
