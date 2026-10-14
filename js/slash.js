/* ============================================================
   slash.js — inline "/" command menu for the editor (Obs.slash)
   Type "/" while writing: /link, /embed, /image, /template,
   /callout, /h1…/h4, /table, /task, /code, /quote, /hr, /date…
   Tab enters a picker stage and then TAB CYCLES through notes /
   images / templates / callout types; Enter inserts.
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, escapeHtml, fuzzyScore, baseName, stripExt, fmtDate } = Obs.util;
  const ui = () => Obs.ui;
  const vault = () => Obs.vault;

  const CALLOUT_TYPES = ['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote'];

  const SNIPPETS = {
    table: '\n| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |\n',
    hr: '\n---\n',
    code: '\n```\ncode\n```\n'
  };

  /* caret coordinates inside a textarea (mirror-div technique) */
  function caretCoords(ta, position) {
    const div = document.createElement('div');
    const cs = getComputedStyle(ta);
    const props = ['boxSizing', 'width', 'height', 'overflow', 'overflowWrap', 'whiteSpace', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontSize', 'fontFamily', 'fontWeight', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'];
    div.style.cssText = 'position:absolute;visibility:hidden;top:0;left:-9999px;white-space:pre-wrap;';
    for (const p of props) div.style[p] = cs[p];
    div.textContent = ta.value.slice(0, position);
    const span = document.createElement('span');
    span.textContent = ta.value.slice(position) || '.';
    div.appendChild(span);
    ta.parentElement.appendChild(div);
    const top = span.offsetTop;
    const left = span.offsetLeft;
    div.remove();
    return { top, left };
  }

  class SlashMenu {
    constructor(view) {
      this.view = view;
      this.ta = view.textarea;
      this.open = false;
      this.stage = 1;
      this.items = [];
      this.sel = 0;
      this.tokenStart = -1;
      this.query = '';
      this.kind = null;      // stage-2 provider: note|image|template|callout
      this.embed = false;
      this.menu = el('div.slash-menu.hidden');
      this.menu.addEventListener('mousedown', e => e.preventDefault()); // keep caret
      view.paneEdit.appendChild(this.menu);
    }

    /* ---------- input monitoring ---------- */
    onInput() {
      const ta = this.ta;
      if (ta.selectionStart !== ta.selectionEnd) return this.close();
      const caret = ta.selectionStart;
      const upto = ta.value.slice(0, caret);
      if (this.open && this.stage === 2) {
        const token = upto.slice(this.tokenStart);
        const m = token.match(/^\/[a-z0-9-]+\s?([\s\S]*)$/i);
        if (this.tokenStart < 0 || !m) return this.close();
        this.query = m[1] || '';
        this.refreshItems();
        this.render();
        return;
      }
      const m1 = upto.match(/(?:^|\n|[ \t])\/([a-zA-Z0-9-]*)$/);
      if (!m1) { if (this.open) this.close(); return; }
      this.stage = 1;
      this.kind = null;
      this.tokenStart = caret - m1[1].length - 1;
      this.query = m1[1];
      this.refreshItems();
      this.open = true;
      this.menu.classList.remove('hidden');
      this.position();
      this.render();
    }

    /* ---------- items ---------- */
    stage1Items() {
      const cmds = [
        { id: 'link', label: 'link', sub: 'Insert [[note]] — Tab browses your notes', icon: 'link', stage2: 'note' },
        { id: 'embed', label: 'embed', sub: 'Embed ![[note]] inline', icon: 'copy', stage2: 'note', embed: true },
        { id: 'image', label: 'image', sub: 'Embed ![[image]] from attachments', icon: 'image', stage2: 'image', embed: true },
        { id: 'template', label: 'template', sub: 'Insert template (Tab to pick)', icon: 'template', stage2: 'template' },
        { id: 'callout', label: 'callout', sub: 'Callout block (Tab to pick type)', icon: 'quote', stage2: 'callout' },
        { id: 'h1', label: 'h1', sub: 'Heading 1', icon: 'heading', act: v => v.lineToggle(/^#{1,6}\s+/, '# ', 'Heading') },
        { id: 'h2', label: 'h2', sub: 'Heading 2', icon: 'heading', act: v => v.lineToggle(/^#{1,6}\s+/, '## ', 'Heading') },
        { id: 'h3', label: 'h3', sub: 'Heading 3', icon: 'heading', act: v => v.lineToggle(/^#{1,6}\s+/, '### ', 'Heading') },
        { id: 'h4', label: 'h4', sub: 'Heading 4', icon: 'heading', act: v => v.lineToggle(/^#{1,6}\s+/, '#### ', 'Heading') },
        { id: 'task', label: 'task', sub: 'Task list item', icon: 'check-square', act: v => v.lineToggle(/^\s*[-*+]\s+\[[ xX]\]\s+/, '- [ ] ', 'task') },
        { id: 'bullet', label: 'list', sub: 'Bullet list', icon: 'list', act: v => v.lineToggle(/^\s*[-*+]\s+/, '- ', 'item') },
        { id: 'table', label: 'table', sub: 'Insert table', icon: 'table', act: v => v.insertAtCursor(SNIPPETS.table) },
        { id: 'code', label: 'code', sub: 'Code block', icon: 'code', act: v => v.wrap('\n```\n', '\n```\n', 'code') },
        { id: 'quote', label: 'quote', sub: 'Blockquote', icon: 'quote', act: v => v.lineToggle(/^\s*>\s?/, '> ', 'quote') },
        { id: 'hr', label: 'hr', sub: 'Horizontal rule', icon: 'list', act: v => v.insertAtCursor(SNIPPETS.hr) },
        { id: 'date', label: 'date', sub: 'Insert today’s date', icon: 'calendar', act: v => v.insertAtCursor(fmtDate(new Date(), vault().settings.dailyFormat || 'YYYY-MM-DD')) },
        { id: 'time', label: 'time', sub: 'Insert current time', icon: 'clock', act: v => v.insertAtCursor(fmtDate(new Date(), 'HH:mm')) },
        { id: 'footnote', label: 'footnote', sub: 'Insert footnote + definition', icon: 'info', act: v => {
          const src = (v.textarea && v.textarea.value) || '';
          const re = /\[\^(\d+)\]/g; let m, max = 0;
          while ((m = re.exec(src)) !== null) { const n = parseInt(m[1], 10); if (n > max) max = n; }
          const n = max + 1;
          v.insertAtCursor('[^' + n + ']\n\n[^' + n + ']: ');
        } }
      ];
      const q = this.query.toLowerCase();
      return cmds.filter(c => !q || fuzzyScore(q, c.label) != null || c.sub.toLowerCase().includes(q))
        .sort((a, b) => (q ? (fuzzyScore(q, b.label) || 0) - (fuzzyScore(q, a.label) || 0) : 0));
    }

    stage2Items() {
      const q = this.query.trim();
      if (this.kind === 'note') {
        return vault().fuzzyFindNotes(q, 40).map(n => ({
          id: n.path, label: n.name, sub: n.folder ? n.folder + '/' : '', icon: n.starred ? 'star-filled' : 'file-text',
          apply: () => (this.embed ? '![[' : '[[') + n.name + ']]'
        }));
      }
      if (this.kind === 'image') {
        const files = [...vault().files.values()].filter(f => vault().isImagePath(f.path));
        const scored = files.map(f => ({ f, s: q ? fuzzyScore(q, baseName(f.path)) : 1 })).filter(x => x.s != null)
          .sort((a, b) => (b.s || 0) - (a.s || 0));
        return scored.slice(0, 40).map(({ f }) => ({
          id: f.path, label: baseName(f.path), sub: 'attachment', icon: 'image',
          apply: () => '![[' + baseName(f.path) + ']]'
        }));
      }
      if (this.kind === 'template') {
        return vault().templateNotes().filter(t => !q || fuzzyScore(q, t.name) != null).slice(0, 40).map(t => ({
          id: t.path, label: t.name, sub: 'template', icon: 'template',
          apply: () => vault().renderTemplate(t.content, this.view.note)
        }));
      }
      if (this.kind === 'callout') {
        return CALLOUT_TYPES.filter(t => !q || t.startsWith(q.toLowerCase())).map(t => ({
          id: t, label: t, sub: 'callout type', icon: 'quote',
          apply: () => '\n> [!' + t + '] \n> '
        }));
      }
      return [];
    }

    refreshItems() {
      this.items = this.stage === 1 ? this.stage1Items() : this.stage2Items();
      this.sel = Math.min(this.sel, Math.max(0, this.items.length - 1));
      if (!this.items.length) this.sel = 0;
    }

    /* ---------- rendering ---------- */
    render() {
      const head = this.stage === 2
        ? `<div class="sm-head">${escapeHtml(this.kind === 'callout' ? 'callout type' : this.kind + ' — Tab cycles, Enter inserts, Esc closes')}</div>`
        : `<div class="sm-head">/ commands — Tab enters picker & cycles</div>`;
      this.menu.innerHTML = head + this.items.slice(0, 40).map((it, i) =>
        `<div class="slash-item${i === this.sel ? ' selected' : ''}" data-i="${i}">` +
        `<span class="p-icon">${ui().iconHtml(it.icon || 'file', 14)}</span>` +
        `<span class="p-main"><span class="p-label">${escapeHtml(it.label)}</span>` +
        (it.sub ? `<span class="p-sub">${escapeHtml(it.sub)}</span>` : '') +
        `</span></div>`
      ).join('') || '<div class="palette-empty">No matches</div>';
      this.menu.querySelectorAll('.slash-item').forEach(row => {
        row.addEventListener('mouseenter', () => { this.sel = +row.dataset.i; this.markSel(); });
        row.addEventListener('click', () => this.applySel());
      });
      this.markSel();
    }

    markSel() {
      this.menu.querySelectorAll('.slash-item').forEach((r, i) => r.classList.toggle('selected', i === this.sel));
      const s = this.menu.querySelector('.slash-item.selected');
      if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' });
    }

    position() {
      const c = caretCoords(this.ta, this.tokenStart < 0 ? this.ta.selectionStart : this.tokenStart);
      const taR = this.ta.getBoundingClientRect();
      const paneR = this.view.paneEdit.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 22;
      let x = taR.left - paneR.left + c.left + 4;
      let y = taR.top - paneR.top + c.top - this.ta.scrollTop + lh + 6;
      const mw = 320, mh = 260;
      x = Math.max(6, Math.min(x, paneR.width - mw - 6));
      if (y + mh > paneR.height - 6) y = Math.max(6, y - mh - lh - 12);
      this.menu.style.left = x + 'px';
      this.menu.style.top = y + 'px';
    }

    /* ---------- keyboard ---------- */
    handleKey(e) {
      if (!this.open) return false;
      const k = e.key;
      if (k === 'ArrowDown') { e.preventDefault(); this.sel = (this.sel + 1) % Math.max(1, this.items.length); this.markSel(); return true; }
      if (k === 'ArrowUp') { e.preventDefault(); this.sel = (this.sel - 1 + Math.max(1, this.items.length)) % Math.max(1, this.items.length); this.markSel(); return true; }
      if (k === 'Tab') {
        e.preventDefault();
        const it = this.items[this.sel];
        if (this.stage === 1 && it && it.stage2) this.enterStage2(it);
        else { this.sel = (this.sel + (e.shiftKey ? -1 : 1) + Math.max(1, this.items.length)) % Math.max(1, this.items.length); this.markSel(); }
        return true;
      }
      if (k === 'Enter') {
        const it = this.items[this.sel];
        if (!it) return false;
        e.preventDefault();
        if (this.stage === 1 && it.stage2) this.enterStage2(it);
        else this.applySel();
        return true;
      }
      if (k === ' ') {
        const it = this.items[this.sel];
        if (this.stage === 1 && it && it.stage2 && it.label === this.query) {
          e.preventDefault();
          this.enterStage2(it);
          return true;
        }
        return false;
      }
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return true; }
      return false;
    }

    enterStage2(cmd) {
      this.stage = 2;
      this.kind = cmd.stage2;
      this.embed = !!cmd.embed;
      this.query = '';
      this.sel = 0;
      this.refreshItems();
      this.render();
      this.position();
    }

    /* ---------- apply ---------- */
    applySel() {
      const it = this.items[this.sel];
      if (!it) return;
      const ta = this.ta;
      const caret = ta.selectionStart;
      if (this.stage === 1) {
        ta.setRangeText('', this.tokenStart, caret, 'end');
        this.close();
        if (it.act) it.act(this.view);
        else if (it.stage2) { /* unreachable: stage2 entered via Tab/Enter */ }
        this.view.onEdit();
        return;
      }
      const text = it.apply();
      ta.setRangeText(text, this.tokenStart, caret, 'end');
      this.close();
      this.view.onEdit();
      ta.focus();
    }

    close() {
      this.open = false;
      this.stage = 1;
      this.kind = null;
      this.tokenStart = -1;
      this.menu.classList.add('hidden');
    }
  }

  Obs.slash = { create: view => new SlashMenu(view), SlashMenu };
})(typeof window !== 'undefined' ? window : globalThis);
