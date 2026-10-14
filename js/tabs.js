/* ============================================================
   tabs.js — tab bar, view mounting, navigation history (Obs.tabs)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, qs, debounce, baseName } = Obs.util;
  const ui = () => Obs.ui;

  const LS_SESSION = 'obs-web-session';
  let tabs = [];
  let seq = 1;
  let activeId = null;
  let view = null;         // current mounted view {el, destroy()}
  let history = [];
  let historyIdx = -1;
  let closedStack = [];    // recently closed: {type, path, rootPath, depth, mode}

  const viewContainer = () => qs('#view-container');
  const emptyState = () => qs('#empty-state');

  function active() { return tabs.find(t => t.id === activeId) || null; }

  /* ---------- tab bar rendering ---------- */
  function renderTabBar() {
    const bar = qs('#tabs');
    if (!bar) return;
    bar.innerHTML = '';
    for (const t of tabs) {
      const icon = t.type === 'graph' ? 'graph' : 'file-text';
      const tab = el('div.tab' + (t.id === activeId ? '.active' : '') + (t.dirty ? '.modified' : ''), {
        title: t.type === 'note' ? t.path : 'Graph view'
      }, [
        el('span.tab-icon', { html: ui().iconHtml(icon, 13) }),
        el('span.tab-title', { text: t.title || (t.type === 'graph' ? 'Graph' : baseName(t.path || '')) }),
        el('button.tab-close', { html: ui().iconHtml('x', 11), title: 'Close (Ctrl+Alt+W)' })
      ]);
      tab.addEventListener('click', e => {
        if (e.target.closest('.tab-close')) return;
        activate(t.id);
      });
      tab.addEventListener('dblclick', e => {
        if (t.type === 'note' && !e.target.closest('.tab-close')) {
          activate(t.id);
          Obs.commands.run('rename-note');
        }
      });
      /* drag & drop: reorder tabs, or drop a vault note onto a tab to open it there */
      tab.draggable = true;
      tab.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/obs-tab', t.id);
        e.dataTransfer.effectAllowed = 'move';
        tab.classList.add('dragging');
      });
      tab.addEventListener('dragend', () => { tab.classList.remove('dragging'); clearTabDropMarks(); });
      tab.addEventListener('dragover', e => {
        const types = Array.from(e.dataTransfer.types);
        if (types.includes('text/obs-tab')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          clearTabDropMarks();
          const r = tab.getBoundingClientRect();
          tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
        } else if (types.includes('text/obs-path')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'link';
          clearTabDropMarks();
          tab.classList.add('drop-before');
        }
      });
      tab.addEventListener('dragleave', () => tab.classList.remove('drop-before', 'drop-after'));
      tab.addEventListener('drop', e => {
        const tabId = e.dataTransfer.getData('text/obs-tab');
        const notePath = e.dataTransfer.getData('text/obs-path');
        const before = tab.classList.contains('drop-before');
        clearTabDropMarks();
        if (tabId && tabId !== t.id) {
          e.preventDefault();
          const from = tabs.findIndex(x => x.id === tabId);
          if (from < 0) return;
          const [moved] = tabs.splice(from, 1);
          let to = tabs.findIndex(x => x.id === t.id);
          if (!before) to += 1;
          tabs.splice(to, 0, moved);
          renderTabBar();
          saveSession();
        } else if (notePath) {
          e.preventDefault();
          retargetTab(t.id, notePath);
        }
      });
      tab.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); close(t.id); } });
      tab.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); close(t.id); });
      tab.addEventListener('contextmenu', e => {
        e.preventDefault();
        ui().menu(e.clientX, e.clientY, [
          { label: 'Close', icon: 'x', onClick: () => close(t.id) },
          { label: 'Close others', icon: 'x', onClick: () => closeOthers(t.id) },
          { label: 'Close all', icon: 'x', onClick: () => closeAll() },
          ...(t.type === 'note' ? [{ separator: true },
            { label: 'Copy path', icon: 'copy', onClick: () => navigator.clipboard && navigator.clipboard.writeText(t.path) },
            { label: 'Reveal in file explorer', icon: 'folder', onClick: () => { Obs.leftPane.setPanel('files'); Obs.leftPane.reveal(t.path); } }] : [])
        ]);
      });
      bar.appendChild(tab);
    }
    const scroller = bar;
    const activeEl = scroller.querySelector('.tab.active');
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  function tabTitle(t) {
    if (t.type === 'graph') return t.rootPath ? 'Local graph' : 'Graph view';
    const note = Obs.vault.getNote(t.path);
    return note ? note.name : baseName(t.path || '');
  }

  function clearTabDropMarks() {
    document.querySelectorAll('#tabs .tab').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  }

  /** Point an existing tab at a different note (drop onto tab). */
  function retargetTab(tabId, path) {
    const t = tabs.find(x => x.id === tabId);
    const notePath = Obs.vault.resolveTarget(path) || path;
    if (!t || !Obs.vault.getNote(notePath)) return;
    // if another tab already shows this note, just activate it instead
    const dup = tabs.find(x => x.type === 'note' && x.path === notePath && x.id !== tabId);
    if (dup) { activate(dup.id); return; }
    t.path = notePath;
    t.type = 'note';
    t.title = tabTitle(t);
    t.mode = t.mode || Obs.vault.settings.defaultMode || 'split';
    if (t.id === activeId) { unmount(); mount({}); Obs.bus.emit('tab:activated', t); }
    else activate(t.id);
    renderTabBar();
    saveSession();
  }

  function refreshTitles() { for (const t of tabs) t.title = tabTitle(t); renderTabBar(); }

  /* ---------- opening ---------- */
  function openNote(path, opts) {
    opts = opts || {};
    path = Obs.vault.resolveTarget(path) || path;
    const existing = tabs.find(t => t.type === 'note' && t.path === path);
    let t = existing;
    if (!t) {
      t = { id: 'tab' + (seq++), type: 'note', path, mode: opts.mode || Obs.vault.settings.defaultMode || 'split', dirty: false };
      t.title = tabTitle(t);
      tabs.push(t);
      renderTabBar();
    }
    if (opts.activate === false) { saveSession(); return t; }   // background tab
    activate(t.id, { heading: opts.heading, line: opts.line, history: opts.history !== false });
    return t;
  }

  function openGraph(opts) {
    opts = opts || {};
    const key = JSON.stringify({ rootPath: opts.rootPath || null, depth: opts.depth || 1 });
    let t = tabs.find(x => x.type === 'graph' && x.key === key);
    if (!t) {
      t = { id: 'tab' + (seq++), type: 'graph', rootPath: opts.rootPath || null, depth: opts.depth || 1, key, dirty: false };
      t.title = tabTitle(t);
      tabs.push(t);
    }
    activate(t.id);
    return t;
  }

  function activate(id, opts) {
    opts = opts || {};
    const t = tabs.find(x => x.id === id);
    if (!t) return;
    if (t.id === activeId && view) {
      if (opts.heading) {
        if (view.scrollToHeading) view.scrollToHeading(opts.heading);
      }
      if (opts.line != null) {
        if (view.scrollToLine) view.scrollToLine(opts.line);
      }
      return;
    }
    activeId = id;
    unmount();
    mount(opts);
    renderTabBar();
    if (t.type === 'note') {
      Obs.leftPane.reveal(t.path);
      if (opts.history !== false) pushHistory(t.path);
      try { view.noteView.textarea.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    Obs.bus.emit('tab:activated', t);
    setDocTitle();
    saveSession();
  }

  function mount(opts) {
    const c = viewContainer();
    const es = emptyState();
    if (es) es.style.display = 'none';
    const t = active();
    if (!t) { if (es) es.style.display = ''; return; }

    if (t.type === 'note') {
      const noteView = Obs.editor.mount(c, t);
      view = {
        el: noteView.root,
        get mode() { return t.mode; },
        destroy() { noteView.destroy(); },
        saveNow() { return noteView.saveNow(); },
        setMode(m) { noteView.setMode(m); renderTabBar(); },
        cycleMode() { noteView.cycleMode(); },
        focus() { noteView.focusEditor(); },
        scrollToHeading(id) { noteView.scrollPreviewToHeading(id); },
        scrollToLine(line) {
          if (noteView.tab.mode === 'write') noteView.scrollEditToLine(line);
          else { noteView.scrollPreviewToLine(line); noteView.scrollEditToLine(line); }
        },
        insertTemplate(text) { noteView.insertAtCursor(text); },
        wrap(a, b, p) { noteView.wrap(a, b, p); },
        noteView
      };
      if (opts && opts.heading) setTimeout(() => noteView.scrollPreviewToHeading(opts.heading), 30);
      if (opts && opts.line != null) setTimeout(() => { noteView.scrollPreviewToLine(opts.line); noteView.scrollEditToLine(opts.line); }, 30);
    } else {
      const wrapEl = el('div.view.view-graph');
      const header = el('div.view-header', {}, [
        el('div.view-header-title', { text: t.title }),
        el('div.view-header-actions', {}, [
          (() => {
            const b = el('button.icon-btn', { html: ui().iconHtml('restore', 15), title: 'Re-center graph' });
            b.addEventListener('click', () => { if (view && view.graphView) view.graphView.buildGraph(false); });
            return b;
          })()
        ])
      ]);
      wrapEl.appendChild(header);
      c.appendChild(wrapEl);
      const gv = new Obs.graph.GraphView(wrapEl, { rootPath: t.rootPath, depth: t.depth });
      view = { el: wrapEl, graphView: gv, destroy() { gv.destroy(); wrapEl.remove(); } };
      const sl = qs('#status-left');
      if (sl) sl.innerHTML = `<span class="status-item">${gv.nodes.length} nodes</span><span class="status-item">${gv.edges.length} links</span>`;
    }
  }

  function unmount() {
    if (!view) return;
    try { view.destroy(); } catch (e) { console.error(e); }
    view = null;
  }

  function close(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const t = tabs[idx];
    closedStack.push(t.type === 'note'
      ? { type: 'note', path: t.path, mode: t.mode }
      : { type: 'graph', rootPath: t.rootPath, depth: t.depth });
    if (closedStack.length > 25) closedStack.shift();
    if (t.id === activeId) {
      unmount();
      activeId = null;
      const next = tabs[idx + 1] || tabs[idx - 1];
      tabs.splice(idx, 1);
      if (next) activate(next.id, { history: false });
      else {
        view = null;
        const es = emptyState(); if (es) es.style.display = '';
        const sl = document.getElementById('status-left'); if (sl) sl.innerHTML = '';
        setDocTitle();
        Obs.bus.emit('tab:activated', null);
        Obs.rightPane.refresh();
      }
    } else {
      tabs.splice(idx, 1);
    }
    renderTabBar();
    setDocTitle();
    saveSession();
  }

  function closeOthers(id) { for (const t of tabs.slice()) if (t.id !== id) close(t.id); }
  function closeAll() { for (const t of tabs.slice()) close(t.id); }

  function reopenClosed() {
    while (closedStack.length) {
      const c = closedStack.pop();
      if (c.type === 'note') {
        if (Obs.vault.getNote(c.path)) { openNote(c.path, { mode: c.mode }); return true; }
      } else {
        openGraph({ rootPath: c.rootPath, depth: c.depth });
        return true;
      }
    }
    Obs.util.notice('No recently closed tabs', 'warning', 1400);
    return false;
  }

  function markTabDirty(id, dirty) {
    const t = tabs.find(x => x.id === id);
    if (!t || t.dirty === dirty) return;
    t.dirty = dirty;
    renderTabBar();
  }

  function setDocTitle() {
    const t = active();
    const vaultName = Obs.vault.settings.vaultName || 'Obsidian Web';
    document.title = t ? `${t.title || baseName(t.path || '')} — ${vaultName}` : `Obsidian Web`;
  }

  /* ---------- history ---------- */
  function pushHistory(path) {
    if (history[historyIdx] === path) return;
    history = history.slice(0, historyIdx + 1);
    history.push(path);
    if (history.length > 60) history.shift();
    historyIdx = history.length - 1;
    Obs.bus.emit('history:changed');
  }
  function historyBack() {
    if (historyIdx <= 0) { Obs.util.notice('No earlier note', 'warning', 1200); return; }
    historyIdx--;
    const p = history[historyIdx];
    Obs.bus.emit('history:changed');
    if (Obs.vault.getNote(p)) openNote(p, { history: false });
  }
  function historyForward() {
    if (historyIdx >= history.length - 1) { Obs.util.notice('No later note', 'warning', 1200); return; }
    historyIdx++;
    const p = history[historyIdx];
    Obs.bus.emit('history:changed');
    if (Obs.vault.getNote(p)) openNote(p, { history: false });
  }
  function canBack() { return historyIdx > 0; }
  function canForward() { return historyIdx < history.length - 1; }

  /* ---------- session ---------- */
  const saveSession = debounce(function () {
    const t = active();
    const data = {
      tabs: tabs.map(x => x.type === 'note' ? { type: 'note', path: x.path, mode: x.mode } : { type: 'graph', rootPath: x.rootPath, depth: x.depth }),
      activeIndex: tabs.findIndex(x => t && x.id === t.id)
    };
    try { localStorage.setItem(LS_SESSION, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }, 250);

  function restoreSession() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch (e) { /* ignore */ }
    if (!data || !Array.isArray(data.tabs)) return false;
    let opened = 0;
    for (const s of data.tabs) {
      if (s.type === 'note') {
        if (!Obs.vault.getNote(s.path)) continue;
        const t = { id: 'tab' + (seq++), type: 'note', path: s.path, mode: s.mode || 'split', dirty: false };
        t.title = tabTitle(t);
        tabs.push(t);
        opened++;
      } else if (s.type === 'graph') {
        const t = { id: 'tab' + (seq++), type: 'graph', rootPath: s.rootPath || null, depth: s.depth || 1, dirty: false };
        t.key = JSON.stringify({ rootPath: t.rootPath, depth: t.depth });
        t.title = tabTitle(t);
        tabs.push(t);
        opened++;
      }
    }
    if (!opened) return false;
    const idx = Math.min(Math.max(data.activeIndex || 0, 0), tabs.length - 1);
    activate(tabs[idx].id, { history: false });
    return true;
  }

  /* ---------- react to vault events ---------- */
  Obs.bus.on('vault:changed', ev => {
    if (!ev) return;
    if (ev.type === 'delete') {
      const t = tabs.find(x => x.type === 'note' && x.path === ev.path);
      if (t) close(t.id);
    } else if (ev.type === 'rename') {
      const t = tabs.find(x => x.type === 'note' && x.path === ev.oldPath);
      if (t) {
        t.path = ev.path;
        t.title = tabTitle(t);
        if (t.id === activeId) { unmount(); mount({}); }
        renderTabBar();
        saveSession();
      }
    } else {
      refreshTitles();
    }
  });

  Obs.tabs = {
    openNote, openGraph, activate, close, closeOthers, closeAll, reopenClosed, retargetTab,
    markTabDirty, saveSession, restoreSession, refreshTitles,
    historyBack, historyForward, canBack, canForward,
    get tabs() { return tabs; },
    get active() { return active(); },
    get view() { return view; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
