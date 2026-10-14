/* ============================================================
   app.js — bootstrap, wiring, welcome vault (Obs.app)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { qs, el, escapeHtml } = Obs.util;
  const ui = () => Obs.ui;

  /* ---------------- appearance ---------------- */
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function shade(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    const f = c => Math.round(c + (255 - c) * amt);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  function applyAppearance() {
    const s = Obs.vault.settings;
    const theme = s.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    const accent = /^#[0-9a-fA-F]{6}$/.test(s.accent || '') ? s.accent : '#8a7cf8';
    const rs = document.documentElement.style;
    rs.setProperty('--accent', accent);
    rs.setProperty('--accent-hover', shade(accent, 0.14));
    rs.setProperty('--accent-soft', rgba(accent, 0.16));
    rs.setProperty('--selection', rgba(accent, theme === 'dark' ? 0.35 : 0.28));
    rs.setProperty('--font-size-editor', (s.editorFontSize || 15) + 'px');
    const btn = qs('#ribbon .ribbon-btn[data-action="toggle-theme"]');
    if (btn) btn.innerHTML = Obs.ui.iconHtml(theme === 'light' ? 'sun' : 'moon', 17);
    Obs.bus.emit('theme:changed', theme);
  }

  /* ---------------- UI wiring ---------------- */
  function bindRibbon() {
    const ACTION_MAP = {
      'new-note': 'new-note',
      'graph': 'open-graph',
      'daily': 'daily-note',
      'random': 'random-note',
      'toggle-theme': 'toggle-theme',
      'settings': 'open-settings'
    };
    document.querySelectorAll('#ribbon .ribbon-btn').forEach(b => {
      if (b.dataset.icon) b.innerHTML = Obs.ui.iconHtml(b.dataset.icon, 17);
      b.addEventListener('click', () => {
        if (b.dataset.side) {
          qs('#app').classList.remove('left-collapsed');
          Obs.leftPane.setPanel(b.dataset.side);
        } else if (b.dataset.action && ACTION_MAP[b.dataset.action]) {
          Obs.commands.run(ACTION_MAP[b.dataset.action]);
        }
      });
    });
  }

  function bindChrome() {
    const setIcon = (sel, name, size) => { const b = qs(sel); if (b) b.innerHTML = Obs.ui.iconHtml(name, size || 14); };
    setIcon('#left-collapse-btn', 'panel-left');
    setIcon('#right-collapse-btn', 'panel-right');
    setIcon('#right-sidebar-toggle', 'panel-right');
    setIcon('#left-sidebar-toggle-mobile', 'panel-left');
    setIcon('#tab-bar-plus', 'plus');

    qs('#left-collapse-btn').addEventListener('click', () => qs('#app').classList.add('left-collapsed'));
    qs('#right-collapse-btn').addEventListener('click', () => qs('#app').classList.add('right-collapsed'));
    qs('#right-sidebar-toggle').addEventListener('click', () => qs('#app').classList.toggle('right-collapsed'));
    qs('#left-sidebar-toggle-mobile').addEventListener('click', () => qs('#app').classList.toggle('left-collapsed'));
    qs('#tab-bar-plus').addEventListener('click', () => Obs.commands.run('new-note'));

    document.querySelectorAll('[data-empty-action]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.emptyAction;
      if (a === 'new-note') Obs.commands.run('new-note');
      else if (a === 'open-switcher') Obs.palette.openSwitcher();
      else if (a === 'graph') Obs.commands.run('open-graph');
      else if (a === 'import') Obs.commands.run('import-files');
    }));
  }

  function bindGlobalKeys() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') Obs.editor.hideHoverPreview();
      Obs.commands.handleKey(e);
    });
  }

  function bindDragDrop() {
    let depth = 0;
    window.addEventListener('dragenter', e => {
      e.preventDefault();
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        depth++;
        document.body.classList.add('dragging-file');
      }
    });
    window.addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', e => { e.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging-file'); });
    window.addEventListener('drop', e => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging-file');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) Obs.io.importFileList(e.dataTransfer.files);
    });
  }

  function bindLifecycle() {
    const flush = () => {
      try {
        const v = Obs.tabs.view;
        if (v && typeof v.saveNow === 'function') {
          const p = v.saveNow();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (e) { console.error('flush failed', e); }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', e => {
      flush();
      // Revoke cached blob URLs but skip bfcache (e.persisted) so images still
      // work if the user navigates back without a full reload.
      if (!e.persisted) { try { Obs.vault.releaseObjectUrls(); } catch (err) { /* ignore */ } }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  /* Surface unexpected failures instead of letting them die silently. */
  function bindGlobalErrors() {
    let lastNotice = 0;
    const report = (label, err) => {
      console.error(label, err);
      const now = Date.now();
      if (now - lastNotice < 4000) return;
      lastNotice = now;
      try {
        const msg = err && err.message ? err.message : String(err || 'unknown error');
        Obs.util.notice('Something went wrong: ' + msg, 'error', 4000);
      } catch (e) { /* ignore */ }
    };
    // Browsers emit this warning when an observer callback mutates layout; it
    // is non-fatal and not actionable, so don't log it or show a notice.
    const isBenign = err => /ResizeObserver loop/i.test((err && err.message) || String(err || ''));
    window.addEventListener('error', e => {
      const err = e.error || e.message;
      if (isBenign(err)) { if (e.preventDefault) e.preventDefault(); return; }
      report('Uncaught error', err);
    });
    window.addEventListener('unhandledrejection', e => {
      if (isBenign(e.reason)) { if (e.preventDefault) e.preventDefault(); return; }
      report('Unhandled promise rejection', e.reason);
    });
  }

  function updateStatusRight() {
    const right = qs('#status-right');
    if (!right) return;
    const s = Obs.vault.stats();
    const save = right.querySelector('.save-indicator');
    right.innerHTML =
      `<span class="status-item" title="Notes in vault">${s.notes} notes</span>` +
      `<span class="status-item" title="Total words">${s.words.toLocaleString()} words</span>` +
      `<span class="status-item clickable" title="Vault & storage settings">${escapeHtml(Obs.vault.settings.vaultName || 'My Vault')}</span>`;
    if (save) right.appendChild(save);
    const btn = right.querySelector('.clickable');
    if (btn) btn.addEventListener('click', () => Obs.settingsModal.open('data'));
  }

  /* ---------------- welcome vault ---------------- */
  const WELCOME = `---
tags: [welcome]
aliases: [Home, Start Here]
---
# Welcome to Obsidian Web 🎉

A **local-first markdown knowledge base** running entirely in your browser — no server, no account, **no external libraries**. Everything you write is stored in this browser's **IndexedDB** and can be exported at any time.

## Quick start

- <kbd>Ctrl</kbd>+<kbd>O</kbd> — quick switcher · <kbd>Ctrl</kbd>+<kbd>P</kbd> — command palette
- Link notes with double brackets: [[Markdown Cheatsheet]]
- Unresolved links like [[My Next Note]] create the note when you click them
- <kbd>Ctrl</kbd>+<kbd>G</kbd> — global graph view, or try [[Graph Demo A]]
- Click the calendar icon in the ribbon for today's daily note
- Drag & drop \`.md\` files or images anywhere onto this window to import them

> [!tip] Hover over any internal link
> You'll get a **page preview** — just like in Obsidian. Check the right sidebar for **backlinks, outgoing links, unlinked mentions** and the **outline** of this note.

## Feature tour

- [ ] Read the [[Markdown Cheatsheet]]
- [ ] Open the graph view (<kbd>Ctrl</kbd>+<kbd>G</kbd>)
- [ ] Create a daily note
- [x] Smile, your data never leaves this browser

New in this build: **syntax-highlighted code blocks**, **footnotes**[^why] and **block references** — see [[Markdown Cheatsheet#Footnotes & block refs]]. Drag a note onto a folder in the explorer to move it, and press <kbd>Ctrl</kbd>+<kbd>F</kbd> to find inside a note.

[^why]: Because footnotes[^why2] belong in a knowledge base.
[^why2]: Even nested-ish ones, numbered in order of appearance.

## Your data

| Action | How |
| ------ | --- |
| Download everything | Command palette → *Export vault (.zip)* |
| Download one note | Tab menu (⋯) → *Download .md* |
| Full backup | Command palette → *Export JSON backup* |
| Get it back | *Import JSON backup* / drag & drop |

%% This is a comment: visible while editing, invisible in preview. %%

Happy note-taking! ✨`;

  const CHEATSHEET = `---
tags: [demo, cheatsheet]
aliases: [Markdown Guide]
---
# Markdown Cheatsheet

Everything below is **live** — switch to reading mode (<kbd>Ctrl</kbd>+<kbd>E</kbd>) or look at the preview pane.

## Text formatting

**bold**, *italic*, ***both***, ~~strikethrough~~, ==highlight==, \`inline code\`, <u>underline (HTML)</u>

## Links

- Internal: [[Welcome]] · aliased: [[Welcome|the welcome note]] · heading: [[Welcome#Quick start]]
- Unresolved links create notes on click: [[A Note I Haven't Written Yet]]
- External: [Obsidian website](https://obsidian.md) · autolink: <https://example.com>
- Tags: #demo #cheatsheet/formatting

## Lists

1. Ordered
2. Lists
   1. Nested
   2. Items

- Bullet lists
  - with nesting
- [ ] Task lists
- [x] Clickable in preview!

## Callouts

> [!note]
> Twelve types are styled: note, abstract, info, tip, success, question, warning, failure, danger, bug, example, quote.

> [!warning]- Foldable (click to open)
> This one starts collapsed — the \`-\` after the type makes it foldable.

> Plain blockquotes work too.
> Multiple lines.

## Code

\`\`\`js
function greet(name) {
  // syntax highlighted, zero libraries
  const msg = \`Hello, \${name}!\`;
  return msg.toUpperCase();
}
\`\`\`

\`\`\`python
def fib(n: int) -> int:
    """Fibonacci, memoized."""
    cache = {0: 0, 1: 1}
    return cache[n] if n in cache else cache.setdefault(n, fib(n - 1) + fib(n - 2))
\`\`\`

## Footnotes & block refs

Inline footnotes[^fn1] are numbered automatically and collected at the bottom[^bignote].

This paragraph carries a block id, so other notes can link straight to it: [[Markdown Cheatsheet#^demo-block]] ^demo-block

[^fn1]: The first footnote — rendered in a section below.
[^bignote]: Footnote bodies support **markdown**, [links](https://obsidian.md) and multiple lines.

## Tables

| Syntax | Result | Notes |
| ------ | :----: | ----- |
| \`**x**\` | **x** | bold |
| \`==x==\` | ==x== | highlight |
| \`[[x]]\` | link | wikilink |

## Embeds

Embed another note inline with \`![[Graph Demo A#Section One]]\`:

![[Graph Demo A#Section One]]

## Misc

Horizontal rule:

---

Images: \`![alt](https://url.png)\` or \`![[attachment.png|300]]\` for files you import.

Footnote-ish comments %%like this%% disappear in preview. Frontmatter at the top of this note powers the **properties block**, #tags and *aliases* (this note is also reachable as [[Markdown Guide]]).`;

  const GRAPH_A = `---
tags: [demo, graph]
---
# Graph Demo A

This note and [[Graph Demo B]] link to each other so the **graph view** has something to show.

Open the global graph with <kbd>Ctrl</kbd>+<kbd>G</kbd>, or the *local graph* for just this neighbourhood (tab menu ⋯ → Open local graph, or the right sidebar).

## Section One

This section is **embedded** into the [[Markdown Cheatsheet]] with \`![[Graph Demo A#Section One]]\`.

Links fan out to: [[Welcome]] · [[Markdown Cheatsheet]] · [[Graph Demo B]]`;

  const GRAPH_B = `---
tags: [demo, graph]
---
# Graph Demo B

The other half of the demo pair — see [[Graph Demo A]].

I also point at [[Graph Demo C]], which **doesn't exist yet**: it shows up as a hollow
"ghost" node in the graph and becomes a real note when you click it.

Back to [[Welcome]] or the [[Markdown Cheatsheet]].`;

  const MEETING_TPL = `# Meeting: {{title}}

**Date:** {{date}} {{time}}

## Attendees

-

## Agenda

- [ ]

## Notes



## Action items

- [ ]
`;

  async function seedWelcomeVault() {
    const V = Obs.vault;
    await V.createNote(null, { exactPath: 'Welcome.md', content: WELCOME });
    await V.createNote(null, { exactPath: 'Markdown Cheatsheet.md', content: CHEATSHEET });
    await V.createNote(null, { exactPath: 'Projects/Graph Demo A.md', content: GRAPH_A });
    await V.createNote(null, { exactPath: 'Projects/Graph Demo B.md', content: GRAPH_B });
    await V.createNote(null, { exactPath: 'Templates/Meeting.md', content: MEETING_TPL });
    await V.createFolder('Daily');
  }

  /* ---------------- boot ---------------- */
  async function init() {
    bindGlobalErrors();
    bindRibbon();
    bindChrome();
    bindGlobalKeys();
    bindDragDrop();
    bindLifecycle();
    Obs.io.bindInputs();

    if (window.innerWidth <= 1080) qs('#app').classList.add('right-collapsed');
    if (window.innerWidth <= 760) qs('#app').classList.add('left-collapsed');

    try {
      await Obs.db.open();
    } catch (err) {
      ui().modal({
        title: 'Storage unavailable', footer: false, dismissable: false,
        build(body) {
          body.appendChild(el('div', { html: 'This browser blocked <b>IndexedDB</b>, so notes cannot be saved.<br><br>This usually happens when the page is opened inside a restricted frame or a private-browsing mode with storage disabled.<br><br><b>Tip:</b> serve the folder over HTTP (e.g. <code>python3 -m http.server</code>) and open <code>http://localhost:8000</code>.<br><br><small>' + escapeHtml(err.message) + '</small>' }));
        }
      });
      return;
    }

    await Obs.vault.init();
    applyAppearance();

    Obs.bus.on('settings:changed', () => { applyAppearance(); updateStatusRight(); });
    Obs.bus.on('vault:changed', updateStatusRight);

    Obs.leftPane.setPanel('files');
    updateStatusRight();

    const restored = Obs.tabs.restoreSession();
    if (!restored && Obs.vault.notes.size === 0) {
      await seedWelcomeVault();
      updateStatusRight();
      Obs.leftPane.refresh();
      Obs.tabs.openNote('Welcome.md', { history: true });
    } else if (!restored && Obs.vault.notes.size > 0) {
      // no saved session but an existing vault: open the most recently edited note
      const latest = Obs.vault.allNotes().sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))[0];
      if (latest) Obs.tabs.openNote(latest.path, { history: true });
    }
    Obs.rightPane.refresh();
  }

  Obs.app = { init, applyAppearance, seedWelcomeVault, updateStatusRight };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
