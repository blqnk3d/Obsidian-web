/* ============================================================
   editor.js — note view: edit / split / read modes (Obs.editor)
   Obs.editor.mount(container, tab) -> view object
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, debounce, escapeHtml, stripExt, baseName, extName, dirName, countWords, fmtDate } = Obs.util;
  const ui = () => Obs.ui;

  const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`', '*': '*', '_': '_', '=': '=' , '~': '~'};

  class NoteView {
    constructor(container, tab) {
      this.container = container;
      this.tab = tab;
      this.destroyed = false;
      this.build();
      this.load();
      this.bind();
    }

    get note() { return Obs.vault.getNote(this.tab.path); }

    /* ---------- construction ---------- */
    build() {
      const tab = this.tab;
      this.root = el('div.view.view-note', { dataset: { tabId: tab.id } });

      /* header */
      this.backBtn = el('button.icon-btn', { html: ui().iconHtml('back', 15), title: 'Navigate back (Alt+←)' });
      this.fwdBtn = el('button.icon-btn', { html: ui().iconHtml('forward', 15), title: 'Navigate forward (Alt+→)' });
      this.backBtn.addEventListener('click', () => Obs.tabs.historyBack());
      this.fwdBtn.addEventListener('click', () => Obs.tabs.historyForward());

      this.titleEl = el('div.view-header-title', { title: 'Click to rename' });
      this.titleEl.addEventListener('click', () => Obs.commands.run('rename-note'));

      this.starBtn = el('button.icon-btn.star-btn', { html: ui().iconHtml('star', 15), title: 'Bookmark note' });
      this.starBtn.addEventListener('click', async () => {
        const on = await Obs.vault.toggleStar(this.tab.path);
        this.updateStar(on);
      });

      const mkMode = (mode, icon, title) => {
        const b = el('button.icon-btn.mode-btn', { html: ui().iconHtml(icon, 15), title, dataset: { mode } });
        b.addEventListener('click', () => this.setMode(mode));
        return b;
      };
      this.modeBtns = {
        write: mkMode('write', 'pencil', 'Editing mode (Ctrl+E cycles)'),
        split: mkMode('split', 'columns', 'Split mode (Ctrl+E cycles)'),
        read: mkMode('read', 'book', 'Reading mode (Ctrl+E cycles)')
      };

      this.moreBtn = el('button.icon-btn', { html: ui().iconHtml('more-vertical', 15), title: 'More actions' });
      this.moreBtn.addEventListener('click', () => this.openMoreMenu());

      this.root.appendChild(el('div.view-header', {}, [
        el('div.view-header-nav', {}, [this.backBtn, this.fwdBtn]),
        this.titleEl,
        el('div.view-header-actions', {}, [this.starBtn, this.modeBtns.write, this.modeBtns.split, this.modeBtns.read, this.moreBtn])
      ]));

      /* body */
      this.body = el('div.view-content.note-body');

      const tb = (iconName, title, fn) => {
        const b = el('button.icon-btn', { html: ui().iconHtml(iconName, 14), title });
        b.addEventListener('click', () => { fn(); this.textarea.focus(); });
        return b;
      };
      const sep = () => el('span.tb-sep');
      this.toolbar = el('div.editor-toolbar', {}, [
        tb('bold', 'Bold (Ctrl+B)', () => this.wrap('**', '**', 'bold text')),
        tb('italic', 'Italic (Ctrl+I)', () => this.wrap('*', '*', 'italic text')),
        tb('strikethrough', 'Strikethrough', () => this.wrap('~~', '~~', 'strikethrough')),
        tb('highlighter', 'Highlight', () => this.wrap('==', '==', 'highlight')),
        sep(),
        tb('heading', 'Heading', () => this.lineToggle(/^#{1,6}\s+/, '# ', 'Heading')),
        tb('link', 'Internal link (Ctrl+K)', () => this.insertLink()),
        tb('code', 'Code block', () => this.wrap('\n```\n', '\n```\n', 'code')),
        sep(),
        tb('list', 'Bullet list', () => this.lineToggle(/^\s*[-*+]\s+/, '- ', 'item')),
        tb('list-ordered', 'Numbered list', () => this.lineToggle(/^\s*\d+[.)]\s+/, '1. ', 'item')),
        tb('check-square', 'Task list', () => this.lineToggle(/^\s*[-*+]\s+\[[ xX]\]\s+/, '- [ ] ', 'task')),
        tb('quote', 'Quote / callout', () => this.lineToggle(/^\s*>\s?/, '> ', 'quote')),
        tb('table', 'Insert table', () => this.insertAtCursor('\n| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |\n')),
      ]);

      this.textarea = el('textarea.editor-textarea', {
        spellcheck: 'false',
        placeholder: 'Write with Markdown — [[link notes]], #tags, > [!tip] callouts, - [ ] tasks…  (Ctrl+P for commands)'
      });
      this.buildFindBar();
      this.paneEdit = el('div.pane-edit', {}, [this.toolbar, this.findBar, this.textarea]);
      this.slash = Obs.slash ? Obs.slash.create(this) : null;
      this.previewInner = el('div.markdown-preview');
      this.panePreview = el('div.pane-preview', {}, [this.previewInner]);
      this.body.appendChild(this.paneEdit);
      this.body.appendChild(this.panePreview);
      this.root.appendChild(this.body);
      this.container.appendChild(this.root);

      this.setMode(tab.mode || Obs.vault.settings.defaultMode || 'split', true);
    }

    /* ---------- load / save ---------- */
    load() {
      const note = this.note;
      if (!note) {
        this.previewInner.innerHTML = `<div class="embed-missing">This note no longer exists.</div>`;
        return;
      }
      this.textarea.value = note.content;
      this.renderPreview();
      this.updateHeader();
      this.updateStats();
      if (this.tab._scrollTop != null) this.textarea.scrollTop = this.tab._scrollTop;
      if (this.tab._caret != null) {
        try { this.textarea.setSelectionRange(this.tab._caret, this.tab._caret); } catch (e) { /* ignore */ }
      }
    }

    persistState() {
      this.tab._scrollTop = this.textarea.scrollTop;
      this.tab._caret = this.textarea.selectionStart;
      this.tab._previewScroll = this.panePreview.scrollTop;
    }

    async save(immediate) {
      const note = this.note;
      if (!note) return;
      const content = this.textarea.value;
      if (content === note.content) return;
      this.tab.dirty = true;
      Obs.tabs.markTabDirty(this.tab.id, true);
      Obs.editor.setSaveState('saving');
      const doSave = async () => {
        try {
          await Obs.vault.setContent(this.tab.path, this.textarea.value);
          this.tab.dirty = false;
          Obs.tabs.markTabDirty(this.tab.id, false);
          Obs.editor.setSaveState('saved');
          this.updateStats();
        } catch (err) {
          // Never fail silently — surface the problem and keep the tab dirty
          // so a later save (or unload flush) can retry.
          this.tab.dirty = true;
          Obs.tabs.markTabDirty(this.tab.id, true);
          Obs.editor.setSaveState('error');
          Obs.util.notice('Could not save "' + (this.note ? this.note.name : this.tab.path) + '": ' + (err && err.message ? err.message : err), 'error');
        }
      };
      if (immediate) await doSave();
      else {
        if (!this._debouncedSave) this._debouncedSave = debounce(doSave, 420);
        this._debouncedSave();
      }
    }

    saveNow() {
      if (this._debouncedSave) this._debouncedSave.cancel();
      return this.save(true);
    }

    /* ---------- rendering ---------- */
    renderPreview() {
      const note = this.note;
      if (!note) return;
      const html = Obs.md.render(this.textarea.value, {
        resolve: t => Obs.vault.resolveForRender(t),
        fromPath: this.tab.path,
        renderProperties: Obs.vault.settings.showFrontmatter !== false,
        interactive: true
      });
      Obs.sanitize.setHtml(this.previewInner, html);
    }

    updateHeader() {
      const note = this.note;
      if (!note) return;
      const folder = note.folder ? note.folder + '/' : '';
      this.titleEl.innerHTML = `<span class="title-folder">${escapeHtml(folder)}</span>${escapeHtml(note.name)}`;
      this.updateStar(note.starred);
      for (const [mode, btn] of Object.entries(this.modeBtns)) {
        btn.classList.toggle('active', this.tab.mode === mode);
      }
    }

    updateStar(on) {
      this.starBtn.innerHTML = ui().iconHtml(on ? 'star-filled' : 'star', 15);
      this.starBtn.classList.toggle('starred', !!on);
      this.starBtn.title = on ? 'Remove bookmark' : 'Bookmark note';
    }

    setMode(mode, skipRefresh) {
      if (!['write', 'split', 'read'].includes(mode)) mode = 'split';
      this.tab.mode = mode;
      this.body.className = 'view-content note-body mode-' + mode;
      this.toolbar.style.display = mode === 'read' ? 'none' : '';
      for (const [m, btn] of Object.entries(this.modeBtns)) btn.classList.toggle('active', m === mode);
      if (!skipRefresh && mode !== 'write') this.renderPreview();
      if (mode === 'read' && this.tab._previewScroll != null) this.panePreview.scrollTop = this.tab._previewScroll;
      Obs.tabs.saveSession();
    }

    cycleMode() {
      const order = ['write', 'split', 'read'];
      const next = order[(order.indexOf(this.tab.mode) + 1) % order.length];
      this.setMode(next);
    }

    updateStats() {
      const v = this.textarea.value;
      const words = countWords(v);
      const sel = v.slice(this.textarea.selectionStart, this.textarea.selectionEnd);
      const selInfo = sel ? ` (${countWords(sel)} selected)` : '';
      const pos = this.textarea.selectionStart || 0;
      const before = v.slice(0, pos);
      const ln = before.split('\n').length;
      const col = pos - (before.lastIndexOf('\n') + 1) + 1;
      const left = document.getElementById('status-left');
      if (left) {
        left.innerHTML =
          `<span class="status-item">${words} words${selInfo}</span>` +
          `<span class="status-item">${v.length} characters</span>` +
          `<span class="status-item">Ln ${ln}, Col ${col}</span>`;
      }
    }

    /* ---------- editing helpers ---------- */
    wrap(before, after, placeholder) {
      const ta = this.textarea;
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = ta.value.slice(s, e);
      // toggle off if already wrapped
      if (sel && sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
        const inner = sel.slice(before.length, sel.length - after.length);
        ta.setRangeText(inner, s, e, 'select');
      } else if (ta.value.slice(s - before.length, s) === before && ta.value.slice(e, e + after.length) === after) {
        ta.setRangeText(sel, s - before.length, e + after.length, 'select');
        ta.setSelectionRange(s - before.length, s - before.length + sel.length);
      } else {
        const text = sel || placeholder || '';
        ta.setRangeText(before + text + after, s, e, 'end');
        if (!sel && placeholder) ta.setSelectionRange(s + before.length, s + before.length + text.length);
        else if (sel) ta.setSelectionRange(s + before.length, s + before.length + sel.length);
      }
      this.onEdit();
    }

    lineToggle(re, prefix, placeholder) {
      const ta = this.textarea;
      const s = ta.selectionStart, e = ta.selectionEnd;
      const v = ta.value;
      const ls = v.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
      let le = v.indexOf('\n', e);
      if (le < 0) le = v.length;
      const block = v.slice(ls, le);
      const lines = block.split('\n');
      const allHave = lines.every(l => re.test(l) || l.trim() === '');
      const out = lines.map(l => {
        if (allHave) return l.replace(re, '');
        if (l.trim() === '') return l;
        return re.test(l) ? l : prefix + l;
      });
      if (!allHave && lines.length === 1 && lines[0].trim() === '') out[0] = prefix + placeholder;
      ta.setRangeText(out.join('\n'), ls, le, 'end');
      this.onEdit();
    }

    insertLink() {
      const ta = this.textarea;
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel) this.wrap('[[', ']]');
      else this.wrap('[[', ']]', 'Note name');
    }

    insertAtCursor(text) {
      const ta = this.textarea;
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      this.onEdit();
      ta.focus();
    }

    onEdit() {
      this.renderPreview();
      this.updateFindIfOpen();
      this.save();
    }

    /* ---------- drag & drop into the editor (whole note view is a drop zone) ---------- */
    bindEditorDnd() {
      const root = this.root;
      const wants = e => {
        const types = Array.from(e.dataTransfer ? e.dataTransfer.types : []);
        return types.includes('text/obs-path') || types.includes('Files');
      };
      let depth = 0;
      root.addEventListener('dragenter', e => {
        if (!wants(e)) return;
        e.preventDefault();
        depth++;
        root.classList.add('drop-link');
      });
      root.addEventListener('dragover', e => {
        if (!wants(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        root.classList.add('drop-link');
      });
      root.addEventListener('dragleave', e => {
        if (!wants(e)) return;
        depth = Math.max(0, depth - 1);
        if (!depth) root.classList.remove('drop-link');
      });
      root.addEventListener('drop', async e => {
        if (!wants(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth = 0;
        root.classList.remove('drop-link');
        if (this.tab.mode === 'read') {
          const def = Obs.vault.settings.defaultMode === 'read' ? 'split' : Obs.vault.settings.defaultMode;
          this.setMode(def);
        }
        this.textarea.focus();
        const path = e.dataTransfer.getData('text/obs-path');
        if (path) {
          this.insertAtCursor(this.linkFor(path));
          Obs.util.notice('Linked ' + baseName(path), 'success', 1400);
          return;
        }
        const files = Array.from(e.dataTransfer.files || []);
        for (const f of files) await this.ingestFile(f);
      });
    }

    /** Markdown snippet that links to a vault path (note or attachment). */
    linkFor(path) {
      const V = Obs.vault;
      if (V.getNote(path)) return `[[${V.getNote(path).name}]]`;
      if (V.files.has(path) || V.isImagePath(path)) return `![[${baseName(path)}]]`;
      return `[[${stripExt(baseName(path))}]]`;
    }

    /** Import a dropped OS file and link it at the cursor. */
    async ingestFile(f) {
      const V = Obs.vault;
      try {
        if ((f.type || '').startsWith('image/') || V.IMG_EXT.includes(extName(f.name))) {
          const ext = (f.type.split('/')[1] || extName(f.name) || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
          const stored = await V.addFileBlob(f, 'Dropped image ' + fmtDate(new Date(), 'YYYY-MM-DD HH.mm.ss') + '.' + ext);
          this.insertAtCursor(this.linkFor(stored.path));
          Obs.util.notice('Image attached: ' + stored.path, 'success');
        } else if (V.TEXT_EXT.includes(extName(f.name)) || (f.type || '').startsWith('text/')) {
          let p = Obs.util.normalizePath(f.name).replace(/\.txt$/i, '.md');
          if (!/\.(md|markdown)$/i.test(p)) p += '.md';
          const unique = Obs.util.uniquePath(Obs.util.dirName(p), Obs.util.stripExt(Obs.util.baseName(p)), '.md', x => V.notes.has(x));
          const note = await V.createNote(null, { exactPath: unique, content: await f.text() });
          this.insertAtCursor(this.linkFor(note.path));
          Obs.util.notice('Imported & linked: ' + note.name, 'success');
        } else {
          Obs.util.notice('Unsupported file type: ' + f.name, 'warning');
        }
      } catch (err) {
        Obs.util.notice('Drop failed: ' + err.message, 'error');
      }
    }

    /* ---------- line operations ---------- */
    _lineBounds() {
      const ta = this.textarea, v = ta.value;
      const s = ta.selectionStart, e = ta.selectionEnd;
      const ls = v.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
      let le = v.indexOf('\n', e);
      le = le < 0 ? v.length : le + 1;
      return { ls, le };
    }

    duplicateLine() {
      const ta = this.textarea, v = ta.value;
      const { ls, le } = this._lineBounds();
      const block = v.slice(ls, le);
      if (!block) return;
      const copy = block.endsWith('\n') ? block : block + '\n';
      ta.setRangeText(copy, le, le, 'end');
      this.onEdit();
    }

    moveLine(dir) {
      const ta = this.textarea, v = ta.value;
      const { ls, le } = this._lineBounds();
      const block = v.slice(ls, le);
      if (dir < 0) {
        if (ls === 0) return;
        const pls = v.lastIndexOf('\n', Math.max(0, ls - 2)) + 1;
        const prev = v.slice(pls, ls);
        ta.setRangeText(block + prev, pls, le, 'end');
        ta.setSelectionRange(ls, ls + block.length - (block.endsWith('\n') ? 1 : 0));
      } else {
        if (le >= v.length) return;
        let nle = v.indexOf('\n', le);
        nle = nle < 0 ? v.length : nle + 1;
        const next = v.slice(le, nle);
        ta.setRangeText(next + block, ls, nle, 'end');
        ta.setSelectionRange(ls + next.length, ls + next.length + block.length - (block.endsWith('\n') ? 1 : 0));
      }
      this.onEdit();
    }

    deleteLine() {
      const ta = this.textarea, v = ta.value;
      const { ls, le } = this._lineBounds();
      if (ls === le && ls >= v.length) return;
      ta.setRangeText('', ls, le, 'start');
      this.onEdit();
    }

    scrollPreviewToLine(line) {
      const els = Array.from(this.previewInner.querySelectorAll('[data-line]'));
      let target = null;
      for (const elx of els) {
        const l = parseInt(elx.dataset.line, 10);
        if (!isNaN(l) && l <= line) target = elx;
        else if (!isNaN(l) && l > line) break;
      }
      this.scrollPreviewToEl(target, 12);
    }

    updateNav() {
      this.backBtn.disabled = !Obs.tabs.canBack();
      this.fwdBtn.disabled = !Obs.tabs.canForward();
    }

    /* ---------- find & replace bar ---------- */
    buildFindBar() {
      const fb = this._fb = { matches: [], idx: -1, caseSensitive: false };
      const ib = (iconName, title, fn) => {
        const b = el('button.icon-btn', { html: ui().iconHtml(iconName, 13), title });
        b.addEventListener('click', fn);
        return b;
      };
      this.fbQuery = el('input.fb-query', { type: 'text', placeholder: 'Find in note…  (Enter = next)', spellcheck: 'false' });
      this.fbCount = el('span.fb-count', { text: '0/0' });
      this.fbCase = ib('case-sensitive', 'Match case', () => { fb.caseSensitive = !fb.caseSensitive; this.fbCase.classList.toggle('on', fb.caseSensitive); this.computeFind(); });
      this.fbRepl = el('input.fb-replace.hidden', { type: 'text', placeholder: 'Replace with…', spellcheck: 'false' });
      this.fbOne = el('button.btn.fb-btn.hidden', { text: 'Replace' });
      this.fbAll = el('button.btn.fb-btn.hidden', { text: 'All' });
      this.fbReplToggle = ib('replace', 'Toggle replace (Ctrl+H)', () => this.openFind(!this.fbRepl.classList.contains('hidden') ? false : true, true));
      this.findBar = el('div.find-bar.hidden', {}, [
        this.fbQuery, this.fbCount,
        ib('arrow-up', 'Previous match (Shift+Enter)', () => this.gotoFind(this._fb.idx - 1)),
        ib('arrow-down', 'Next match (Enter)', () => this.gotoFind(this._fb.idx + 1)),
        this.fbCase, this.fbRepl, this.fbOne, this.fbAll, this.fbReplToggle,
        ib('x', 'Close (Esc)', () => this.closeFind())
      ]);

      const recompute = debounce(() => this.computeFind(), 130);
      this.fbQuery.addEventListener('input', recompute);
      this.fbQuery.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); this.gotoFind(this._fb.idx + (e.shiftKey ? -1 : 1)); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeFind(); }
      });
      this.fbRepl.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); this.replaceOne(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeFind(); }
      });
      this.fbOne.addEventListener('click', () => this.replaceOne());
      this.fbAll.addEventListener('click', () => this.replaceAll());
    }

    openFind(showReplace, keepFocus) {
      if (this.tab.mode === 'read') this.setMode(Obs.vault.settings.defaultMode === 'read' ? 'split' : Obs.vault.settings.defaultMode);
      this.findBar.classList.remove('hidden');
      const on = !!showReplace;
      this.fbRepl.classList.toggle('hidden', !on);
      this.fbOne.classList.toggle('hidden', !on);
      this.fbAll.classList.toggle('hidden', !on);
      if (!keepFocus || !on) {
        const sel = this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd);
        if (sel && !sel.includes('\n') && sel.length <= 80 && this.fbQuery.value !== sel) {
          this.fbQuery.value = sel;
        }
        this.fbQuery.focus();
        this.fbQuery.select();
      } else this.fbRepl.focus();
      this.computeFind();
    }

    closeFind() {
      this.findBar.classList.add('hidden');
      this.textarea.focus();
    }

    computeFind() {
      const fb = this._fb;
      const q = this.fbQuery.value;
      fb.matches = [];
      fb.idx = -1;
      if (q) {
        const hay = fb.caseSensitive ? this.textarea.value : this.textarea.value.toLowerCase();
        const needle = fb.caseSensitive ? q : q.toLowerCase();
        let from = 0, i;
        while ((i = hay.indexOf(needle, from)) >= 0 && fb.matches.length < 5000) {
          fb.matches.push({ start: i, len: needle.length });
          from = i + Math.max(1, needle.length);
        }
      }
      this.fbCount.textContent = fb.matches.length ? `0/${fb.matches.length}` : '0/0';
      if (fb.matches.length) this.gotoFind(0);
    }

    gotoFind(i) {
      const fb = this._fb;
      if (!fb.matches.length) { fb.idx = -1; this.fbCount.textContent = '0/0'; return; }
      fb.idx = ((i % fb.matches.length) + fb.matches.length) % fb.matches.length;
      const m = fb.matches[fb.idx];
      const ta = this.textarea;
      ta.focus();
      ta.setSelectionRange(m.start, m.start + m.len);
      const before = ta.value.slice(0, m.start);
      const line = before.split('\n').length - 1;
      const lh = this.lineHeightPx();
      ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3);
      this.fbCount.textContent = `${fb.idx + 1}/${fb.matches.length}`;
    }

    lineHeightPx() {
      const cs = getComputedStyle(this.textarea);
      return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.65 || 24;
    }

    replaceOne() {
      const fb = this._fb;
      if (fb.idx < 0 || !fb.matches.length) return;
      const m = fb.matches[fb.idx];
      this.textarea.setRangeText(this.fbRepl.value, m.start, m.start + m.len, 'end');
      this.onEdit();
      this.computeFind();
      this.gotoFind(Math.min(fb.idx, fb.matches.length - 1));
    }

    replaceAll() {
      const fb = this._fb;
      const q = this.fbQuery.value;
      if (!q || !fb.matches.length) return;
      const n = fb.matches.length;
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), fb.caseSensitive ? 'g' : 'gi');
      const repl = this.fbRepl.value;
      this.textarea.value = this.textarea.value.replace(re, () => repl);
      this.onEdit();
      this.computeFind();
      Obs.util.notice(`Replaced ${n} occurrence${n === 1 ? '' : 's'}`, 'success');
    }

    updateFindIfOpen() {
      if (!this.findBar.classList.contains('hidden')) this.computeFind();
    }

    /* ---------- events ---------- */
    bind() {
      const ta = this.textarea;

      ta.addEventListener('input', () => {
        if (!this._debouncedRender) this._debouncedRender = debounce(() => this.renderPreview(), 110);
        this._debouncedRender();
        if (this.slash) this.slash.onInput();
        this.save();
        this.updateStats();
      });
      ta.addEventListener('keyup', () => this.updateStats());
      ta.addEventListener('click', () => this.updateStats());
      ta.addEventListener('blur', () => this.persistState());
      ta.addEventListener('scroll', () => this.syncScroll(ta, this.panePreview));

      this.panePreview.addEventListener('scroll', () => this.syncScroll(this.panePreview, ta));

      ta.addEventListener('keydown', e => this.onKeydown(e));

      /* paste images → store as attachment + embed; paste URL over selection → markdown link */
      ta.addEventListener('paste', async e => {
        const dt = e.clipboardData;
        if (!dt) return;
        const plain = dt.getData && dt.getData('text/plain');
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        if (plain && sel && /^https?:\/\/\S+$/i.test(plain.trim())) {
          e.preventDefault();
          ta.setRangeText(`[${sel}](${plain.trim()})`, ta.selectionStart, ta.selectionEnd, 'end');
          this.onEdit();
          return;
        }
        if (!dt.files || !dt.files.length) return;
        const imgs = Array.from(dt.files).filter(f => (f.type || '').startsWith('image/'));
        if (!imgs.length) return;
        e.preventDefault();
        for (const img of imgs) {
          const ext = (img.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
          const nameBase = 'Pasted image ' + fmtDate(new Date(), 'YYYY-MM-DD HH.mm.ss');
          try {
            const stored = await Obs.vault.addFileBlob(img, nameBase + '.' + ext);
            this.insertAtCursor('![[' + baseName(stored.path) + ']]');
            Obs.util.notice('Image attached: ' + stored.path, 'success');
          } catch (err) { Obs.util.notice('Could not attach image: ' + err.message, 'error'); }
        }
      });

      /* preview interactions (delegated) */
      this.panePreview.addEventListener('click', e => {
        const target = e.target;

        const cb = target.closest && target.closest('input[type="checkbox"][data-line]');
        if (cb) { this.toggleTask(cb); e.preventDefault(); return; }

        const copyBtn = target.closest && target.closest('.code-copy-btn');
        if (copyBtn) {
          const code = copyBtn.closest('.code-block').querySelector('code');
          this.copyText(code.textContent).then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); });
          return;
        }

        const calloutTitle = target.closest && target.closest('.callout.foldable > .callout-title');
        if (calloutTitle) { calloutTitle.parentElement.classList.toggle('folded'); return; }

        const fmHeader = target.closest && target.closest('.frontmatter-header');
        if (fmHeader) { fmHeader.parentElement.classList.toggle('folded'); return; }

        const embedTitle = target.closest && target.closest('.markdown-embed-title[data-open-path]');
        if (embedTitle) { Obs.tabs.openNote(embedTitle.dataset.openPath); return; }

        const fnRef = target.closest && target.closest('a[data-fn]');
        if (fnRef) {
          const id = 'md-fn-' + fnRef.dataset.fn;
          const li = this.previewInner.querySelector('#' + (global.CSS && CSS.escape ? CSS.escape(id) : id));
          this.scrollPreviewToEl(li, 24);
          this.flashEl(li);
          return;
        }
        const fnBack = target.closest && target.closest('a[data-fn-back]');
        if (fnBack) {
          const sup = this.previewInner.querySelector(`sup.fn-ref a[data-fn="${fnBack.dataset.fnBack}"]`);
          this.scrollPreviewToEl(sup, 80);
          return;
        }

        const link = target.closest && target.closest('a');
        if (!link) return;
        e.preventDefault();
        if (link.classList.contains('tag-link')) {
          Obs.leftPane.setPanel('search');
          Obs.leftPane.searchFor(link.dataset.tag);
          return;
        }
        if (link.classList.contains('external-link') || link.target === '_blank') {
          global.open(link.href, '_blank', 'noopener');
          return;
        }
        if (link.classList.contains('internal-link')) {
          const href = link.dataset.href;
          if (!href) return;
          if (e.ctrlKey || e.metaKey) {   // background tab
            if (!link.classList.contains('is-unresolved')) {
              Obs.tabs.openNote(href, { activate: false });
              Obs.util.notice('Opened in background tab', null, 1200);
            }
            return;
          }
          if (link.classList.contains('is-unresolved')) {
            Obs.vault.createNote(href).then(note => {
              Obs.util.notice('Created “' + note.name + '”', 'success');
              Obs.tabs.openNote(note.path);
            });
          } else {
            Obs.tabs.openNote(href, { heading: link.dataset.heading || null });
          }
          return;
        }
        if (link.getAttribute('href')) global.open(link.getAttribute('href'), '_blank', 'noopener');
      });

      /* double-click in reading view → edit that exact line */
      this.panePreview.addEventListener('dblclick', e => {
        if (e.target.closest && e.target.closest('a, button, input, .callout-title, .frontmatter-header, .markdown-embed-title')) return;
        const block = e.target.closest && e.target.closest('[data-line]');
        if (!block) return;
        const line = parseInt(block.dataset.line, 10) || 0;
        if (this.tab.mode === 'read') {
          const def = Obs.vault.settings.defaultMode === 'read' ? 'split' : Obs.vault.settings.defaultMode;
          this.setMode(def);
        }
        this.scrollEditToLine(line);
      });

      /* ctrl/middle-click internal links → open in background tab */
      this.panePreview.addEventListener('auxclick', e => {
        if (e.button !== 1) return;
        const link = e.target.closest && e.target.closest('a.internal-link:not(.is-unresolved)');
        if (!link || !link.dataset.href) return;
        e.preventDefault();
        Obs.tabs.openNote(link.dataset.href, { activate: false });
        Obs.util.notice('Opened in background tab', null, 1200);
      });

      /* drag & drop: vault notes/images or OS files → insert link at cursor */
      this.bindEditorDnd();

      /* hover page-preview on internal links */
      this.panePreview.addEventListener('mouseover', e => {
        const link = e.target.closest && e.target.closest('a.internal-link:not(.is-unresolved)');
        if (!link || link.dataset.href === this.tab.path) return;
        this.scheduleHover(link);
      });
      this.panePreview.addEventListener('mouseout', e => {
        const link = e.target.closest && e.target.closest('a.internal-link');
        if (link) this.unscheduleHover();
      });

      /* react to external content changes (renames updating links etc.) */
      this._offContent = Obs.bus.on('note:content', ({ path, external }) => {
        if (path === this.tab.path && external && document.activeElement !== this.textarea) {
          const note = this.note;
          if (note) { this.textarea.value = note.content; this.renderPreview(); this.updateStats(); }
        }
      });
      this._offChanged = Obs.bus.on('vault:changed', ev => {
        if (ev && ev.type === 'star' && ev.path === this.tab.path) this.updateStar(this.note && this.note.starred);
        if ((ev.type === 'rename' || ev.type === 'create' || ev.type === 'delete' || ev.type === 'restore' || ev.type === 'add-file') && this.tab.mode !== 'write') {
          this._rerenderSoon = this._rerenderSoon || debounce(() => this.renderPreview(), 250);
          this._rerenderSoon();
        }
      });
      this._offSettings = Obs.bus.on('settings:changed', () => this.applySettings());
      this._offHistory = Obs.bus.on('history:changed', () => this.updateNav());
      this.updateNav();
      this.applySettings();
    }

    applySettings() {
      const s = Obs.vault.settings;
      this.textarea.style.fontFamily = s.monoEditor ? 'var(--font-mono)' : 'var(--font-ui)';
    }

    scheduleHover(link) {
      this.unscheduleHover();
      this._hoverTimer = setTimeout(() => Obs.editor.showHoverPreview(link), 450);
    }
    unscheduleHover() {
      if (this._hoverTimer) { clearTimeout(this._hoverTimer); this._hoverTimer = null; }
    }

    copyText(text) { return Obs.util.copyText(text); }

    toggleTask(cb) {
      const lineIdx = parseInt(cb.dataset.line, 10);
      if (isNaN(lineIdx)) return;
      const lines = this.textarea.value.split('\n');
      if (lineIdx >= lines.length) return;
      const line = lines[lineIdx];
      // Toggle based on the SOURCE line (robust vs. DOM state quirks)
      if (/\[[xX]\]/.test(line)) {
        lines[lineIdx] = line.replace(/\[[xX]\]/, '[ ]');
      } else if (/\[\s?\]/.test(line)) {
        lines[lineIdx] = line.replace(/\[\s?\]/, '[x]');
      } else return;
      this.textarea.value = lines.join('\n');
      this.onEdit();
    }

    onKeydown(e) {
      const ta = this.textarea;
      const mod = e.ctrlKey || e.metaKey;

      if (this.slash && this.slash.handleKey(e)) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart, ePos = ta.selectionEnd;
        const v = ta.value;
        const ls = v.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
        const multiline = v.slice(s, ePos).includes('\n') || s !== ePos && v.slice(ls, ePos).includes('\n');
        if (multiline) {
          let le = v.indexOf('\n', ePos);
          if (le < 0) le = v.length;
          const block = v.slice(ls, le);
          const out = block.split('\n').map(l => e.shiftKey
            ? l.replace(/^(\t| {1,4})/, '')
            : '\t' + l).join('\n');
          ta.setRangeText(out, ls, le, 'end');
        } else if (e.shiftKey) {
          const line = v.slice(ls, s);
          const m = line.match(/^(\t| {1,4})/);
          if (m) { ta.setRangeText('', ls, ls + m[1].length, 'end'); }
        } else {
          ta.setRangeText('\t', s, ePos, 'end');
        }
        this.onEdit();
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !mod) {
        const s = ta.selectionStart;
        if (s !== ta.selectionEnd) return;
        const v = ta.value;
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const line = v.slice(ls, s);
        const m = line.match(/^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?([\s\S]*)$/);
        if (!m) return;
        e.preventDefault();
        const [, indent, marker, space, task, rest] = m;
        if (!rest && !task) {
          // empty item → exit list
          ta.setRangeText('', ls, s, 'end');
          this.onEdit();
          return;
        }
        let nextMarker = marker;
        const om = marker.match(/^(\d+)([.)])$/);
        if (om) nextMarker = (parseInt(om[1], 10) + 1) + om[2];
        const insert = '\n' + indent + nextMarker + (space || ' ') + (task ? '[ ] ' : '');
        ta.setRangeText(insert, s, s, 'end');
        this.onEdit();
        return;
      }

      // wrap selection with pairs
      if (!mod && PAIRS[e.key] && ta.selectionStart !== ta.selectionEnd) {
        e.preventDefault();
        this.wrap(e.key, PAIRS[e.key]);
        return;
      }
      // [[ quick open: typing [[ with empty selection inserts closing brackets
      if (!mod && e.key === '[' && ta.value[ta.selectionStart - 1] === '[' && ta.selectionStart === ta.selectionEnd) {
        e.preventDefault();
        ta.setRangeText('[', ta.selectionStart, ta.selectionEnd, 'end');
        this.onEdit();
        Obs.palette.openSwitcher({ insertTarget: this.textarea });
        return;
      }
    }

    syncScroll(src, dst) {
      if (this.tab.mode !== 'split') return;
      if (Obs.vault.settings.syncScroll === false) return;
      if (this._scrollLock && this._scrollLock !== src) return;
      this._scrollLock = src;
      const range = src.scrollHeight - src.clientHeight;
      const p = range > 0 ? src.scrollTop / range : 0;
      dst.scrollTop = p * (dst.scrollHeight - dst.clientHeight);
      clearTimeout(this._scrollT);
      this._scrollT = setTimeout(() => { this._scrollLock = null; }, 90);
    }

    /* ---------- header menu ---------- */
    openMoreMenu() {
      const path = this.tab.path;
      ui().menu(null, null, [
        { label: 'Rename / move…', icon: 'pencil', onClick: () => Obs.commands.run('rename-note') },
        { label: 'Download .md', icon: 'download', onClick: () => Obs.io.exportNoteMd(path) },
        { label: 'Export as PDF…', icon: 'file-text', onClick: () => Obs.io.exportNotePdf(path) },
        { label: 'Copy markdown', icon: 'copy', onClick: () => this.copyText(this.textarea.value).then(() => Obs.util.notice('Markdown copied')) },
        { label: 'Copy path', icon: 'link', onClick: () => this.copyText(path).then(() => Obs.util.notice(path)) },
        { separator: true },
        { label: 'Open local graph', icon: 'graph', onClick: () => Obs.tabs.openGraph({ rootPath: path, depth: 1 }) },
        { label: 'Insert template…', icon: 'template', onClick: () => Obs.commands.run('insert-template') },
        { separator: true },
        { label: 'Delete note', icon: 'trash', danger: true, onClick: () => Obs.commands.run('delete-note') }
      ], { anchor: this.moreBtn, align: 'right' });
    }

    /* ---------- navigation helpers ---------- */
    scrollPreviewToEl(elm, pad) {
      if (!elm) return;
      this.panePreview.scrollTop += elm.getBoundingClientRect().top - this.panePreview.getBoundingClientRect().top - (pad || 12);
    }

    flashEl(elm) {
      if (!elm) return;
      elm.style.transition = 'background 0.3s';
      elm.style.background = 'var(--accent-soft)';
      setTimeout(() => { elm.style.background = ''; }, 700);
    }

    scrollPreviewToHeading(id) {
      if (!id) return;
      if (this.tab.mode === 'write') this.setMode('split');
      const domId = 'md-' + id;
      const h = this.previewInner.querySelector('#' + (global.CSS && CSS.escape ? CSS.escape(domId) : domId));
      this.scrollPreviewToEl(h, 10);
      this.flashEl(h);
    }

    scrollEditToLine(line) {
      const ta = this.textarea;
      const lines = ta.value.split('\n');
      let off = 0;
      for (let i = 0; i < Math.min(line, lines.length - 1); i++) off += lines[i].length + 1;
      ta.focus();
      ta.setSelectionRange(off, off + (lines[line] ? lines[line].length : 0));
      const cs = getComputedStyle(ta);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.65;
      ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3);
    }

    focusEditor() {
      if (this.tab.mode === 'read') this.setMode(Obs.vault.settings.defaultMode === 'read' ? 'split' : Obs.vault.settings.defaultMode);
      this.textarea.focus();
    }

    destroy() {
      this.destroyed = true;
      this.persistState();
      this.unscheduleHover();
      if (this._offContent) this._offContent();
      if (this._offChanged) this._offChanged();
      if (this._offSettings) this._offSettings();
      if (this._offHistory) this._offHistory();
      if (this._debouncedSave) this._debouncedSave.flush();
      if (this._debouncedRender) this._debouncedRender.cancel();
      if (this._rerenderSoon) this._rerenderSoon.cancel();
      clearTimeout(this._scrollT);
      this._scrollLock = null;
      this.root.remove();
    }
  }

  /* ---------- hover page preview (shared) ---------- */
  let hoverEl = null, hideTimer = null;
  function showHoverPreview(link) {
    if (Obs.ui.openModals.length) return;   // never cover modals
    const path = link.dataset.href;
    const note = Obs.vault.getNote(path);
    if (!note) return;
    const box = document.getElementById('hover-preview');
    clearTimeout(hideTimer);
    const html = Obs.md.render(note.content, {
      resolve: t => Obs.vault.resolveForRender(t),
      fromPath: path,
      renderProperties: false
    });
    Obs.sanitize.setHtml(box, `<div class="hover-title">${escapeHtml(note.name)}</div>` + html);
    const r = link.getBoundingClientRect();
    box.classList.add('visible');
    box.style.cursor = 'pointer';
    box.onclick = () => { hideHoverPreview(); Obs.tabs.openNote(path); };
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + bw > window.innerWidth - 10) left = window.innerWidth - bw - 10;
    if (top + bh > window.innerHeight - 10) top = Math.max(10, r.top - bh - 6);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    hoverEl = box;
    box.onmouseenter = () => clearTimeout(hideTimer);
    box.onmouseleave = () => hideHoverPreview();
  }
  function hideHoverPreview() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const box = document.getElementById('hover-preview');
      if (box) { box.classList.remove('visible'); box.innerHTML = ''; }
      hoverEl = null;
    }, 180);
  }

  Obs.editor = {
    current: null,
    NoteView,
    mount(container, tab) {
      const view = new NoteView(container, tab);
      Obs.editor.current = view;
      return view;
    },
    setSaveState(state) {
      const right = document.getElementById('status-right');
      if (!right) return;
      let ind = right.querySelector('.save-indicator');
      if (!ind) { ind = el('span.status-item.save-indicator'); right.appendChild(ind); }
      if (state === 'saving') { ind.textContent = 'Saving…'; ind.classList.remove('saved', 'save-error'); }
      else if (state === 'error') {
        ind.textContent = 'Not saved ⚠';
        ind.classList.add('save-error');
        ind.classList.remove('saved');
      }
      else {
        ind.textContent = 'Saved ✓';
        ind.classList.add('saved');
        ind.classList.remove('save-error');
        clearTimeout(Obs.editor._saveT);
        Obs.editor._saveT = setTimeout(() => { if (ind) ind.textContent = ''; }, 1600);
      }
    },
    showHoverPreview,
    hideHoverPreview
  };

  // hide hover preview when mouse leaves link (global fallback)
  if (typeof document !== 'undefined') {
    document.addEventListener('mouseover', e => {
      if (hoverEl && !(e.target.closest && (e.target.closest('#hover-preview') || e.target.closest('a.internal-link')))) hideHoverPreview();
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
