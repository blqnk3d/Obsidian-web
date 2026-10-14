/* ============================================================
   settings.js — settings modal (Obs.settingsModal)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, qs, escapeHtml, fmtDate } = Obs.util;
  const ui = () => Obs.ui;
  const vault = () => Obs.vault;

  const ACCENTS = [
    { name: 'Amethyst', value: '#8a7cf8' },
    { name: 'Blue', value: '#4f8ef7' },
    { name: 'Green', value: '#3eb277' },
    { name: 'Orange', value: '#e8933a' },
    { name: 'Red', value: '#e05d5d' },
    { name: 'Teal', value: '#2bb3c0' }
  ];

  const SECTIONS = [
    { id: 'appearance', label: 'Appearance', icon: 'palette-icon' },
    { id: 'editor', label: 'Editor', icon: 'pencil' },
    { id: 'files', label: 'Files & links', icon: 'folder' },
    { id: 'data', label: 'Data', icon: 'database' },
    { id: 'hotkeys', label: 'Hotkeys', icon: 'command' },
    { id: 'about', label: 'About', icon: 'info' }
  ];

  /* ---------- control helpers ---------- */
  function row(name, desc, control) {
    return el('div.setting-row', {}, [
      el('div.setting-info', {}, [
        el('div.setting-name', { text: name }),
        desc ? el('div.setting-desc', { html: desc }) : null
      ]),
      control
    ]);
  }

  function toggleRow(name, desc, key) {
    const t = el('div.toggle' + (vault().settings[key] ? '.on' : ''));
    t.addEventListener('click', () => {
      const v = !t.classList.contains('on');
      t.classList.toggle('on', v);
      vault().saveSettings({ [key]: v });
    });
    return row(name, desc, t);
  }

  function textRow(name, desc, key, placeholder) {
    const inp = el('input', { type: 'text', value: vault().settings[key] || '', placeholder: placeholder || '' });
    inp.addEventListener('change', () => vault().saveSettings({ [key]: inp.value.trim() }));
    return row(name, desc, inp);
  }

  function selectRow(name, desc, key, options) {
    const sel = el('select.input');
    for (const [val, label] of options) {
      const o = el('option', { value: val, text: label });
      if (vault().settings[key] === val) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => vault().saveSettings({ [key]: sel.value }));
    return row(name, desc, sel);
  }

  function rangeRow(name, desc, key, min, max, fmt) {
    const label = el('span', { text: fmt ? fmt(vault().settings[key]) : String(vault().settings[key]) });
    const inp = el('input', { type: 'range', min: String(min), max: String(max), step: '1', value: String(vault().settings[key]) });
    inp.addEventListener('input', () => {
      const v = parseInt(inp.value, 10);
      label.textContent = fmt ? fmt(v) : String(v);
      vault().saveSettings({ [key]: v });
    });
    return row(name, desc, el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [inp, label]));
  }

  /* ---------- sections ---------- */
  function sectionAppearance(body) {
    body.appendChild(el('h3', { text: 'Appearance' }));
    const darkBtn = el('button.btn' + (vault().settings.theme === 'dark' ? '.primary' : ''), { html: ui().iconHtml('moon', 13) + ' Dark' });
    const lightBtn = el('button.btn' + (vault().settings.theme === 'light' ? '.primary' : ''), { html: ui().iconHtml('sun', 13) + ' Light' });
    darkBtn.addEventListener('click', () => { vault().saveSettings({ theme: 'dark' }); Obs.bus.emit('theme:changed', 'dark'); });
    lightBtn.addEventListener('click', () => { vault().saveSettings({ theme: 'light' }); Obs.bus.emit('theme:changed', 'light'); });
    body.appendChild(row('Base theme', 'Dark is easier on the eyes, light for bright rooms.', el('div', { style: { display: 'flex', gap: '8px' } }, [darkBtn, lightBtn])));

    const swatches = el('div.accent-swatches');
    for (const a of ACCENTS) {
      const s = el('button.accent-swatch' + (vault().settings.accent === a.value ? '.selected' : ''), { style: { background: a.value }, title: a.name });
      s.addEventListener('click', () => {
        vault().saveSettings({ accent: a.value });
        swatches.querySelectorAll('.accent-swatch').forEach(x => x.classList.remove('selected'));
        s.classList.add('selected');
      });
      swatches.appendChild(s);
    }
    body.appendChild(row('Accent color', 'Used for links, buttons and the graph.', swatches));
    body.appendChild(textRow('Vault name', 'Used for export file names.', 'vaultName', 'My Vault'));
  }

  function sectionEditor(body) {
    body.appendChild(el('h3', { text: 'Editor' }));
    body.appendChild(selectRow('Default view mode', 'Mode used when opening notes.', 'defaultMode', [['write', 'Writing (editor only)'], ['split', 'Split (editor + preview)'], ['read', 'Reading (preview only)']]));
    body.appendChild(toggleRow('Synchronized scrolling', 'In split mode, editor and preview scroll together.', 'syncScroll'));
    body.appendChild(toggleRow('Show properties (frontmatter)', 'Render YAML frontmatter as a collapsible properties block in reading view.', 'showFrontmatter'));
    body.appendChild(toggleRow('Monospace editor font', 'Use a fixed-width font while writing.', 'monoEditor'));
    body.appendChild(rangeRow('Text size', 'Font size of editor & preview.', 'editorFontSize', 12, 22, v => v + 'px'));
  }

  function sectionFiles(body) {
    body.appendChild(el('h3', { text: 'Files & links' }));
    body.appendChild(textRow('Default folder for new notes', 'Leave empty for the vault root.', 'newNoteFolder', 'e.g. Notes'));
    body.appendChild(textRow('Daily notes folder', '', 'dailyFolder', 'Daily'));
    body.appendChild(textRow('Daily note date format', 'Tokens: YYYY MM DD HH mm ss', 'dailyFormat', 'YYYY-MM-DD'));
    body.appendChild(textRow('Templates folder', 'Notes in this folder appear in “Insert template”.', 'templateFolder', 'Templates'));
    body.appendChild(textRow('Attachment folder', 'Imported / pasted images are stored here.', 'attachmentFolder', 'Attachments'));
    body.appendChild(toggleRow('Automatically update internal links', 'When renaming or moving a note, rewrite [[wikilinks]] in all other notes.', 'updateLinksOnRename'));
  }

  function sectionData(body) {
    body.appendChild(el('h3', { text: 'Data & storage' }));
    const s = vault().stats();
    const stats = el('div.setting-desc', { html: `<b>${s.notes}</b> notes · <b>${s.files}</b> attachments · <b>${s.words.toLocaleString()}</b> words · ~<b>${(s.bytes / 1024).toFixed(0)} KB</b> of text` });
    body.appendChild(row('Vault statistics', '', stats));

    const usageWrap = el('div', { style: { flex: 1 } });
    const usageBar = el('div.usage-bar', {}, [el('div.usage-bar-fill', { style: { width: '0%' } })]);
    const usageText = el('div.setting-desc', { text: 'Calculating…' });
    usageWrap.append(usageText, usageBar);
    body.appendChild(row('Browser storage (IndexedDB)', 'Your vault lives in this browser’s storage.', usageWrap));
    Obs.db.estimateUsage().then(u => {
      if (u.quota) {
        usageBar.firstChild.style.width = Math.max(1, Math.min(100, (u.usage / u.quota) * 100)) + '%';
        usageText.textContent = `${(u.usage / 1048576).toFixed(1)} MB used of ${(u.quota / 1048576).toFixed(0)} MB available`;
      } else {
        usageText.textContent = `${(u.usage / 1048576).toFixed(1)} MB used`;
      }
    }).catch(() => { usageText.textContent = 'Storage estimate unavailable.'; });

    const btnRow = (label, icon, fn, cls) => { const b = el('button.btn' + (cls ? '.' + cls : ''), { html: ui().iconHtml(icon, 13) + ' ' + escapeHtml(label) }); b.addEventListener('click', fn); return b; };
    body.appendChild(el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '14px 0' } }, [
      btnRow('Export vault (.zip)', 'download', () => Obs.io.exportVaultZip()),
      btnRow('Export JSON backup', 'database', () => Obs.io.exportJson()),
      btnRow('Import JSON backup', 'upload', () => qs('#import-json-input').click()),
      btnRow('Import .md / images', 'upload', () => qs('#import-files-input').click()),
      btnRow('Import folder', 'folder-plus', () => qs('#import-dir-input').click()),
      btnRow(`Trash (${vault().trashCount})`, 'trash', () => Obs.palette.openTrash())
    ]));

    const danger = el('div.danger-zone', {}, [
      el('h4', { text: 'Danger zone' }),
      el('div.setting-desc', { text: 'Permanently erase every note, attachment and setting stored in this browser. Export a backup first!' }),
      (() => {
        const b = el('button.btn.danger', { text: 'Erase all data…', style: { marginTop: '8px' } });
        b.addEventListener('click', () => {
          ui().confirm({
            title: 'Erase everything?', danger: true, okText: 'Erase all data',
            message: 'This deletes ALL notes, attachments, trash and settings from IndexedDB. This cannot be undone.',
            onConfirm: async () => {
              await Obs.db.wipeAll();
              location.reload();
            }
          });
        });
        return b;
      })()
    ]);
    body.appendChild(danger);
  }

  function sectionHotkeys(body) {
    body.appendChild(el('h3', { text: 'Keyboard shortcuts' }));
    const table = el('table.hotkey-table');
    const rows = Obs.commands.list.filter(c => c.hotkeyLabel);
    const extra = [
      ['Toggle task checkbox', 'Click in preview'],
      ['Open linked note', 'Click link in preview'],
      ['Create note from link', 'Click unresolved (dim) link'],
      ['Close tab', 'Middle-click tab'],
      ['Link autocomplete', 'Type [[ while editing'],
      ['Rename note', 'Click title in header']
    ];
    for (const c of rows) table.appendChild(el('tr', {}, [el('td', { text: c.name }), el('td', {}, [el('kbd', { text: c.hotkeyLabel })])]));
    for (const [name, key] of extra) table.appendChild(el('tr', {}, [el('td', { text: name }), el('td', {}, [el('kbd', { text: key })])]));
    body.appendChild(table);
  }

  function sectionAbout(body) {
    body.appendChild(el('h3', { text: 'About' }));
    body.appendChild(el('div.setting-desc', { html: `
      <p><b>Obsidian Web</b> — a local-first, single-page markdown knowledge base inspired by Obsidian.</p>
      <p>Built with plain HTML, CSS and JavaScript — <b>no external libraries, no build step, no network requests</b>. All notes live in this browser’s IndexedDB and never leave your machine unless you export them.</p>
      <p>Version 1.0 · Export your vault any time as <b>.zip</b> (folder structure + attachments), single <b>.md</b> files, or a <b>JSON</b> backup.</p>
      <p>Not affiliated with Obsidian (obsidian.md).</p>` }));
    const s = vault().stats();
    body.appendChild(row('Vault', '', el('div.setting-desc', { text: `${vault().settings.vaultName} — ${s.notes} notes, ${s.tags} tags, created exports on ${fmtDate(new Date(), 'YYYY-MM-DD')}` })));
  }

  const SECTION_FUNCS = {
    appearance: sectionAppearance,
    editor: sectionEditor,
    files: sectionFiles,
    data: sectionData,
    hotkeys: sectionHotkeys,
    about: sectionAbout
  };

  function open(initialSection) {
    let current = initialSection || 'appearance';
    ui().modal({
      title: 'Settings', footer: false, cls: 'settings-modal',
      build(body) {
        body.style.padding = '0';
        const layout = el('div.settings-layout');
        const nav = el('div.settings-nav');
        const content = el('div.settings-content');
        layout.append(nav, content);
        body.appendChild(layout);

        function select(id) {
          current = id;
          nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.section === id));
          content.innerHTML = '';
          SECTION_FUNCS[id](content);
        }
        for (const s of SECTIONS) {
          const b = el('button', { dataset: { section: s.id }, html: ui().iconHtml(s.icon, 13) + '&nbsp; ' + escapeHtml(s.label), style: { display: 'flex', alignItems: 'center', gap: '8px' } });
          b.addEventListener('click', () => select(s.id));
          nav.appendChild(b);
        }
        select(current);
      }
    });
  }

  Obs.settingsModal = { open };
})(typeof window !== 'undefined' ? window : globalThis);
