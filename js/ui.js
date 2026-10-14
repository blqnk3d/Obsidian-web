/* ============================================================
   ui.js — icons, modals, prompts, confirms, context menus (Obs.ui)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, qs } = Obs.util;

  /* ---------- Icon set (hand-drawn feather-style SVG paths) ---------- */
  const ICONS = {
    'folder': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'folder-plus': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
    'file': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    'file-plus': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11.5v5M9.5 14h5"/>',
    'file-text': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    'image': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-9 9"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
    'graph': '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="9" r="2.4"/><circle cx="11" cy="18" r="2.4"/><path d="M8.2 6.9l7.5 1.5M7 8.3l3.3 7.5M16.7 11.2l-4.2 5"/>',
    'calendar': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
    'sliders': '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="18" r="2" fill="currentColor" stroke="none"/>',
    'star': '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z"/>',
    'star-filled': '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" fill="currentColor"/>',
    'x': '<path d="M6 6l12 12M18 6L6 18"/>',
    'pencil': '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    'book': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    'columns': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    'bold': '<path d="M7 5h5.5a3.25 3.25 0 0 1 0 6.5H7zM7 11.5H13a3.75 3.75 0 0 1 0 7.5H7z"/>',
    'italic': '<path d="M19 5h-9M14 19H5M15 5L9 19"/>',
    'strikethrough': '<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 1 1-1.5 7.5H7M4 12h16"/>',
    'highlighter': '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L12 14l-4 1 1-4z" /><path d="M5 22l1.5-4.5"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'code': '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    'list': '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    'list-ordered': '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 15.5a1.5 1.5 0 1 0-3 0c0 1 3 2.5 3 4H3"/>',
    'check-square': '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    'heading': '<path d="M6 4v16M18 4v16M6 12h12"/>',
    'quote': '<path d="M10 11H6.5A1.5 1.5 0 0 1 5 9.5v-3A1.5 1.5 0 0 1 6.5 5h2A1.5 1.5 0 0 1 10 6.5V11c0 3-1.5 5-4 6.5M21 11h-3.5A1.5 1.5 0 0 1 16 9.5v-3A1.5 1.5 0 0 1 17.5 5h2A1.5 1.5 0 0 1 21 6.5V11c0 3-1.5 5-4 6.5"/>',
    'table': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/>',
    'trash': '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    'more-vertical': '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
    'chevron-right': '<path d="M9 18l6-6-6-6"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
    'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
    'back': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    'forward': '<path d="M5 12h14M12 5l7 7-7 7"/>',
    'tag': '<path d="M20.59 13.41L12 22l-9-9V3h10l7.59 7.59a2 2 0 0 1 0 2.82z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none"/>',
    'hash': '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
    'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9.5 4v16"/>',
    'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14.5 4v16"/>',
    'check': '<path d="M20 6L9 17l-5-5"/>',
    'copy': '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'sun': '<circle cx="12" cy="12" r="4.2"/><path d="M12 1.5v2.2M12 20.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M1.5 12h2.2M20.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
    'moon': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    'plus': '<path d="M12 5v14M5 12h14"/>',
    'external': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
    'dice': '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    'restore': '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/>',
    'database': '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
    'palette-icon': '<circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1.5" fill="currentColor" stroke="none"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.5-.7 1.5-1.5 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.8.7-1.5 1.5-1.5H16a6 6 0 0 0 6-6c0-4.9-4.5-8.8-10-8.8z"/>',
    'merge': '<path d="M8 6l4 4 4-4M12 10v11"/>',
    'template': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    'command': '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z"/>',
    'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    'info': '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
    'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
    'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    'replace': '<path d="M17 3l4 4-4 4M21 7H8M7 21l-4-4 4-4M3 17h13"/>',
    'sort': '<path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 6v14"/>',
    'regex': '<path d="M14 4l6 6M20 4l-6 6M17 3v10M5 17a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0M13 17h8"/>',
    'case-sensitive': '<path d="M3 19L9 5l6 14M5 14h8M17 19v-8m0 0c0-1.5 1.2-2.5 2.5-2.5S22 9.5 22 11v8m-5-4h5"/>',
  };

  function iconHtml(name, size) {
    const body = ICONS[name] || ICONS['file'];
    const s = size ? ` width="${size}" height="${size}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${s}>${body}</svg>`;
  }
  function icon(name, cls, size) {
    const span = el('span' + (cls ? '.' + cls : ''), { html: iconHtml(name, size) });
    return span;
  }

  /* ---------- Modal system ---------- */
  let openModals = [];

  function modal({ title, build, footer, cls, onOpen, onClose, dismissable = true }) {
    const root = qs('#modal-root');
    const backdrop = el('div.modal-backdrop');
    const box = el('div.modal' + (cls ? '.' + cls : ''));
    if (title) {
      const closeBtn = el('button.icon-btn', { html: iconHtml('x', 14), title: 'Close' });
      box.appendChild(el('div.modal-header', {}, [el('span.modal-title', { text: title }), closeBtn]));
      closeBtn.addEventListener('click', () => api.close());
    }
    const body = el('div.modal-body');
    box.appendChild(body);
    let footerEl = null;
    if (footer !== false) {
      footerEl = el('div.modal-footer');
      box.appendChild(footerEl);
    }
    backdrop.appendChild(box);
    root.appendChild(backdrop);

    const api = {
      el: box, body, footer: footerEl, backdrop,
      close() {
        if (api._closed) return;
        api._closed = true;
        openModals = openModals.filter(m => m !== api);
        backdrop.remove();
        document.removeEventListener('keydown', keyHandler, true);
        if (onClose) onClose();
        const prev = openModals[openModals.length - 1];
        if (prev && prev._focus) prev._focus();
      },
      _focus: null
    };
    function keyHandler(e) {
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); e.preventDefault(); api.close(); }
    }
    document.addEventListener('keydown', keyHandler, true);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop && dismissable) api.close(); });

    if (build) build(body, api);
    if (footer && typeof footer === 'function') footer(footerEl, api);
    openModals.push(api);
    if (onOpen) onOpen(api);
    return api;
  }

  /** Simple text prompt modal. opts: {title, label, value, placeholder, okText, onSubmit(value)} */
  function prompt({ title, label, value = '', placeholder = '', okText = 'OK', onSubmit, validate, completions }) {
    const api = modal({
      title,
      build(body, m) {
        const input = el('input', { type: 'text', value, placeholder });
        body.appendChild(el('div.field', {}, [label ? el('label', { text: label }) : null, input]));
        const err = el('div.hint', { style: { color: 'var(--danger)', display: 'none' } });
        body.appendChild(err);
        m._focus = () => { input.focus(); input.select(); };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); m._submit && m._submit(); }
          if (e.key === 'Tab' && completions) {
            const list = completions(input.value) || [];
            if (!list.length) return;
            e.preventDefault();
            if (m._compBase !== input.value || m._compIdx == null) m._compIdx = -1;
            m._compIdx = (m._compIdx + 1) % list.length;
            m._compBase = list[m._compIdx];
            input.value = m._compBase;
          }
        });
        setTimeout(() => m._focus(), 20);
        m._submit = function () {
          const v = input.value.trim();
          if (validate) {
            const msg = validate(v);
            if (msg) { err.textContent = msg; err.style.display = ''; input.focus(); return; }
          }
          m.close();
          if (onSubmit) onSubmit(v);
        };
      },
      footer(footerEl, m) {
        footerEl.appendChild(el('button.btn', { text: 'Cancel', on: { click: () => m.close() } }));
        footerEl.appendChild(el('button.btn.primary', { text: okText, on: { click: () => m._submit && m._submit() } }));
      }
    });
    return api;
  }

  /** Confirm dialog. */
  function confirm({ title = 'Are you sure?', message, okText = 'OK', danger = false, onConfirm }) {
    const api = modal({
      title,
      build(body) {
        body.appendChild(el('div', { text: message, style: { fontSize: '13px', lineHeight: '1.6' } }));
      },
      footer(footerEl, m) {
        footerEl.appendChild(el('button.btn', { text: 'Cancel', on: { click: () => m.close() } }));
        const ok = el('button.btn' + (danger ? '.danger' : '.primary'), { text: okText });
        ok.addEventListener('click', () => { m.close(); if (onConfirm) onConfirm(); });
        footerEl.appendChild(ok);
        m._focus = () => ok.focus();
        setTimeout(() => ok.focus(), 20);
      }
    });
    return api;
  }

  /* ---------- Context / dropdown menu ---------- */
  let activeMenu = null;
  function closeMenu() {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }
    document.removeEventListener('mousedown', outsideClick, true);
    document.removeEventListener('keydown', menuKeys, true);
  }
  function outsideClick(e) {
    if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
  }
  function menuKeys(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); }
  }

  /**
   * menu(x, y, items) or menu(null, null, items, {anchor: element, align:'right'|'left'})
   * items: [{label, icon, hint, danger, disabled, onClick} | {separator:true}]
   */
  function menu(x, y, items, opts) {
    closeMenu();
    opts = opts || {};
    const m = el('div.ctx-menu');
    for (const item of items) {
      if (item.separator) { m.appendChild(el('div.ctx-sep')); continue; }
      const btn = el('button.ctx-item' + (item.danger ? '.danger' : '') + (item.disabled ? '.disabled' : ''), {}, [
        el('span.c-icon', { html: iconHtml(item.icon || 'file', 14) }),
        el('span.c-label', { text: item.label }),
        item.hint ? el('span.c-hint', { text: item.hint }) : null
      ]);
      btn.addEventListener('click', () => { closeMenu(); if (item.onClick) item.onClick(); });
      m.appendChild(btn);
    }
    qs('#menu-root').appendChild(m);

    // position
    const rect = m.getBoundingClientRect();
    if (opts.anchor) {
      const ar = opts.anchor.getBoundingClientRect();
      x = opts.align === 'right' ? ar.right - rect.width : ar.left;
      y = ar.bottom + 4;
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    m.style.left = Math.max(6, Math.min(x, vw - rect.width - 8)) + 'px';
    m.style.top = (y + rect.height > vh - 8 ? Math.max(8, y - rect.height - 8) : Math.min(y, vh - rect.height - 8)) + 'px';

    activeMenu = m;
    setTimeout(() => {
      document.addEventListener('mousedown', outsideClick, true);
      document.addEventListener('keydown', menuKeys, true);
    }, 0);
    return m;
  }

  Obs.ui = { iconHtml, icon, modal, prompt, confirm, menu, closeMenu, get openModals() { return openModals; } };
})(typeof window !== 'undefined' ? window : globalThis);
