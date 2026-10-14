/* ============================================================
   commands.js — command registry + keyboard shortcuts
   (Obs.commands)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { stripExt, qs } = Obs.util;
  const ui = () => Obs.ui;
  const vault = () => Obs.vault;

  const commands = [];
  const byId = new Map();

  function register(list) {
    for (const c of list) {
      if (byId.has(c.id)) continue;
      commands.push(c);
      byId.set(c.id, c);
    }
  }

  function activeNoteView() {
    const v = Obs.tabs.view;
    const t = Obs.tabs.active;
    return v && t && t.type === 'note' ? v.noteView : null;
  }
  function activeNote() {
    const t = Obs.tabs.active;
    return t && t.type === 'note' ? vault().getNote(t.path) : null;
  }
  const whenNote = () => !!activeNote();
  const whenEditor = () => !!activeNoteView();
  const whenNotTyping = () => {
    const a = document.activeElement;
    return !(a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable));
  };

  function run(id, ctx) {
    const c = byId.get(id);
    if (!c) { console.warn('Unknown command', id); return; }
    if (c.when && !c.when()) { Obs.util.notice(c.whenMessage || 'Not available right now', 'warning'); return; }
    try { c.run(ctx || {}); } catch (e) { console.error('[command]', id, e); Obs.util.notice('Command failed: ' + e.message, 'error'); }
  }

  function comboFromEvent(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    parts.push(e.key.toLowerCase());
    return parts.join('+');
  }

  function handleKey(e) {
    if (ui().openModals.length) return false; // modals own the keyboard
    const combo = comboFromEvent(e);
    for (const c of commands) {
      if (c.hotkey === combo) {
        if (c.when && !c.when()) continue;
        e.preventDefault();
        run(c.id);
        return true;
      }
    }
    return false;
  }

  /* ================= command definitions ================= */
  register([
    {
      id: 'new-note', name: 'New note', icon: 'file-plus', hotkey: 'ctrl+alt+n', hotkeyLabel: 'Ctrl+Alt+N',
      run: ctx => {
        const folder = ctx.folder != null ? ctx.folder : (vault().settings.newNoteFolder || '');
        ui().prompt({
          title: 'New note', label: folder ? `Name (inside “${folder}”)` : 'Note name (Tab completes paths)', placeholder: 'Untitled',
          completions: v => vault().completePaths(v),
          validate: v => !v ? 'Name required' : null,
          onSubmit: async v => {
            const note = await vault().createNote(v, { folder });
            Obs.tabs.openNote(note.path);
            setTimeout(() => { const nv = activeNoteView(); if (nv) nv.focusEditor(); }, 30);
          }
        });
      }
    },
    { id: 'open-command-palette', name: 'Command palette', icon: 'command', hotkey: 'ctrl+p', hotkeyLabel: 'Ctrl+P', run: () => Obs.palette.openCommands() },
    { id: 'quick-switcher', name: 'Quick switcher: open note', icon: 'search', hotkey: 'ctrl+o', hotkeyLabel: 'Ctrl+O', run: () => Obs.palette.openSwitcher() },
    {
      id: 'toggle-mode', name: 'Cycle view mode (write / split / read)', icon: 'columns', hotkey: 'ctrl+e', hotkeyLabel: 'Ctrl+E', when: whenEditor,
      run: () => activeNoteView().cycleMode()
    },
    {
      id: 'set-mode-write', name: 'View mode: writing', icon: 'pencil', when: whenEditor, hidden: true, run: () => activeNoteView().setMode('write')
    },
    {
      id: 'set-mode-split', name: 'View mode: split', icon: 'columns', when: whenEditor, hidden: true, run: () => activeNoteView().setMode('split')
    },
    {
      id: 'set-mode-read', name: 'View mode: reading', icon: 'book', when: whenEditor, hidden: true, run: () => activeNoteView().setMode('read')
    },
    { id: 'open-graph', name: 'Graph view: open global graph', icon: 'graph', hotkey: 'ctrl+g', hotkeyLabel: 'Ctrl+G', run: () => Obs.tabs.openGraph({}) },
    {
      id: 'open-local-graph', name: 'Graph view: open local graph', icon: 'graph', when: whenNote,
      run: () => Obs.tabs.openGraph({ rootPath: Obs.tabs.active.path, depth: 1 })
    },
    {
      id: 'daily-note', name: 'Daily note: open today’s note', icon: 'calendar', hotkey: 'ctrl+alt+d', hotkeyLabel: 'Ctrl+Alt+D',
      run: async () => {
        const path = vault().dailyNotePath();
        if (!vault().getNote(path)) await vault().createNote(null, { exactPath: path, content: '' });
        Obs.tabs.openNote(path);
      }
    },
    {
      id: 'random-note', name: 'Open random note', icon: 'dice',
      run: () => {
        const notes = vault().allNotes();
        if (!notes.length) { Obs.util.notice('No notes yet', 'warning'); return; }
        Obs.tabs.openNote(notes[Math.floor(Math.random() * notes.length)].path);
      }
    },
    {
      id: 'insert-template', name: 'Templates: insert template', icon: 'template', when: whenEditor,
      run: () => Obs.palette.openTemplates(tpl => {
        const note = activeNote();
        const content = vault().renderTemplate(tpl.content, note);
        activeNoteView().insertAtCursor(content);
        Obs.util.notice('Inserted “' + tpl.name + '”', 'success');
      })
    },
    {
      id: 'toggle-bookmark', name: 'Bookmark: toggle for current note', icon: 'star', when: whenNote,
      run: async () => {
        const on = await vault().toggleStar(Obs.tabs.active.path);
        Obs.util.notice(on ? 'Bookmarked' : 'Bookmark removed');
      }
    },
    {
      id: 'rename-note', name: 'Rename / move current note', icon: 'pencil', hotkey: 'f2', hotkeyLabel: 'F2', when: whenNote,
      run: () => {
        const note = activeNote();
        ui().prompt({
          title: 'Rename / move note', label: 'Path (folders allowed, .md optional) — Tab completes', value: stripExt(note.path),
          completions: v => vault().completePaths(v),
          validate: v => {
            if (!v) return 'Name required';
            let p = Obs.util.normalizePath(v); if (!/\.md$/i.test(p)) p += '.md';
            if (p !== note.path && vault().notes.has(p)) return 'Another note already exists there';
            return null;
          },
          onSubmit: async v => {
            try { await vault().renameNote(note.path, v); Obs.util.notice('Renamed & links updated', 'success'); }
            catch (err) { Obs.util.notice(err.message, 'error'); }
          }
        });
      }
    },
    {
      id: 'delete-note', name: 'Delete current note (to trash)', icon: 'trash', when: whenNote,
      run: () => {
        const note = activeNote();
        ui().confirm({
          title: 'Delete note?', danger: true, okText: 'Delete',
          message: `“${note.name}” will be moved to the in-app trash (recoverable from Settings → Data).`,
          onConfirm: async () => { await vault().deleteNote(note.path); Obs.util.notice('Moved to trash', 'success'); }
        });
      }
    },
    { id: 'download-note', name: 'Download current note (.md)', icon: 'download', when: whenNote, run: () => Obs.io.exportNoteMd(Obs.tabs.active.path) },
    {
      id: 'copy-note-path', name: 'Copy path of current note', icon: 'copy', when: whenNote,
      run: () => Obs.util.copyText(Obs.tabs.active.path).then(() => Obs.util.notice('Path copied'))
    },
    {
      id: 'export-pdf', name: 'Export current note as PDF…', icon: 'file-text', when: whenNote,
      run: () => Obs.io.exportNotePdf(Obs.tabs.active.path)
    },
    {
      id: 'save-note', name: 'Save current note now', icon: 'save', hotkey: 'ctrl+s', hotkeyLabel: 'Ctrl+S', when: whenEditor,
      run: async () => { await activeNoteView().saveNow(); Obs.util.notice('Note saved to IndexedDB', 'success', 1400); }
    },
    { id: 'editor-bold', name: 'Format: bold', icon: 'bold', hotkey: 'ctrl+b', hotkeyLabel: 'Ctrl+B', when: whenEditor, run: () => activeNoteView().wrap('**', '**', 'bold text') },
    { id: 'editor-duplicate-line', name: 'Edit: duplicate line(s)', icon: 'copy', hotkey: 'ctrl+d', hotkeyLabel: 'Ctrl+D', when: whenEditor, run: () => activeNoteView().duplicateLine() },
    { id: 'editor-move-line-up', name: 'Edit: move line(s) up', icon: 'arrow-up', hotkey: 'alt+arrowup', hotkeyLabel: 'Alt+↑', when: whenEditor, run: () => activeNoteView().moveLine(-1) },
    { id: 'editor-move-line-down', name: 'Edit: move line(s) down', icon: 'arrow-down', hotkey: 'alt+arrowdown', hotkeyLabel: 'Alt+↓', when: whenEditor, run: () => activeNoteView().moveLine(1) },
    { id: 'editor-delete-line', name: 'Edit: delete line(s)', icon: 'trash', hotkey: 'ctrl+shift+k', hotkeyLabel: 'Ctrl+Shift+K', when: whenEditor, run: () => activeNoteView().deleteLine() },
    { id: 'insert-date', name: 'Insert current date', icon: 'calendar', when: whenEditor, run: () => activeNoteView().insertAtCursor(Obs.util.fmtDate(new Date(), Obs.vault.settings.dailyFormat || 'YYYY-MM-DD')) },
    { id: 'insert-time', name: 'Insert current time', icon: 'clock', when: whenEditor, run: () => activeNoteView().insertAtCursor(Obs.util.fmtDate(new Date(), 'HH:mm')) },
    { id: 'reopen-closed-tab', name: 'Reopen closed tab', icon: 'restore', hotkey: 'ctrl+shift+t', hotkeyLabel: 'Ctrl+Shift+T', run: () => Obs.tabs.reopenClosed() },
    { id: 'find-in-note', name: 'Find in note', icon: 'search', hotkey: 'ctrl+f', hotkeyLabel: 'Ctrl+F', when: whenEditor, run: () => activeNoteView().openFind(false) },
    { id: 'replace-in-note', name: 'Find & replace in note', icon: 'replace', hotkey: 'ctrl+h', hotkeyLabel: 'Ctrl+H', when: whenEditor, run: () => activeNoteView().openFind(true) },
    { id: 'editor-italic', name: 'Format: italic', icon: 'italic', hotkey: 'ctrl+i', hotkeyLabel: 'Ctrl+I', when: whenEditor, run: () => activeNoteView().wrap('*', '*', 'italic') },
    { id: 'editor-highlight', name: 'Format: highlight', icon: 'highlighter', when: whenEditor, run: () => activeNoteView().wrap('==', '==', 'highlight') },
    { id: 'editor-link', name: 'Insert internal link', icon: 'link', hotkey: 'ctrl+k', hotkeyLabel: 'Ctrl+K', when: whenEditor, run: () => activeNoteView().insertLink() },
    { id: 'focus-search', name: 'Search in all notes', icon: 'search', hotkey: 'ctrl+shift+f', hotkeyLabel: 'Ctrl+Shift+F', run: () => { Obs.leftPane.setPanel('search'); } },
    { id: 'show-tags', name: 'Show tags panel', icon: 'hash', run: () => Obs.leftPane.setPanel('tags') },
    { id: 'show-files', name: 'Show file explorer', icon: 'folder', run: () => Obs.leftPane.setPanel('files') },
    {
      id: 'toggle-left-sidebar', name: 'Toggle left sidebar', icon: 'panel-left', hotkey: 'ctrl+alt+l', hotkeyLabel: 'Ctrl+Alt+L',
      run: () => qs('#app').classList.toggle('left-collapsed')
    },
    {
      id: 'toggle-right-sidebar', name: 'Toggle right sidebar', icon: 'panel-right', hotkey: 'ctrl+alt+r', hotkeyLabel: 'Ctrl+Alt+R',
      run: () => qs('#app').classList.toggle('right-collapsed')
    },
    {
      id: 'toggle-theme', name: 'Appearance: toggle dark / light theme', icon: 'moon',
      run: () => {
        const next = vault().settings.theme === 'dark' ? 'light' : 'dark';
        vault().saveSettings({ theme: next });
        Obs.bus.emit('theme:changed', next);
      }
    },
    { id: 'open-settings', name: 'Settings', icon: 'sliders', hotkey: 'ctrl+,', hotkeyLabel: 'Ctrl+,', run: () => Obs.settingsModal.open() },
    {
      id: 'close-tab', name: 'Close current tab', icon: 'x', hotkey: 'ctrl+alt+w', hotkeyLabel: 'Ctrl+Alt+W',
      when: () => !!Obs.tabs.active,
      run: () => Obs.tabs.close(Obs.tabs.active.id)
    },
    {
      id: 'next-tab', name: 'Go to next tab', icon: 'chevron-right', hotkey: 'ctrl+shift+arrowright', hotkeyLabel: 'Ctrl+Shift+→',
      when: () => Obs.tabs.tabs.length > 1 && whenNotTyping(),
      run: () => { const arr = Obs.tabs.tabs; const i = arr.findIndex(t => t.id === Obs.tabs.active.id); Obs.tabs.activate(arr[(i + 1) % arr.length].id); }
    },
    {
      id: 'prev-tab', name: 'Go to previous tab', icon: 'chevron-left', hotkey: 'ctrl+shift+arrowleft', hotkeyLabel: 'Ctrl+Shift+←',
      when: () => Obs.tabs.tabs.length > 1 && whenNotTyping(),
      run: () => { const arr = Obs.tabs.tabs; const i = arr.findIndex(t => t.id === Obs.tabs.active.id); Obs.tabs.activate(arr[(i - 1 + arr.length) % arr.length].id); }
    },
    { id: 'navigate-back', name: 'Navigate back', icon: 'back', hotkey: 'alt+arrowleft', hotkeyLabel: 'Alt+←', run: () => Obs.tabs.historyBack() },
    { id: 'navigate-forward', name: 'Navigate forward', icon: 'forward', hotkey: 'alt+arrowright', hotkeyLabel: 'Alt+→', run: () => Obs.tabs.historyForward() },
    { id: 'export-vault-zip', name: 'Export: download vault as .zip', icon: 'download', run: () => Obs.io.exportVaultZip() },
    { id: 'export-json', name: 'Export: JSON backup', icon: 'database', run: () => Obs.io.exportJson() },
    { id: 'import-json', name: 'Import: JSON backup', icon: 'upload', run: () => qs('#import-json-input').click() },
    { id: 'import-files', name: 'Import: markdown / image files', icon: 'upload', run: () => qs('#import-files-input').click() },
    { id: 'import-folder', name: 'Import: whole folder', icon: 'folder-plus', run: () => qs('#import-dir-input').click() },
    { id: 'open-trash', name: 'Trash: view deleted items', icon: 'trash', run: () => Obs.palette.openTrash() },
  ]);

  Obs.commands = { list: commands, register, run, handleKey, comboFromEvent };
})(typeof window !== 'undefined' ? window : globalThis);
