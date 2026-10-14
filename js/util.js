/* ============================================================
   util.js — small pure helpers + event bus (Obs.util / Obs.bus)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};

  /* ---------- Event bus ---------- */
  const listeners = Object.create(null);
  const bus = {
    on(evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return () => bus.off(evt, fn);
    },
    off(evt, fn) {
      const arr = listeners[evt];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    emit(evt, payload) {
      const arr = listeners[evt];
      if (arr) for (const fn of arr.slice()) {
        try { fn(payload); } catch (e) { console.error('[bus]', evt, e); }
      }
    }
  };
  Obs.bus = bus;

  /* ---------- DOM helpers ---------- */
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** el('div.cls#id', {attrs..., on:{evt:fn}, html|text}, children) */
  function el(spec, props, children) {
    let tag = 'div', cls = '', id = '';
    const m = String(spec).match(/^([a-zA-Z0-9-]+)?((?:[.#][\w-]+)*)$/);
    if (m) {
      if (m[1]) tag = m[1];
      for (const part of (m[2] || '').split(/(?=[.#])/)) {
        if (part[0] === '.') cls += (cls ? ' ' : '') + part.slice(1);
        else if (part[0] === '#') id = part.slice(1);
      }
    }
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (id) node.id = id;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null) continue;
        if (k === 'on') { for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn); }
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style') Object.assign(node.style, v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'value') node.value = v;
        else if (k === 'checked' || k === 'disabled') node[k] = !!v;
        else node.setAttribute(k, v);
      }
    }
    if (children) for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function on(node, evt, fn, opts) { node.addEventListener(evt, fn, opts); return () => node.removeEventListener(evt, fn, opts); }

  /* ---------- Functions ---------- */
  function debounce(fn, ms) {
    let t = null;
    const d = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(this, args); }, ms);
    };
    d.cancel = () => clearTimeout(t);
    d.flush = function (...args) { if (t) { clearTimeout(t); t = null; fn.apply(this, args); } };
    return d;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- Strings ---------- */
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const UNESC_MAP = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ESC_MAP[c]);
  const unescapeHtml = s => String(s).replace(/&(amp|lt|gt|quot|#39|#x27);/g, e => UNESC_MAP[e] || e);

  function slugify(text) {
    return String(text).toLowerCase().trim()
      .replace(/[^\w\u00C0-\uFFFF\- ]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'section';
  }

  /** Fuzzy subsequence match. Returns score (higher = better) or null. */
  function fuzzyScore(query, text) {
    if (!query) return 0;
    const q = query.toLowerCase(), t = text.toLowerCase();
    const exact = t.indexOf(q);
    let qi = 0, score = 0, streak = 0, lastIdx = -2;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        let s = 1;
        if (ti === 0 || /[\s\-_./\\()[\]#:|]/.test(t[ti - 1])) s += 6;      // word start
        else if (text[ti] && t[ti] !== text[ti] && text[ti] === text[ti].toUpperCase()) s += 4; // camel
        if (ti === lastIdx + 1) { streak++; s += Math.min(streak * 2, 10); } else streak = 0;
        score += s;
        lastIdx = ti;
        qi++;
      }
    }
    if (qi < q.length) return null;
    if (exact === 0) score += 25;
    else if (exact > 0) score += 12;
    score -= (t.length - q.length) * 0.05;
    return score;
  }

  /* ---------- Paths ---------- */
  const normalizePath = p => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '').trim();
  const baseName = p => { const s = normalizePath(p).split('/'); return s[s.length - 1] || ''; };
  const dirName = p => { const n = normalizePath(p); const i = n.lastIndexOf('/'); return i < 0 ? '' : n.slice(0, i); };
  const extName = p => { const b = baseName(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i + 1).toLowerCase(); };
  const stripExt = p => { const n = normalizePath(p); const i = n.lastIndexOf('.'); return (i > n.lastIndexOf('/') && i > 0) ? n.slice(0, i) : n; };
  const joinPath = (dir, name) => dir ? normalizePath(dir) + '/' + name : name;

  const ILLEGAL_PATH = /[#"*<>:|?^\u0000-\u001F]/g;
  const sanitizePathComponent = s => String(s).replace(ILLEGAL_PATH, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'Untitled';

  /** Normalize an untrusted relative path (imports, ZIP entry names).
      Resolves ".." traversal and drops absolute roots/empty segments, so a
      crafted path can never escape the vault. Legal names are kept as-is. */
  function safeRelPath(p) {
    const parts = [];
    for (let seg of normalizePath(p).split('/')) {
      seg = seg.replace(ILLEGAL_PATH, '').trim();
      if (!seg || seg === '.') continue;
      if (seg === '..') { parts.pop(); continue; }
      parts.push(seg);
    }
    return parts.join('/');
  }

  /** Ensure "dir/base.md" is unique given exists(path) predicate. */
  function uniquePath(dir, base, ext, exists) {
    let candidate = joinPath(dir, base + ext);
    let n = 1;
    while (exists(candidate)) {
      n++;
      candidate = joinPath(dir, base + ' ' + n + ext);
    }
    return candidate;
  }

  /* ---------- Dates ---------- */
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function fmtDate(d, fmt) {
    fmt = fmt || 'YYYY-MM-DD';
    return fmt
      .replace(/YYYY/g, d.getFullYear())
      .replace(/MM/g, pad(d.getMonth() + 1))
      .replace(/DD/g, pad(d.getDate()))
      .replace(/HH/g, pad(d.getHours()))
      .replace(/mm/g, pad(d.getMinutes()))
      .replace(/ss/g, pad(d.getSeconds()));
  }
  const nowIso = () => new Date().toISOString();

  /* ---------- Downloads / binary ---------- */
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const downloadBytes = (filename, bytes, type) => downloadBlob(filename, new Blob([bytes], { type: type || 'application/octet-stream' }));
  const downloadText = (filename, text, type) => downloadBlob(filename, new Blob([text], { type: type || 'text/plain;charset=utf-8' }));

  function bytesToBase64(u8) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const strToBytes = s => textEncoder.encode(s);
  const bytesToStr = b => textDecoder.decode(b);

  /* ---------- Clipboard ---------- */
  function copyFallback(text) {
    const t = document.createElement('textarea');
    t.style.cssText = 'position:fixed;opacity:0';
    t.value = text;
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    t.remove();
    return true;
  }
  function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => copyFallback(text));
    }
    return Promise.resolve(copyFallback(text));
  }

  /* ---------- Notices ---------- */
  function notice(msg, type, ms) {
    if (typeof document === 'undefined') { console.log('[notice]', msg); return; }
    const root = document.getElementById('notice-container');
    if (!root) return;
    const n = el('div.notice' + (type ? '.' + type : ''), { text: msg });
    root.appendChild(n);
    setTimeout(() => {
      n.classList.add('fade-out');
      setTimeout(() => n.remove(), 300);
    }, ms || 2600);
  }

  /* ---------- Misc ---------- */
  function countWords(text) {
    const t = text.trim();
    return t ? t.split(/\s+/).length : 0;
  }
  function groupBy(arr, fn) {
    const map = new Map();
    for (const item of arr) {
      const k = fn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  }
  function sortAlpha(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

  Obs.util = {
    qs, qsa, el, on, debounce, clamp,
    escapeHtml, unescapeHtml, slugify, fuzzyScore,
    normalizePath, baseName, dirName, extName, stripExt, joinPath,
    sanitizePathComponent, safeRelPath, uniquePath,
    fmtDate, nowIso, pad,
    downloadBlob, downloadBytes, downloadText,
    bytesToBase64, base64ToBytes, strToBytes, bytesToStr,
    notice, countWords, groupBy, sortAlpha, copyText, copyFallback
  };
})(typeof window !== 'undefined' ? window : globalThis);
