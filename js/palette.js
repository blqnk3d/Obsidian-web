/* ============================================================
   palette.js — fuzzy suggester modals (Obs.palette)
   Command palette · Quick switcher · Templates · Trash
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, fuzzyScore, escapeHtml, stripExt, baseName, fmtDate } = Obs.util;
  const ui = () => Obs.ui;

  /**
   * Generic suggester.
   * opts: {title, placeholder, getItems(query) -> [{icon,label,sub,hotkeys,run}],
   *        onEnterNone(query, api), footerHints:[html], emptyText}
   */
  function suggester(opts) {
    let items = [];
    let selected = 0;

    const api = ui().modal({
      title: null, footer: false, cls: 'palette', dismissable: true,
      build(body, m) {
        body.style.padding = '0';
        body.parentElement.style.overflow = 'visible';
        const inputRow = el('div.palette-input-row');
        const input = el('input.palette-input', { type: 'text', placeholder: opts.placeholder || '', spellcheck: 'false' });
        inputRow.appendChild(input);
        body.appendChild(inputRow);
        const results = el('div.palette-results');
        body.appendChild(results);
        if (opts.footerHints) {
          body.appendChild(el('div.palette-footer', { html: opts.footerHints.map(h => `<span>${h}</span>`).join('') }));
        }

        function render() {
          results.innerHTML = '';
          if (!items.length) {
            results.appendChild(el('div.palette-empty', { html: opts.emptyText || (input.value ? 'No matches — Enter to create' : 'Nothing here yet') }));
            return;
          }
          items.slice(0, 60).forEach((it, idx) => {
            const row = el('div.palette-item' + (idx === selected ? '.selected' : ''), {}, [
              el('span.p-icon', { html: ui().iconHtml(it.icon || 'file', 15) }),
              el('div.p-main', {}, [
                el('div.p-label', { html: it.labelHtml || escapeHtml(it.label) }),
                it.sub ? el('div.p-sub', { text: it.sub }) : null
              ]),
              it.hotkeys ? el('div.p-hotkey', {}, it.hotkeys.map(k => el('kbd', { text: k }))) : null
            ]);
            row.addEventListener('mouseenter', () => { selected = idx; markSelected(); });
            row.addEventListener('click', () => { m.close(); it.run && it.run(); });
            results.appendChild(row);
          });
          const sel = results.querySelector('.palette-item.selected');
          if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
        }

        function markSelected() {
          results.querySelectorAll('.palette-item').forEach((r, i) => r.classList.toggle('selected', i === selected));
          const sel = results.querySelector('.palette-item.selected');
          if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
        }

        function update() {
          const q = input.value.trim();
          items = opts.getItems(q) || [];
          selected = 0;
          render();
        }

        input.addEventListener('input', update);
        input.addEventListener('keydown', e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, Math.min(items.length, 60) - 1); markSelected(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); markSelected(); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            const it = items[selected];
            m.close();
            if (it) it.run && it.run();
            else if (opts.onEnterNone) opts.onEnterNone(input.value.trim());
          }
          else if (e.key === 'Tab' && items.length) {
            // Tab cycles through the candidates (Shift+Tab backwards)
            e.preventDefault();
            const n = Math.min(items.length, 60);
            selected = (selected + (e.shiftKey ? -1 : 1) + n) % n;
            markSelected();
          }
        });

        m._focus = () => input.focus();
        setTimeout(() => { input.focus(); update(); }, 15);
      }
    });
    return api;
  }

  /* ---------- command palette (Ctrl+P) ---------- */
  function openCommands() {
    const all = Obs.commands.list.slice().sort((a, b) => a.name.localeCompare(b.name));
    suggester({
      placeholder: 'Type a command…',
      footerHints: ['<kbd>↑↓</kbd> navigate', '<kbd>⏎</kbd> run', '<kbd>esc</kbd> close'],
      getItems(q) {
        const scored = [];
        for (const c of all) {
          if (c.hidden) continue;
          if (c.when && !c.when()) continue;
          const s = q ? fuzzyScore(q, c.name) : 1;
          if (s != null) scored.push({ c, s });
        }
        scored.sort((a, b) => b.s - a.s);
        return scored.map(({ c }) => ({
          icon: c.icon || 'command',
          label: c.name,
          hotkeys: c.hotkeyLabel ? [c.hotkeyLabel] : null,
          run: () => Obs.commands.run(c.id)
        }));
      },
      emptyText: 'No matching commands'
    });
  }

  /* ---------- quick switcher (Ctrl+O) ---------- */
  function openSwitcher(opts) {
    opts = opts || {};
    const insertTarget = opts.insertTarget || null;
    let startPos = null;
    if (insertTarget) startPos = insertTarget.selectionStart;

    const makeItem = note => ({
      icon: note.starred ? 'star-filled' : 'file-text',
      label: note.name,
      sub: note.folder ? note.folder + '/' : '',
      complete: note.name,
      run: () => pickNote(note)
    });

    function pickNote(note) {
      if (insertTarget) {
        insertTarget.focus();
        insertTarget.setRangeText(note.name + ']]', startPos, startPos, 'end');
        if (Obs.editor.current) Obs.editor.current.onEdit();
      } else {
        Obs.tabs.openNote(note.path);
      }
    }

    suggester({
      placeholder: insertTarget ? 'Link to note… (Enter creates new)' : 'Open note… (type to search, Enter creates)',
      footerHints: ['<kbd>↑↓</kbd> navigate', '<kbd>⏎</kbd> open / create', '<kbd>esc</kbd> close'],
      getItems(q) {
        const notes = Obs.vault.fuzzyFindNotes(q, 50);
        return notes.map(makeItem);
      },
      onEnterNone(q) {
        if (!q) return;
        Obs.vault.createNote(q).then(note => {
          Obs.util.notice('Created “' + note.name + '”', 'success');
          if (insertTarget) {
            insertTarget.focus();
            insertTarget.setRangeText(note.name + ']]', startPos, startPos, 'end');
            if (Obs.editor.current) Obs.editor.current.onEdit();
          } else {
            Obs.tabs.openNote(note.path);
          }
        });
      },
      emptyText: 'No matching notes — Enter to create'
    });
  }

  /* ---------- templates ---------- */
  function openTemplates(onPick) {
    const tpl = Obs.vault.templateNotes();
    suggester({
      placeholder: 'Insert template…',
      getItems(q) {
        return tpl
          .filter(t => !q || fuzzyScore(q, t.name) != null)
          .map(t => ({ icon: 'template', label: t.name, sub: stripExt(t.path), run: () => onPick(t) }));
      },
      emptyText: tpl.length ? 'No matching templates' : `No templates yet — put notes in the “${escapeHtml(Obs.vault.settings.templateFolder)}” folder`
    });
  }

  /* ---------- trash ---------- */
  async function openTrash() {
    const items = await Obs.vault.listTrash();
    ui().modal({
      title: `Trash (${items.length})`,
      footer: false,
      build(body) {
        if (!items.length) {
          body.appendChild(el('div.palette-empty', { text: 'Trash is empty.' }));
          return;
        }
        for (const it of items) {
          const row = el('div.trash-item', {}, [
            el('span', { html: ui().iconHtml(it.kind === 'note' ? 'file-text' : 'image', 14) }),
            el('span.ti-name', { text: it.path, title: it.path }),
            el('span.ti-date', { text: fmtDate(new Date(it.deleted), 'YYYY-MM-DD HH:mm') }),
            (() => { const b = el('button.btn', { text: 'Restore' }); b.addEventListener('click', async () => { await Obs.vault.restoreFromTrash(it.path); Obs.util.notice('Restored ' + baseName(it.path), 'success'); ui().closeMenu(); openTrashRefresh(); }); return b; })(),
            (() => { const b = el('button.btn.danger', { text: 'Delete forever' }); b.addEventListener('click', () => {
              ui().confirm({ title: 'Delete forever?', message: it.path + ' will be permanently erased.', okText: 'Erase', danger: true, onConfirm: async () => { await Obs.vault.purgeTrash(it.path); openTrashRefresh(); } });
            }); return b; })()
          ]);
          body.appendChild(row);
        }
        const emptyBtn = el('button.btn.danger', { text: 'Empty trash', style: { marginTop: '12px' } });
        emptyBtn.addEventListener('click', () => {
          ui().confirm({ title: 'Empty trash?', message: 'All ' + items.length + ' item(s) will be permanently erased.', okText: 'Empty', danger: true, onConfirm: async () => { await Obs.vault.emptyTrash(); openTrashRefresh(); } });
        });
        body.appendChild(emptyBtn);
      }
    });
    function openTrashRefresh() {
      const top = ui().openModals[ui().openModals.length - 1];
      if (top) top.close();
      openTrash();
    }
  }

  Obs.palette = { suggester, openCommands, openSwitcher, openTemplates, openTrash };
})(typeof window !== 'undefined' ? window : globalThis);
