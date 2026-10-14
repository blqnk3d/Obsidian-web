/* ============================================================
   sanitize.js — output sanitizer for rendered markdown (Obs.sanitize)
   Parses untrusted HTML into an inert DOM (no browsing context, so
   scripts/images/iframes never load), then keeps only an allow-list
   of tags + attributes and safe URL schemes. This is the single
   choke point that neutralises XSS coming from note content.

   API: Obs.sanitize.html(str) -> safe html string
        Obs.sanitize.setHtml(el, str) -> sanitize + assign
        Obs.sanitize.isAllowedTag(name) -> boolean
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};

  /* Tags that may appear in sanitized output. */
  const ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'button', 'cite', 'code', 'dd', 'del',
    'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'li',
    'mark', 'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span', 'strong',
    'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
    'time', 'tr', 'u', 'ul'
  ]);

  /* Tags that are always dropped, subtree included. */
  const DROP_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
    'form', 'textarea', 'select', 'option', 'optgroup', 'svg', 'math', 'template',
    'noscript', 'frame', 'frameset', 'applet', 'audio', 'video', 'source', 'track',
    'canvas', 'marquee', 'title', 'head', 'html', 'body', 'portal', 'slot'
  ]);

  const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'dir', 'lang', 'role']);
  const TAG_ATTRS = {
    a: ['href', 'target', 'rel', 'download'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    ol: ['start', 'type', 'reversed'],
    li: ['value'],
    time: ['datetime'],
    details: ['open'],
    td: ['colspan', 'rowspan', 'headers'],
    th: ['colspan', 'rowspan', 'scope', 'headers', 'abbr'],
    input: ['type', 'checked', 'disabled', 'value'],
    button: ['type', 'disabled', 'name', 'value']
  };
  /* data-* attributes the app relies on for preview interactions. */
  const DATA_ATTRS = new Set([
    'data-line', 'data-href', 'data-heading', 'data-path', 'data-open-path',
    'data-tag', 'data-fn', 'data-fn-back', 'data-fn-id', 'data-type'
  ]);

  function isAllowedTag(name) { return ALLOWED_TAGS.has(String(name).toLowerCase()); }

  function schemeOf(url) {
    const m = /^([a-z][a-z0-9+.\-]*):/i.exec(String(url));
    return m ? m[1].toLowerCase() : '';
  }

  /* Collapse whitespace/control chars and strip backslashes so obfuscated
     schemes (java<TAB>script:, java\script:) are detectable. The HTML parser
     has already decoded entities by the time we get here, which is what
     closes the "java&#115;cript:" bypass. */
  function normalizeUrl(raw) {
    return String(raw).replace(/[\u0000-\u0020\u007F]+/g, '').replace(/\\/g, '');
  }

  function safeHref(raw) {
    const u = normalizeUrl(raw);
    if (!u) return null;
    if (u[0] === '#') return u;
    const s = schemeOf(u);
    if (!s) return u;                                   // relative link
    if (s === 'http' || s === 'https' || s === 'mailto') return u;
    return null;                                        // javascript:, data:, vbscript:, file:…
  }

  function safeSrc(raw) {
    const u = normalizeUrl(raw);
    if (!u) return null;
    if (u.startsWith('//')) return null;                // protocol-relative = remote
    const s = schemeOf(u);
    if (!s) return null;                                // relative paths can point at local files
    if (s === 'blob') return u;                         // vault attachments
    if (s === 'data' && /^data:image\//i.test(u)) return u;
    return null;                                        // remote images intentionally blocked
  }

  function cleanAttributes(el, tag) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc' ||
          name === 'srcset' || name === 'formaction' || name === 'background' ||
          name === 'poster' || name === 'xlink:href' || name === 'xmlns') {
        el.removeAttribute(attr.name); continue;
      }
      const perTag = TAG_ATTRS[tag];
      const allowed =
        GLOBAL_ATTRS.has(name) ||
        (perTag && perTag.indexOf(name) >= 0) ||
        DATA_ATTRS.has(name) ||
        name.indexOf('aria-') === 0 ||
        name.indexOf('data-') === 0;
      if (!allowed) { el.removeAttribute(attr.name); continue; }

      if (name === 'href') {
        const safe = safeHref(value);
        if (safe == null) el.removeAttribute('href'); else el.setAttribute('href', safe);
      } else if (name === 'src') {
        const safe = safeSrc(value);
        if (safe == null) el.removeAttribute('src'); else el.setAttribute('src', safe);
      } else if (name === 'id') {
        // Namespace note ids so they cannot clobber app element ids
        // (e.g. id="status-left") via document.getElementById. Idempotent:
        // render() sanitises and the view sinks sanitise again, so the same
        // id can be seen twice — only prefix it once.
        el.setAttribute('id', /^md-/.test(value) ? value : 'md-' + value);
      } else if (name === 'target') {
        if (value !== '_blank') el.removeAttribute('target');
      }
    }
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href && href[0] !== '#') {
        el.setAttribute('rel', 'noopener noreferrer');
        if (!el.hasAttribute('target') && schemeOf(href)) el.setAttribute('target', '_blank');
      }
    }
  }

  function isCheckboxInput(el) {
    return (el.getAttribute('type') || '').toLowerCase() === 'checkbox';
  }

  function clean(node) {
    const kids = Array.from(node.childNodes);
    for (const kid of kids) {
      if (kid.nodeType === 8) { kid.remove(); continue; }   // comments
      if (kid.nodeType !== 1) continue;                     // keep text nodes
      const tag = kid.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) { kid.remove(); continue; }
      if (!ALLOWED_TAGS.has(tag)) {
        /* Unknown but harmless tag: unwrap, keeping sanitised children. */
        const parent = kid.parentNode;
        if (!parent) continue;
        kid.replaceWith.apply(kid, Array.from(kid.childNodes));
        clean(parent);
        continue;
      }
      if (tag === 'input' && !isCheckboxInput(kid)) { kid.remove(); continue; }
      cleanAttributes(kid, tag);
      clean(kid);
    }
  }

  let parserDoc = null;
  function getBody() {
    if (!parserDoc) parserDoc = document.implementation.createHTMLDocument('sanitize');
    return parserDoc.body;
  }

  function html(dirty) {
    if (dirty == null) return '';
    const src = String(dirty);
    if (!src) return '';
    if (typeof document === 'undefined' || !document.implementation) {
      return src.replace(/</g, '&lt;');                    // no DOM: show as text
    }
    let host;
    try {
      host = getBody();
      host.innerHTML = src;                                // inert document: nothing loads
    } catch (e) {
      return '';
    }
    clean(host);
    return host.innerHTML;
  }

  function setHtml(el, dirty) {
    if (!el) return;
    el.innerHTML = html(dirty);
  }

  Obs.sanitize = {
    html, setHtml, isAllowedTag, schemeOf, normalizeUrl, safeHref, safeSrc,
    ALLOWED_TAGS, DROP_TAGS
  };
})(typeof window !== 'undefined' ? window : globalThis);
