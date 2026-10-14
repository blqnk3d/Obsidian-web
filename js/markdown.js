/* ============================================================
   markdown.js — Obsidian-flavored Markdown parser (pure, no DOM)
   Supports: frontmatter, headings, bold/italic/strike/==highlight==,
   wikilinks [[..]] (+alias/heading), embeds ![[..]], md links/images,
   autolinks, tags, %%comments%%, callouts, quotes, nested lists,
   task lists, tables, fenced code, hr, inline HTML (allow-listed + sanitised).
   API: Obs.md.render(src, opts) / Obs.md.extractMeta(src)
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { escapeHtml, slugify, countWords, stripExt, baseName } = Obs.util;

  const escapeAttr = escapeHtml;
  const isBlank = line => /^\s*$/.test(line);
  const toLines = s => String(s).split('\n');
  const indentOf = line => (line.match(/^\s*/) || [''])[0].length;

  function dedentStr(line, n) {
    let i = 0;
    while (i < n && i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
    return line.slice(i);
  }

  function uniqueSlug(slug, used) {
    if (!used) return slug;
    let s = slug, n = 2;
    while (used.has(s)) s = slug + '-' + (n++);
    used.add(s);
    return s;
  }

  /* ---------------- Frontmatter ---------------- */
  function unquote(s) {
    if ((s.startsWith('"') && s.endsWith('"') && s.length > 1) ||
        (s.startsWith("'") && s.endsWith("'") && s.length > 1)) return s.slice(1, -1);
    return s;
  }

  function parseFrontmatter(src) {
    const lines = toLines(src);
    if (!lines.length || lines[0].trim() !== '---') return { fm: null, body: src, bodyStartLine: 0 };
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '---' || t === '...') { end = i; break; }
    }
    if (end < 0) return { fm: null, body: src, bodyStartLine: 0 };
    const fm = {};
    let curKey = null;
    for (const raw of lines.slice(1, end)) {
      const itemM = raw.match(/^\s+-\s+(.*)$/);
      if (itemM && curKey) {
        const cur = fm[curKey];
        if (!Array.isArray(cur)) fm[curKey] = cur === '' || cur == null ? [] : [cur];
        fm[curKey].push(unquote(itemM[1].trim()));
        continue;
      }
      const kvM = raw.match(/^([A-Za-z0-9_][A-Za-z0-9_\- ]*):\s*(.*)$/);
      if (kvM) {
        curKey = kvM[1].trim();
        const v = kvM[2].trim();
        if (v === '') { fm[curKey] = ''; continue; }
        if (v.startsWith('[') && v.endsWith(']')) {
          fm[curKey] = v.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(s => s !== '');
        } else {
          fm[curKey] = unquote(v);
        }
      }
    }
    return { fm, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 1 };
  }

  function renderProperties(fm) {
    const keys = Object.keys(fm || {});
    if (!keys.length) return '';
    const rows = keys.map(k => {
      const v = fm[k];
      const vs = Array.isArray(v) ? v.join(', ') : String(v);
      return `<div class="fm-prop"><span class="fm-key">${escapeHtml(k)}</span><span class="fm-val">${escapeHtml(vs)}</span></div>`;
    }).join('');
    return `<div class="frontmatter folded"><div class="frontmatter-header"><span class="fm-chev">▸</span> Properties <span class="fm-count">${keys.length}</span></div><div class="frontmatter-props">${rows}</div></div>`;
  }

  /* ---------------- Inline HTML handling ----------------
     Raw HTML is passed through only for tags the sanitizer allows; the
     entire render() output is then sanitised as a whole, which is what
     actually strips event handlers and dangerous URLs. */
  function rawTagName(s) {
    const m = /^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(String(s).trim());
    return m ? m[1].toLowerCase() : '';
  }
  function isAllowedRawTag(s) {
    const n = rawTagName(s);
    return !!n && !!Obs.sanitize && Obs.sanitize.isAllowedTag(n);
  }
  function isRawHtmlLine(line) {
    const t = String(line).trim();
    return /^<\/?[a-zA-Z][^>]*>$/.test(t) && isAllowedRawTag(t);
  }
  const schemeOfUrl = u => {
    const m = /^([a-z][a-z0-9+.\-]*):/i.exec(String(u));
    return m ? m[1].toLowerCase() : '';
  };

  /* ---------------- Callouts ---------------- */
  const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  /* ---------------- Lists ---------------- */
  const BULLET_RE = /^(\s*)([-*+])(\s+)(.*)$/;
  const ORDERED_RE = /^(\s*)(\d{1,9})([.)])(\s+)(.*)$/;
  function matchMarker(line) {
    let m = BULLET_RE.exec(line);
    if (m) return { indent: m[1].length, ordered: false, start: 1, contentIndent: m[1].length + m[2].length + m[3].length, rest: m[4] };
    m = ORDERED_RE.exec(line);
    if (m) return { indent: m[1].length, ordered: true, start: parseInt(m[2], 10), contentIndent: m[1].length + m[2].length + m[3].length + m[4].length, rest: m[5] };
    return null;
  }

  function parseList(lines, i, opts, depth, lineOffset) {
    const first = matchMarker(lines[i]);
    const baseIndent = first.indent;
    const ordered = first.ordered;
    const startNum = first.start;

    const raw = []; // {text, idx}
    let j = i;
    const pendingBlanks = [];
    while (j < lines.length) {
      const line = lines[j];
      if (isBlank(line)) { pendingBlanks.push(j); j++; continue; }
      const mk = matchMarker(line);
      const ind = indentOf(line);
      const belongs = mk ? mk.indent >= baseIndent : ind > baseIndent;
      if (!belongs) break;
      for (const b of pendingBlanks) raw.push({ text: '', idx: b });
      pendingBlanks.length = 0;
      raw.push({ text: line, idx: j });
      j++;
    }
    const end = j - pendingBlanks.length;

    const items = [];
    for (const r of raw) {
      const mk = r.text === '' ? null : matchMarker(r.text);
      if (mk && mk.indent === baseIndent) {
        items.push({ rest: mk.rest, contentIndent: mk.contentIndent, startIdx: r.idx, lines: [mk.rest] });
      } else if (items.length) {
        const it = items[items.length - 1];
        it.lines.push(r.text === '' ? '' : dedentStr(r.text, it.contentIndent));
      }
    }

    let hasTask = false;
    const lis = items.map(it => {
      let itLines = it.lines.slice();
      while (itLines.length && itLines[itLines.length - 1] === '') itLines.pop();
      const itemHasBlank = itLines.indexOf('') >= 0;
      const loose = itemHasBlank;

      let taskPrefix = '';
      const taskM = (itLines[0] || '').match(/^\[([ xX])\]\s+([\s\S]*)$/);
      if (taskM) {
        hasTask = true;
        const checked = taskM[1].toLowerCase() === 'x';
        const lineAttr = opts.interactive === false ? '' : ` data-line="${lineOffset + it.startIdx}"`;
        taskPrefix = `<input type="checkbox"${checked ? ' checked' : ''}${opts.interactive === false ? ' disabled' : ''}${lineAttr}>`;
        itLines[0] = taskM[2];
        if (itLines[0] === '' && itLines.length === 1) itLines = [' '];
      }

      let inner = blocks(itLines, opts, depth + 1, lineOffset + it.startIdx).join('');
      if (!loose) inner = unwrapFirstP(inner);
      const cls = taskM ? ` class="task-item${taskM[1].toLowerCase() === 'x' ? ' done' : ''}"` : '';
      if (taskM) {
        return `<li${cls}>${taskPrefix}<div class="task-label">${inner}</div></li>`;
      }
      return `<li${cls}>${inner}</li>`;
    }).join('');

    const tag = ordered ? 'ol' : 'ul';
    const attrs = (ordered && startNum !== 1 ? ` start="${startNum}"` : '') + (hasTask ? ' class="contains-task-list"' : '');
    return { html: `<${tag}${attrs}>${lis}</${tag}>`, end };
  }

  function unwrapFirstP(html) {
    const m = html.match(/^<p[^>]*>([\s\S]*?)<\/p>([\s\S]*)$/);
    if (!m) return html;
    return m[1] + m[2];
  }

  /* ---------------- Tables ---------------- */
  function isTableDivider(line) {
    return /\|/.test(line) && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
  }
  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
      if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }
  function parseTable(lines, i, opts, depth, lineOffset) {
    const header = splitRow(lines[i]);
    const aligns = splitRow(lines[i + 1]).map(c => {
      const l = c.startsWith(':'), r = c.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
    });
    let j = i + 2;
    const rows = [];
    while (j < lines.length && !isBlank(lines[j]) && lines[j].includes('|')) { rows.push(splitRow(lines[j])); j++; }
    const th = header.map((c, n) => `<th${aligns[n] ? ` class="md-align-${aligns[n]}"` : ''}>${inline(c, opts)}</th>`).join('');
    const trs = rows.map(r => '<tr>' + header.map((_, n) => `<td${aligns[n] ? ` class="md-align-${aligns[n]}"` : ''}>${inline(r[n] || '', opts)}</td>`).join('') + '</tr>').join('');
    return { html: `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`, end: j };
  }

  /* ---------------- Links / embeds ---------------- */
  function splitWikilink(inner) {
    let alias = null;
    const p = inner.indexOf('|');
    if (p >= 0) { alias = inner.slice(p + 1).trim(); inner = inner.slice(0, p); }
    inner = inner.trim();
    let target = inner, heading = '';
    const h = inner.indexOf('#');
    if (h >= 0) { target = inner.slice(0, h).trim(); heading = inner.slice(h + 1).trim(); }
    return { target, heading, alias, display: inner };
  }

  function renderWikilink(innerRaw, opts) {
    const { target, heading, alias, display } = splitWikilink(innerRaw);
    const label = alias != null && alias !== '' ? alias : display;
    const labelHtml = inline(label, opts);
    const anchorAttr = h => h ? ` data-heading="${escapeAttr(h[0] === '^' ? 'blk-' + h.slice(1) : slugify(h))}"` : '';
    if (!target) { // same-note heading link
      return `<a class="internal-link" data-href="${escapeAttr(opts.fromPath || '')}"${anchorAttr(heading)} href="#">${labelHtml}</a>`;
    }
    const r = opts.resolve ? opts.resolve(target) : null;
    if (r && (r.kind === 'note' || r.kind === 'image')) {
      return `<a class="internal-link" data-href="${escapeAttr(r.path)}"${anchorAttr(heading)} href="#">${labelHtml}</a>`;
    }
    return `<a class="internal-link is-unresolved" data-href="${escapeAttr(target)}" href="#" title="Create note “${escapeAttr(target)}”">${labelHtml}</a>`;
  }

  function renderEmbed(innerRaw, opts) {
    const { target, heading, alias } = splitWikilink(innerRaw);
    const r = opts.resolve ? opts.resolve(target) : null;
    if (r && r.kind === 'image') {
      let w = '', h = '';
      const wm = (alias || '').match(/^(\d+)(?:x(\d+))?$/);
      if (wm) { w = wm[1]; h = wm[2] || ''; }
      return `<div class="image-embed"><img src="${escapeAttr(r.url)}" alt="${escapeAttr(target)}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}></div>`;
    }
    if (r && r.kind === 'note') {
      if ((opts.depth || 0) >= 5) return `<div class="embed-missing">Embed depth limit reached: ${escapeHtml(target)}</div>`;
      let content = r.content || '';
      if (heading) {
        const sec = heading[0] === '^' ? extractBlockId(content, heading.slice(1)) : extractSection(content, heading);
        if (sec != null) content = sec;
      }
      const pfm = parseFrontmatter(content);
      const subOpts = Object.assign({}, opts, {
        depth: (opts.depth || 0) + 1,
        fromPath: r.path,
        renderProperties: false,
        interactive: false,
        _ids: new Set(),
        _fn: fnState()
      });
      const name = stripExt(baseName(r.path));
      const inner = blocks(toLines(pfm.body), subOpts, subOpts.depth, pfm.bodyStartLine).join('');
      return `<div class="markdown-embed" data-path="${escapeAttr(r.path)}">` +
        `<div class="markdown-embed-title" data-open-path="${escapeAttr(r.path)}">${escapeHtml(name)}</div>` +
        `<div class="markdown-embed-content"><div class="markdown-preview">${inner}</div></div></div>`;
    }
    if (/^(https?:)?\/\//i.test(target)) {
      return `<div class="embed-missing"><a class="external-link" href="${escapeAttr(target)}" target="_blank" rel="noopener noreferrer">${escapeHtml(target)}</a></div>`;
    }
    return `<div class="embed-missing"><a class="internal-link is-unresolved" data-href="${escapeAttr(target)}" href="#">${escapeHtml(target)}</a> — embed not found</div>`;
  }

  function extractSection(content, heading) {
    const want = slugify(heading).toLowerCase();
    const lines = toLines(content);
    let start = -1, level = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (m) {
        if (start < 0) {
          if (slugify(stripInlineSyntax(m[2])).toLowerCase() === want) { start = i; level = m[1].length; }
        } else {
          if (m[1].length <= level) break;
        }
      }
    }
    if (start < 0) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+/);
      if (m && m[1].length <= level) { end = i; break; }
    }
    return lines.slice(start + 1, end).join('\n');
  }

  function stripInlineSyntax(t) {
    return String(t)
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~=]/g, '')
      .trim();
  }

  /* Heading text with code spans and %%comments%% blanked out — shared by the
     renderer and extractMeta so rendered heading ids and outline ids always
     agree (otherwise outline/heading-link navigation misses its target). */
  function headingPlain(s) {
    return String(s)
      .replace(/%%[\s\S]*?%%/g, ' ')
      .replace(/(`+)[\s\S]*?\1/g, ' ');
  }

  /* ---------------- Inline parser ---------------- */
  function inline(text, opts) {
    const stash = [];
    const put = html => { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000'; };

    text = String(text);
    // comments
    text = text.replace(/%%[\s\S]*?%%/g, '');
    // code spans
    text = text.replace(/(`+)([\s\S]*?)\1/g, (m, t, code) => put('<code>' + escapeHtml(code.replace(/^ (.*) $/, '$1')) + '</code>'));
    // inline HTML — only tags the sanitizer allows are emitted; the whole
    // document is re-sanitised at the end of render() anyway.
    text = text.replace(/<\/?[a-zA-Z][^>\u0000]*>/g, m => isAllowedRawTag(m) ? put(m) : m);
    // embeds
    text = text.replace(/!\[\[([^\u0000\[\]]+?)\]\]/g, (m, inner) => put(renderEmbed(inner, opts)));
    // wikilinks
    text = text.replace(/\[\[([^\u0000\[\]]+?)\]\]/g, (m, inner) => put(renderWikilink(inner, opts)));
    // markdown images — remote images render as links and are never fetched;
    // local paths resolve to stored attachments (blob URLs)
    text = text.replace(/!\[([^\]\u0000]*)\]\(\s*([^\s)\u0000]*)(?:\s+["']([^"'\u0000]*)["'])?\s*\)/g,
      (m, alt, url, title) => {
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
        if (/^(https?:)?\/\//i.test(url)) {
          return put(`<a class="external-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${escapeHtml(alt || url)}</a>`);
        }
        const scheme = schemeOfUrl(url);
        if (scheme === 'data' && /^data:image\//i.test(url)) {
          return put(`<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"${titleAttr}>`);
        }
        if (scheme) return put(escapeHtml(m));
        let target = url;
        try { target = decodeURIComponent(url); } catch (e) { /* keep */ }
        const r = opts.resolve ? opts.resolve(target) : null;
        if (r && r.kind === 'image' && r.url) {
          return put(`<img src="${escapeAttr(r.url)}" alt="${escapeAttr(alt)}"${titleAttr}>`);
        }
        return put(escapeHtml(m));
      });
    // markdown links
    text = text.replace(/\[([^\[\]\u0000]*)\]\(\s*([^\s)\u0000]*)(?:\s+["']([^"'\u0000]*)["'])?\s*\)/g, (m, label, url, title) => {
      const labelHtml = inline(label, opts);
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      if (/^(https?:|mailto:)/i.test(url)) {
        return put(`<a class="external-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${labelHtml}</a>`);
      }
      if (/^#/.test(url)) {
        return put(`<a class="internal-link" data-href="${escapeAttr(opts.fromPath || '')}" data-heading="${escapeAttr(slugify(url.slice(1)))}" href="#">${labelHtml}</a>`);
      }
      let target = url;
      try { target = decodeURIComponent(url); } catch (e) { /* keep */ }
      const r = opts.resolve ? opts.resolve(stripMdExt(target)) : null;
      if (r && (r.kind === 'note' || r.kind === 'image')) {
        return put(`<a class="internal-link" data-href="${escapeAttr(r.path)}"${titleAttr} href="#">${labelHtml}</a>`);
      }
      return put(`<a class="internal-link is-unresolved" data-href="${escapeAttr(target)}" href="#">${labelHtml}</a>`);
    });

    // footnote references [^label] (defs are handled block-level)
    if (opts._fn) {
      text = text.replace(/\[\^([^\]\s\u0000]+)\](?!:)/g, (m, label) => {
        const st = opts._fn;
        let num = st.order.indexOf(label);
        if (num < 0) { st.order.push(label); num = st.order.length - 1; }
        return put(`<sup class="fn-ref"><a data-fn="${escapeAttr(label)}" href="#" title="Footnote ${num + 1}">[${num + 1}]</a></sup>`);
      });
    }

    // escape everything else
    text = escapeHtml(text);

    // emphasis
    text = text
      .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(\S[\s\S]*?\S|\S)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(\S[\s\S]*?\S|\S)\*/g, '<em>$1</em>')
      .replace(/(^|[^\w_\\])___(\S[\s\S]*?\S|\S)___(?![\w_])/g, '$1<strong><em>$2</em></strong>')
      .replace(/(^|[^\w_\\])__(\S[\s\S]*?\S|\S)__(?![\w_])/g, '$1<strong>$2</strong>')
      .replace(/(^|[^\w_\\])_(\S[\s\S]*?\S|\S)_(?![\w_])/g, '$1<em>$2</em>')
      .replace(/~~([\s\S]+?)~~/g, '<del>$1</del>')
      .replace(/==([\s\S]+?)==/g, '<mark>$1</mark>');

    // tags
    text = text.replace(/(^|[\s(\[{>|])#([^\s#!.,;:?'"`)\]}<>|]+)/g, (m, pre, tag) => {
      tag = tag.replace(/-+$/, '');
      if (!tag || /^\d+$/.test(tag)) return m;
      return pre + put(`<a class="tag-link" data-tag="${escapeAttr(tag.toLowerCase())}" href="#" title="Search tag">#${escapeHtml(tag)}</a>`);
    });

    // autolinks <https://…>
    text = text.replace(/&lt;((?:https?|mailto):[^\s&]+(?:&amp;[^\s&]+)*)&gt;/g,
      '<a class="external-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // trailing block id (… ^block-id) becomes an anchor target
    text = text.replace(/\s+\^([A-Za-z][\w-]*)\s*$/, '<a class="block-anchor" id="blk-$1"></a>');

    // soft line breaks
    text = text.replace(/\n/g, '<br>\n');

    // restore
    text = text.replace(/\u0000(\d+)\u0000/g, (m, n) => stash[+n] != null ? stash[+n] : m);
    return text;
  }

  function stripMdExt(p) { return /\.md$/i.test(p) ? p.slice(0, -3) : p; }

  /* ---------------- Lightweight syntax highlighting ---------------- */
  const HL_RULES = {
    js: [
      ['com', /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/],
      ['str', /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/],
      ['kw', /\b(?:const|let|var|function|return|if|else|for|while|do|class|new|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|switch|case|break|continue|this|super|extends|delete|void|yield|static|get|set|null|undefined|true|false)\b/],
      ['num', /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
      ['fn', /[A-Za-z_$][\w$]*(?=\s*\()/],
      ['type', /\b[A-Z][\w$]*\b/]
    ],
    py: [
      ['com', /#[^\n]*/],
      ['str', /'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/],
      ['kw', /\b(?:def|class|return|if|elif|else|for|while|break|continue|pass|import|from|as|with|try|except|finally|raise|lambda|yield|global|nonlocal|assert|del|in|is|not|and|or|None|True|False|async|await|match|case)\b/],
      ['num', /\b0[xXbBoO][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\b/],
      ['fn', /[A-Za-z_]\w*(?=\s*\()/],
      ['type', /\b[A-Z]\w*\b/]
    ],
    json: [
      ['attr', /"(?:\\.|[^"\\])*"(?=\s*:)/],
      ['str', /"(?:\\.|[^"\\])*"/],
      ['kw', /\b(?:true|false|null)\b/],
      ['num', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/]
    ],
    css: [
      ['com', /\/\*[\s\S]*?(?:\*\/|$)/],
      ['str', /'(?:[^'\\\n])*'|"(?:[^"\\\n])*"/],
      ['kw', /@[\w-]+/],
      ['fn', /[.#:][\w-]+/],
      ['attr', /[a-z-]+(?=\s*:)/],
      ['num', /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/]
    ],
    html: [
      ['com', /<!--[\s\S]*?(?:-->|$)/],
      ['str', /"[^"]*"|'[^']*'/],
      ['tag', /<\/?[a-zA-Z][\w:-]*|\/?>/],
      ['attr', /[a-zA-Z-]+(?==)/]
    ],
    bash: [
      ['com', /#[^\n]*/],
      ['str', /'[^'\\\n]*'|"(?:\\.|[^"\\])*"/],
      ['kw', /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|return|in|echo|cd|export|source|local|set|exit|sudo|apt|apt-get|npm|npx|node|python3?|git|curl|wget|make|rm|cp|mv|mkdir|cat|grep|sed|awk)\b/],
      ['fn', /\$\{?[\w@#?]+\}?/],
      ['num', /\b\d+\b/]
    ],
    sql: [
      ['com', /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/],
      ['str', /'[^']*'/],
      ['kw', /\b(?:select|from|where|insert|into|values|update|set|delete|create|table|drop|alter|join|left|right|inner|outer|on|group|by|order|having|limit|offset|and|or|not|null|primary|key|foreign|references|index|as|distinct|count|sum|avg|min|max|union|all|exists|like|between|case|when|then|else|end)\b/i],
      ['num', /\b\d+(?:\.\d+)?\b/]
    ]
  };
  const HL_ALIASES = {
    javascript: 'js', ts: 'js', typescript: 'js', jsx: 'js', tsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
    python: 'py', py3: 'py', python3: 'py',
    sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellscript: 'bash',
    html5: 'html', xml: 'html', vue: 'html', svg: 'html', htm: 'html'
  };

  function highlightCode(code, lang) {
    const key = Object.prototype.hasOwnProperty.call(HL_ALIASES, lang) ? HL_ALIASES[lang] : lang;
    const rules = key && HL_RULES[key];
    if (!rules) return escapeHtml(code);
    let src = '';
    const groupMap = [];
    rules.forEach(([cls, re], i) => {
      src += (i ? '|' : '') + '(' + re.source + ')';
      groupMap.push(cls);
    });
    const re = new RegExp(src, 'g');
    let out = '', last = 0, m;
    while ((m = re.exec(code)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      out += escapeHtml(code.slice(last, m.index));
      let cls = 'str';
      for (let g = 1; g < m.length; g++) {
        if (m[g] !== undefined) { cls = groupMap[g - 1]; break; }
      }
      out += `<span class="tok-${cls}">${escapeHtml(m[0])}</span>`;
      last = m.index + m[0].length;
      re.lastIndex = last;
    }
    out += escapeHtml(code.slice(last));
    return out;
  }

  /* ---------------- Footnotes ---------------- */
  function fnState() { return { defs: new Map(), order: [] }; }

  function extractFnDefs(lines, st) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s{0,3}\[\^([^\]\s]+)\]:\s*(.*)$/);
      if (!m) continue;
      let text = m[2];
      lines[i] = '';
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
        text += ' ' + lines[i + 1].trim();
        lines[i + 1] = '';
        i++;
      }
      st.defs.set(m[1], text);
    }
  }

  function extractBlockId(content, id) {
    const lines = toLines(content);
    const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch);
    const re = new RegExp('\\^' + esc + '\\s*$');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        let s = i;
        while (s > 0 && !isBlank(lines[s - 1])) s--;
        let e = i;
        while (e < lines.length - 1 && !isBlank(lines[e + 1])) e++;
        return lines.slice(s, e + 1).join('\n');
      }
    }
    return null;
  }

  /* ---------------- Block parser ---------------- */
  function isBlockStart(line, next) {
    if (/^#{1,6}\s/.test(line)) return true;
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) return true;
    if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) return true;
    if (/^\s{0,3}>/.test(line)) return true;
    if (matchMarker(line)) return true;
    if (isRawHtmlLine(line)) return true;
    if (/^\s{0,3}%%/.test(line)) return true;
    if (line.includes('|') && next != null && isTableDivider(next)) return true;
    return false;
  }

  function blocks(lines, opts, depth, lineOffset) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) { i++; continue; }

      // %% comment block %%
      if (/^\s{0,3}%%/.test(line)) {
        if (!/^\s{0,3}%%.+%%\s*$/.test(line)) {
          i++;
          while (i < lines.length && !/%%/.test(lines[i])) i++;
        }
        i++;
        continue;
      }

      // fenced code
      const fence = line.match(/^(\s{0,3})(`{3,}|~{3,})[ \t]*([^\s`~]*)[ \t]*$/);
      if (fence) {
        const markerChar = fence[2][0], len = fence[2].length, lang = fence[3] || '';
        const indent = fence[1].length;
        const codeLines = [];
        i++;
        while (i < lines.length) {
          const cm = lines[i].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
          if (cm && cm[1][0] === markerChar && cm[1].length >= len) { i++; break; }
          codeLines.push(dedentStr(lines[i], indent));
          i++;
        }
        const code = highlightCode(codeLines.join('\n'), lang.toLowerCase());
        out.push(`<div class="code-block"><div class="code-block-bar"><span>${escapeHtml(lang)}</span><button class="code-copy-btn" type="button">Copy</button></div><pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${code}</code></pre></div>`);
        continue;
      }

      // heading
      const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        const level = h[1].length;
        const text = h[2];
        const id = uniqueSlug(slugify(stripInlineSyntax(headingPlain(text))), opts._ids);
        out.push(`<h${level} id="${id}" data-line="${lineOffset + i}">${inline(text, opts)}</h${level}>`);
        i++;
        continue;
      }

      // hr
      if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // blockquote / callout
      if (/^\s{0,3}>/.test(line)) {
        const qstart = i;
        const qlines = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
          qlines.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        const cm = qlines.length ? qlines[0].match(/^\[!(\w+)\]\s*([+-])?\s*(.*)$/) : null;
        if (cm) {
          const type = cm[1].toLowerCase();
          const foldable = !!cm[2];
          const folded = cm[2] === '-';
          const title = cm[3].trim() || capitalize(type);
          const content = blocks(qlines.slice(1), opts, depth + 1, lineOffset + qstart + 1).join('');
          out.push(
            `<div class="callout${foldable ? ' foldable' : ''}${folded ? ' folded' : ''}" data-type="${escapeAttr(type)}">` +
            `<div class="callout-title"><span>${inline(title, opts)}</span>` +
            (foldable ? '<span class="callout-fold">▾</span>' : '') +
            `</div><div class="callout-content">${content}</div></div>`
          );
        } else {
          out.push('<blockquote>' + blocks(qlines, opts, depth + 1, lineOffset + qstart).join('') + '</blockquote>');
        }
        continue;
      }

      // table
      if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
        const t = parseTable(lines, i, opts, depth, lineOffset);
        out.push(t.html);
        i = t.end;
        continue;
      }

      // list
      if (matchMarker(line)) {
        const l = parseList(lines, i, opts, depth, lineOffset);
        out.push(l.html);
        i = l.end;
        continue;
      }

      // multi-line <details>
      if (/^\s{0,3}<details/i.test(line)) {
        const chunk = [];
        while (i < lines.length) {
          chunk.push(lines[i]);
          const closed = /<\/details>/i.test(lines[i]);
          i++;
          if (closed) break;
        }
        out.push(chunk.join('\n'));
        continue;
      }

      // single-line raw HTML (only allow-listed tags; anything else falls
      // through to paragraph/inline so <https://…> autolinks still work)
      if (isRawHtmlLine(line)) {
        out.push(line.trim());
        i++;
        continue;
      }

      // paragraph
      const pstart = i;
      const paraLines = [];
      while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i], lines[i + 1])) {
        paraLines.push(lines[i]);
        i++;
      }
      out.push(`<p data-line="${lineOffset + pstart}">${inline(paraLines.join('\n'), opts)}</p>`);
    }
    return out;
  }

  /* ---------------- Public render ---------------- */
  function render(src, opts) {
    opts = Object.assign({ depth: 0, lineOffset: 0, renderProperties: true, resolve: null, fromPath: '' }, opts || {});
    if (!opts._ids) opts._ids = new Set();
    if (!opts._fn) opts._fn = fnState();
    src = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    const pfm = parseFrontmatter(src);
    let html = '';
    if (pfm.fm && opts.renderProperties && opts.depth === 0) html += renderProperties(pfm.fm);
    const lines = toLines(pfm.body);
    extractFnDefs(lines, opts._fn);
    html += blocks(lines, opts, opts.depth, pfm.bodyStartLine + (opts.lineOffset || 0)).join('\n');
    // footnote definitions section
    if (opts._fn && opts._fn.defs.size && opts.depth === 0) {
      const st = opts._fn;
      const labels = st.order.concat([...st.defs.keys()].filter(l => !st.order.includes(l)));
      const lis = labels.map((l, i) =>
        `<li id="fn-${escapeAttr(l)}" class="footnote-item" data-fn-id="${escapeAttr(l)}">` +
        `${inline(st.defs.get(l), opts)} ` +
        `<a class="fn-back" data-fn-back="${escapeAttr(l)}" href="#" title="Back to reference">↩</a></li>`
      ).join('');
      html += `<section class="footnotes"><hr><ol>${lis}</ol></section>`;
    }
    // Final choke point: the assembled document is sanitised as a whole, so
    // raw HTML (details blocks, inline tags, embeds) cannot smuggle script,
    // event handlers or dangerous URLs through to the preview/print sinks.
    return Obs.sanitize ? Obs.sanitize.html(html) : html;
  }

  /* ---------------- Metadata extraction (for indexing) ---------------- */
  function extractMeta(src) {
    src = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    const pfm = parseFrontmatter(src);
    const fm = pfm.fm;
    const tags = new Set();
    const aliases = [];
    if (fm) {
      const t = fm.tags != null ? fm.tags : fm.tag;
      if (t) {
        const arr = Array.isArray(t) ? t : String(t).split(/[,\s]+/);
        for (let x of arr) {
          x = String(x).trim().replace(/^#/, '');
          if (x && !/^\d+$/.test(x)) tags.add(x.toLowerCase());
        }
      }
      const a = fm.aliases != null ? fm.aliases : fm.alias;
      if (a) for (let x of (Array.isArray(a) ? a : [a])) { x = String(x).trim(); if (x) aliases.push(x); }
    }

    const links = [];
    const headings = [];
    const usedHeadingIds = new Set();
    const lines = toLines(pfm.body);
    let inFence = false, fenceChar = '', inComment = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (inComment) { if (trimmed.includes('%%')) inComment = false; continue; }
      const fenceM = trimmed.match(/^(`{3,}|~{3,})/);
      if (fenceM) {
        if (!inFence) { inFence = true; fenceChar = fenceM[1][0]; }
        else if (fenceM[1][0] === fenceChar) inFence = false;
        continue;
      }
      if (inFence) continue;
      if (trimmed.startsWith('%%')) {
        if (!/^\s{0,3}%%.+%%\s*$/.test(lines[i])) inComment = true;
        continue;
      }
      let clean = lines[i].replace(/%%[\s\S]*?%%/g, ' ').replace(/(`+)[\s\S]*?\1/g, m => ' '.repeat(m.length));

      const hM = clean.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (hM) {
        const text = stripInlineSyntax(headingPlain(hM[2]));
        headings.push({ level: hM[1].length, text, line: i + pfm.bodyStartLine, id: uniqueSlug(slugify(text), usedHeadingIds) });
      }

      let m;
      const wikiRe = /(!?)\[\[([^\[\]]+?)\]\]/g;
      while ((m = wikiRe.exec(clean))) {
        const { target, heading, alias } = splitWikilink(m[2]);
        if (target || heading) links.push({ target, heading, alias, embed: m[1] === '!' });
      }
      const mdRe = /(!?)\[([^\[\]]*)\]\(\s*([^\s)]*)[^)]*\)/g;
      while ((m = mdRe.exec(clean))) {
        let url = m[3];
        if (/^(https?:|mailto:|#)/i.test(url)) continue;
        try { url = decodeURIComponent(url); } catch (e) { /* keep */ }
        links.push({ target: stripMdExt(url), heading: '', alias: m[2] || null, embed: m[1] === '!', mdStyle: true });
      }
      const tagScan = hM ? clean.replace(/^#{1,6}\s+/, '') : clean;
      const tagRe = /(^|[\s(\[{>|])#([^\s#!.,;:?'"`)\]}<>|]+)/g;
      while ((m = tagRe.exec(tagScan))) {
        let tag = m[2].replace(/-+$/, '');
        if (!tag || /^\d+$/.test(tag)) continue;
        tags.add(tag.toLowerCase());
      }
    }

    return {
      frontmatter: fm,
      tags: Array.from(tags),
      aliases,
      links,
      headings,
      words: countWords(pfm.body)
    };
  }

  Obs.md = { render, extractMeta, parseFrontmatter, extractSection, extractBlockId, highlightCode, inline: (t, o) => inline(t, o || {}) };
})(typeof window !== 'undefined' ? window : globalThis);
