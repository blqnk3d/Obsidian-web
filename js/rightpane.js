/* ============================================================
   rightpane.js — outline, backlinks, outgoing & unlinked
   links, mini local graph (Obs.rightPane)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, qs, debounce, escapeHtml } = Obs.util;
  const ui = () => Obs.ui;
  const vault = () => Obs.vault;

  const LS_FOLDED = 'obs-web-right-folded';
  let folded = new Set(JSON.parse(localStorage.getItem(LS_FOLDED) || '["graph","unlinked"]'));
  let miniGraph = null;

  function saveFolded() { localStorage.setItem(LS_FOLDED, JSON.stringify([...folded])); }

  function section(id, title, count, buildBody) {
    const isFolded = folded.has(id);
    const sec = el('div.right-section' + (isFolded ? '.folded' : ''), { dataset: { section: id } });
    const header = el('div.right-section-header', { html: `<span>${escapeHtml(title)}</span>${count != null ? `<span class="rs-count">${count}</span>` : ''}<span class="rs-chev">${ui().iconHtml('chevron-down', 13)}</span>` });
    const body = el('div.right-section-body');
    header.addEventListener('click', () => {
      if (folded.has(id)) folded.delete(id); else folded.add(id);
      saveFolded();
      sec.classList.toggle('folded', folded.has(id));
      if (id === 'graph') {
        if (folded.has(id)) destroyMiniGraph();
        else mountMiniGraph(body);
      }
    });
    sec.appendChild(header);
    sec.appendChild(body);
    if (!isFolded) buildBody(body);
    else if (id === 'graph') destroyMiniGraph();
    return sec;
  }

  function destroyMiniGraph() {
    if (miniGraph) { miniGraph.destroy(); miniGraph = null; }
  }

  function mountMiniGraph(body) {
    destroyMiniGraph();
    const tab = Obs.tabs.active;
    if (!tab || tab.type !== 'note') return;
    const wrap = el('div.mini-graph-wrap');
    body.appendChild(wrap);
    miniGraph = new Obs.graph.GraphView(wrap, { rootPath: tab.path, depth: 1, mini: true });
  }

  function refItem(title, snippet, onClick, unresolved) {
    const item = el('div.ref-item', {}, [
      el('div.ri-title', { html: ui().iconHtml('file-text', 12) + `<span class="${unresolved ? 'unresolved' : ''}">${escapeHtml(title)}</span>` }),
      snippet ? el('div.ri-snippet', { text: snippet }) : null
    ]);
    item.addEventListener('click', onClick);
    return item;
  }

  function refresh() {
    const content = qs('#right-panel-content');
    if (!content) return;
    destroyMiniGraph();
    content.innerHTML = '';
    const tab = Obs.tabs.active;
    if (!tab || tab.type !== 'note') {
      content.appendChild(el('div.right-empty', { html: 'Open a note to see its outline, backlinks and outgoing links.' }));
      return;
    }
    const note = vault().getNote(tab.path);
    if (!note) {
      content.appendChild(el('div.right-empty', { text: 'Note not found.' }));
      return;
    }

    /* local graph */
    content.appendChild(section('graph', 'Local graph', null, body => mountMiniGraph(body)));

    /* outline */
    content.appendChild(section('outline', 'Outline', note.headings.length || null, body => {
      if (!note.headings.length) { body.appendChild(el('div.right-empty', { text: 'No headings in this note.' })); return; }
      for (const h of note.headings) {
        const item = el('div.outline-item.lvl-' + h.level, { text: h.text, title: h.text });
        item.addEventListener('click', () => {
          const view = Obs.editor.current;
          if (!view || view.tab !== tab) return;
          if (view.tab.mode === 'write') view.scrollEditToLine(h.line);
          else {
            view.scrollPreviewToHeading(h.id);
            if (view.tab.mode === 'split') view.scrollEditToLine(h.line);
          }
        });
        body.appendChild(item);
      }
    }));

    /* backlinks */
    const backlinks = vault().backlinksFor(note.path);
    content.appendChild(section('backlinks', 'Backlinks', backlinks.length || null, body => {
      if (!backlinks.length) { body.appendChild(el('div.right-empty', { html: 'No other note links here yet.<br>Mention it with <code>[[' + escapeHtml(note.name) + ']]</code>.' })); return; }
      for (const src of backlinks) {
        const info = vault().linkSnippetsFor(src, note.path, note);
        body.appendChild(refItem(src.name, info.snippet, () => Obs.tabs.openNote(src.path, info.line != null ? { line: info.line } : {})));
      }
    }));

    /* outgoing */
    const outgoing = vault().outgoingFor(note.path);
    content.appendChild(section('outgoing', 'Outgoing links', outgoing.length || null, body => {
      if (!outgoing.length) { body.appendChild(el('div.right-empty', { text: 'This note has no outgoing links.' })); return; }
      for (const o of outgoing) {
        const label = o.resolvedPath ? vault().getNote(o.resolvedPath).name : o.target;
        body.appendChild(refItem((o.embed ? '⊞ ' : '') + label, o.alias ? 'as “' + o.alias + '”' : null, () => {
          if (o.resolvedPath) Obs.tabs.openNote(o.resolvedPath);
          else vault().createNote(o.target).then(n => { Obs.util.notice('Created “' + n.name + '”', 'success'); Obs.tabs.openNote(n.path); });
        }, !o.resolvedPath));
      }
    }));

    /* unlinked mentions */
    const unlinked = vault().unlinkedFor(note.path);
    content.appendChild(section('unlinked', 'Unlinked mentions', unlinked.length || null, body => {
      if (!unlinked.length) { body.appendChild(el('div.right-empty', { text: 'No unlinked mentions found.' })); return; }
      for (const u of unlinked.slice(0, 30)) {
        body.appendChild(refItem(u.note.name, u.snippet, () => Obs.tabs.openNote(u.note.path, u.line != null ? { line: u.line } : {})));
      }
    }));
  }

  const debouncedRefresh = debounce(refresh, 250);
  Obs.bus.on('tab:activated', refresh);
  Obs.bus.on('note:content', debouncedRefresh);
  Obs.bus.on('vault:changed', debouncedRefresh);

  Obs.rightPane = { refresh };
})(typeof window !== 'undefined' ? window : globalThis);
