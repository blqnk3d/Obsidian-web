/* ============================================================
   graph.js — force-directed graph view on canvas (Obs.graph)
   new Obs.graph.GraphView(container, {rootPath, depth, mini})
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { el, clamp, stripExt, baseName } = Obs.util;

  const MAX_NODES = 1500;

  class GraphView {
    constructor(container, opts) {
      this.container = container;
      this.opts = Object.assign({ rootPath: null, depth: 1, mini: false }, opts || {});
      this.scale = 1;
      this.tx = 0; this.ty = 0;
      this.alpha = 1;
      this.running = true;
      this._looping = false;
      this.hoverNode = null;
      this.dragNode = null;
      this.panning = false;
      this.filter = '';
      this.showOrphans = true;
      this.showTags = false;
      this.repulsion = 1;
      this.linkDist = 1;
      this.colors = {};
      this.destroyed = false;
      // Collections are filled by buildGraph(), which runs after buildDom().
      // buildDom() fires resize() -> wake() -> startLoop(), so they must exist
      // up front or the first loop iteration dereferences undefined.
      this.nodes = [];
      this.edges = [];
      this.neighbors = new Map();

      this.buildDom();
      this.readColors();
      this.buildGraph();
      this.bindEvents();
      this.startLoop();
    }

    /* ---------- DOM ---------- */
    buildDom() {
      const o = this.opts;
      this.body = el('div.graph-body');
      this.canvas = el('canvas');
      this.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      if (!o.mini) {
        this.stats = el('div.graph-stats');
        this.body.appendChild(this.stats);
        this.body.appendChild(el('div.graph-open-hint', { text: 'scroll = zoom · drag = pan · click node = open' }));

        this.controls = el('div.graph-controls');
        const header = el('div.graph-controls-header', { html: Obs.ui.iconHtml('sliders', 12) + '<span>Graph settings</span>' });
        const gcBody = el('div.gc-body');
        this.filterInput = el('input.input', { type: 'text', placeholder: 'Search filters…' });
        this.filterInput.addEventListener('input', () => { this.filter = this.filterInput.value.trim().toLowerCase(); this.wake(); });
        const mkToggle = (label, initial, fn) => {
          const t = el('div.toggle' + (initial ? '.on' : ''));
          t.addEventListener('click', () => { const v = !t.classList.contains('on'); t.classList.toggle('on', v); fn(v); this.wake(); });
          return el('div.gc-row', {}, [el('span', { text: label }), t]);
        };
        const mkSlider = (label, min, max, val, fn) => {
          const inp = el('input', { type: 'range', min: String(min), max: String(max), step: '0.1', value: String(val) });
          inp.addEventListener('input', () => { fn(parseFloat(inp.value)); this.wake(0.4); });
          return el('label.gc-slider', {}, [el('span', { text: label }), inp]);
        };
        gcBody.appendChild(this.filterInput);
        gcBody.appendChild(mkToggle('Orphans', true, v => this.showOrphans = v));
        gcBody.appendChild(mkToggle('Tags', false, v => { this.showTags = v; this.buildGraph(true); }));
        gcBody.appendChild(mkToggle('Unresolved', true, v => { this.showGhosts = v; this.buildGraph(true); }));
        this.showGhosts = true;
        gcBody.appendChild(mkSlider('Repel', 0.3, 3, 1, v => this.repulsion = v));
        gcBody.appendChild(mkSlider('Link dist', 0.4, 2.5, 1, v => this.linkDist = v));
        header.addEventListener('click', () => this.controls.classList.toggle('folded'));
        this.controls.appendChild(header);
        this.controls.appendChild(gcBody);
        this.body.appendChild(this.controls);
      } else {
        this.showGhosts = true;
      }
      this.tooltip = el('div.graph-tooltip', { style: { display: 'none' } });
      this.body.appendChild(this.tooltip);
      this.container.appendChild(this.body);
      this.fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';

      this.ro = new ResizeObserver(() => {
        // Defer to the next frame: mutating the canvas inside the observer
        // callback can trigger another notification in the same delivery
        // cycle, which browsers surface as "ResizeObserver loop completed
        // with undelivered notifications". One in-flight resize is enough.
        if (this._resizeScheduled || this.destroyed) return;
        this._resizeScheduled = true;
        const raf = global.requestAnimationFrame || (fn => setTimeout(fn, 16));
        raf(() => {
          this._resizeScheduled = false;
          if (!this.destroyed) this.resize();
        });
      });
      this.ro.observe(this.body);
      this.resize();
    }

    readColors() {
      const cs = getComputedStyle(document.documentElement);
      const v = name => cs.getPropertyValue(name).trim() || '#888';
      this.colors = {
        accent: v('--accent') || '#8a7cf8',
        text: v('--text-normal') || '#ddd',
        muted: v('--text-faint') || '#666',
        line: v('--bg-modifier-border') || '#333',
        tag: v('--tag-color') || '#6ec6b4',
        bg: v('--bg-primary') || '#202020'
      };
      this._rgbCache = {};
    }

    hexA(hex, a) {
      // hex like #rrggbb → rgba(), with per-color parse cache (called per frame)
      if (!hex || hex[0] !== '#' || hex.length < 7) return hex;
      let c = this._rgbCache && this._rgbCache[hex];
      if (!c) {
        c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        if (this._rgbCache) this._rgbCache[hex] = c;
      }
      return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    }

    resize() {
      const dpr = global.devicePixelRatio || 1;
      const w = this.body.clientWidth, h = this.body.clientHeight;
      if (!w || !h) return;
      // Skip when nothing changed: assigning canvas.width/height clears the
      // canvas and can itself provoke a resize notification.
      if (w === this.w && h === this.h && dpr === this._canvasDpr) return;
      this._canvasDpr = dpr;
      const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (this.canvas.width !== cw) this.canvas.width = cw;
      if (this.canvas.height !== ch) this.canvas.height = ch;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = w; this.h = h;
      if (!this._initializedView) {
        this._initializedView = true;
        this.tx = w / 2; this.ty = h / 2;
        this.scale = this.opts.mini ? 0.8 : 1;
      }
      this.wake(0.15);
    }

    /* ---------- data ---------- */
    buildGraph(keepPositions) {
      const vault = Obs.vault;
      if (!keepPositions) this._fitted = false;
      const old = keepPositions && this.nodes ? new Map(this.nodes.map(n => [n.id, n])) : null;
      const nodes = [];
      const nodeById = new Map();
      const edges = [];

      const inLocal = this.opts.rootPath ? this.localSet() : null;

      const addNode = (id, label, group) => {
        let n = nodeById.get(id);
        if (!n) {
          const prev = old && old.get(id);
          n = {
            id, label, group, degree: 0,
            x: prev ? prev.x : (Math.random() - 0.5) * 320,
            y: prev ? prev.y : (Math.random() - 0.5) * 320,
            vx: 0, vy: 0, pinned: false
          };
          nodeById.set(id, n);
          nodes.push(n);
        }
        return n;
      };

      let count = 0;
      for (const note of vault.notes.values()) {
        if (count++ > MAX_NODES) break;
        if (inLocal && !inLocal.has(note.path)) continue;
        addNode(note.path, note.name, 'note');
      }
      for (const note of vault.notes.values()) {
        if (inLocal && !inLocal.has(note.path)) continue;
        const src = nodeById.get(note.path);
        if (!src) continue;
        for (const l of note.links) {
          if (!l.target && l.heading) continue; // same-note heading links
          if (l.target && Obs.vault.isImagePath(l.target) && !l.resolvedPath) continue; // missing images: no ghost
          if (l.resolvedPath) {
            if (inLocal && !inLocal.has(l.resolvedPath)) continue;
            const dst = nodeById.get(l.resolvedPath);
            if (dst && dst !== src) { edges.push([src, dst]); src.degree++; dst.degree++; }
          } else if (this.showGhosts && l.target) {
            const gid = 'ghost:' + l.target.toLowerCase();
            const dst = addNode(gid, l.target, 'ghost');
            edges.push([src, dst]); src.degree++; dst.degree++;
          }
        }
        if (this.showTags) {
          for (const t of note.tags) {
            const tn = addNode('tag:#' + t, '#' + t, 'tag');
            edges.push([src, tn]); src.degree++; tn.degree++;
          }
        }
      }

      const visible = this.showOrphans ? nodes : nodes.filter(n => n.degree > 0 || n.id === this.opts.rootPath);
      this.nodes = visible;
      this.allNodes = nodes;
      this.edges = edges.filter(([a, b]) => visible.includes(a) && visible.includes(b));
      for (const n of this.nodes) n.r = n.id === this.opts.rootPath ? 9 : clamp(3.5 + Math.sqrt(n.degree) * 2.2, 3.5, 15);
      this.neighbors = new Map();
      for (const [a, b] of this.edges) {
        if (!this.neighbors.has(a)) this.neighbors.set(a, new Set());
        if (!this.neighbors.has(b)) this.neighbors.set(b, new Set());
        this.neighbors.get(a).add(b);
        this.neighbors.get(b).add(a);
      }
      if (this.stats) this.stats.textContent = `${this.nodes.length} nodes · ${this.edges.length} links${this.opts.rootPath ? ' · local' : ''}`;
      this.wake(0.8);
    }

    /** Set of note paths within depth of rootPath. */
    localSet() {
      const vault = Obs.vault;
      const depth = this.opts.depth || 1;
      const seen = new Set([this.opts.rootPath]);
      let frontier = [this.opts.rootPath];
      for (let d = 0; d < depth; d++) {
        const next = [];
        for (const p of frontier) {
          for (const b of vault.backlinksFor(p)) if (!seen.has(b.path)) { seen.add(b.path); next.push(b.path); }
          for (const o of vault.outgoingFor(p)) if (o.resolvedPath && !seen.has(o.resolvedPath)) { seen.add(o.resolvedPath); next.push(o.resolvedPath); }
        }
        frontier = next;
        if (!frontier.length) break;
      }
      return seen;
    }

    wake(a) { this.alpha = Math.max(this.alpha, a == null ? 0.6 : a); this.startLoop(); }

    /** Start the physics/draw loop if it is not already running. A call with
        alpha already 0 performs a single redraw, then the loop parks itself. */
    startLoop() {
      if (this.destroyed || this._looping) return;
      this._looping = true;
      this.loop();
    }

    /** Fit all nodes into the viewport. */
    fitToView() {
      if (!this.nodes || !this.nodes.length || !this.w || !this.h) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of this.nodes) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
      const pad = 70;
      const bw = (maxX - minX) + pad * 2, bh = (maxY - minY) + pad * 2;
      if (bw <= 0 || bh <= 0) return;
      this.scale = clamp(Math.min(this.w / bw, this.h / bh), 0.15, this.opts.mini ? 1.15 : 1.8);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      this.tx = this.w / 2 - cx * this.scale;
      this.ty = this.h / 2 - cy * this.scale;
    }

    /* ---------- physics ---------- */
    tick() {
      const nodes = this.nodes || [];
      const n = nodes.length;
      if (!n) { this.alpha = 0; return; }
      const REP = 2600 * this.repulsion;
      const LINK = (this.opts.mini ? 55 : 85) * this.linkDist;
      const SPRING = 0.03;
      const a = this.alpha;

      // repulsion (O(n²), sampled when huge)
      const stride = n > 400 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const p = nodes[i];
        for (let j = i + stride; j < n; j += stride) {
          const q = nodes[j];
          let dx = p.x - q.x, dy = p.y - q.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 250000) continue;
          if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
          const f = (REP * a) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          if (!p.pinned) { p.vx += fx; p.vy += fy; }
          if (!q.pinned) { q.vx -= fx; q.vy -= fy; }
        }
      }
      // springs
      for (const [p, q] of this.edges) {
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const f = (d - LINK) * SPRING * a;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        if (!p.pinned) { p.vx += fx; p.vy += fy; }
        if (!q.pinned) { q.vx -= fx; q.vy -= fy; }
      }
      // gravity + integrate
      const G = 0.012 * a;
      for (const p of nodes) {
        if (p.pinned) { p.vx = 0; p.vy = 0; continue; }
        p.vx -= p.x * G;
        p.vy -= p.y * G;
        p.vx *= 0.82; p.vy *= 0.82;
        p.x += clamp(p.vx, -30, 30);
        p.y += clamp(p.vy, -30, 30);
      }
      this.alpha *= 0.99;
      if (this.alpha < 0.015) this.alpha = 0;
    }

    /* ---------- drawing ---------- */
    draw() {
      const ctx = this.ctx;
      if (!this.w || !this.h) return;
      if (!this.nodes || !this.edges) return;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.save();
      ctx.translate(this.tx, this.ty);
      ctx.scale(this.scale, this.scale);

      const filter = this.filter;
      const hover = this.hoverNode;
      const hoverN = hover ? this.neighbors.get(hover) : null;
      const matches = n => !filter || n.label.toLowerCase().includes(filter);

      // edges
      for (const [p, q] of this.edges) {
        const dim = filter ? !(matches(p) || matches(q)) : hover ? !(p === hover || q === hover) : false;
        ctx.strokeStyle = hover && (p === hover || q === hover) ? this.hexA(this.colors.accent, 0.65) : this.hexA(this.colors.muted, dim ? 0.05 : 0.22);
        ctx.lineWidth = (hover && (p === hover || q === hover) ? 1.4 : 0.8) / this.scale;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      // nodes
      for (const n of this.nodes) {
        const dim = filter ? !matches(n) : hover ? !(n === hover || (hoverN && hoverN.has(n))) : false;
        const isHover = n === hover;
        ctx.globalAlpha = dim ? 0.12 : 1;
        if (n.group === 'ghost') {
          ctx.strokeStyle = this.colors.muted;
          ctx.lineWidth = 1.2 / this.scale;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = this.hexA(this.colors.bg, 0.6);
          ctx.fill();
        } else if (n.group === 'tag') {
          ctx.fillStyle = this.hexA(this.colors.tag, 0.85);
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = n.id === this.opts.rootPath ? this.colors.accent : this.hexA(this.colors.accent, isHover ? 1 : 0.82);
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          ctx.fill();
          if (isHover || n.id === this.opts.rootPath) {
            ctx.strokeStyle = this.colors.text;
            ctx.lineWidth = 1.2 / this.scale;
            ctx.stroke();
          }
        }
        // labels
        const showLabel = this.scale > 0.85 || isHover || (hover && hoverN && hoverN.has(n)) || n.id === this.opts.rootPath || (!this.opts.mini && this.scale > 0.55 && n.degree >= 3);
        if (showLabel && !dim) {
          ctx.font = `${(isHover ? 12 : 11) / this.scale}px ${this.fontFamily}`;
          ctx.fillStyle = isHover ? this.colors.text : this.hexA(this.colors.text, 0.75);
          ctx.textAlign = 'center';
          const label = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label;
          ctx.fillText(label, n.x, n.y + n.r + 12 / this.scale);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }


    loop() {
      if (this.destroyed) { this._looping = false; return; }
      if (this.alpha > 0) {
        this.tick();
        // keep the view framed while the layout settles (user pan/zoom takes over)
        if (!this._fitted) this.fitToView();
      }
      this.draw();
      if (this.alpha > 0) {
        this._raf = requestAnimationFrame(() => this.loop());
      } else {
        this._looping = false;
      }
    }

    /* ---------- interaction ---------- */
    toWorld(sx, sy) { return { x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale }; }

    nodeAt(sx, sy) {
      const w = this.toWorld(sx, sy);
      let best = null, bestD = Infinity;
      for (const n of this.nodes) {
        const dx = n.x - w.x, dy = n.y - w.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const hit = n.r + 4 / this.scale;
        if (d < hit && d < bestD) { best = n; bestD = d; }
      }
      return best;
    }

    bindEvents() {
      const c = this.canvas;

      const onDown = e => {
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const n = this.nodeAt(sx, sy);
        this._downPos = { x: e.clientX, y: e.clientY };
        if (n) { this.dragNode = n; n.pinned = true; }
        else this.panning = true;
        c.classList.add('dragging');
        this.startLoop();
      };

      const onMove = e => {
        if (this.destroyed) return;
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const inside = sx >= 0 && sy >= 0 && sx <= rect.width && sy <= rect.height;
        if (this.dragNode) {
          const w = this.toWorld(sx, sy);
          this.dragNode.x = w.x; this.dragNode.y = w.y;
          this.wake(0.25);
        } else if (this.panning && this._downPos) {
          this.tx += e.clientX - (this._lastPan ? this._lastPan.x : this._downPos.x);
          this.ty += e.clientY - (this._lastPan ? this._lastPan.y : this._downPos.y);
          this._lastPan = { x: e.clientX, y: e.clientY };
          this._fitted = true;
          this.startLoop();
        } else if (inside) {
          const n = this.nodeAt(sx, sy);
          if (n !== this.hoverNode) { this.hoverNode = n; c.style.cursor = n ? 'pointer' : ''; this.startLoop(); }
          if (n && !this.opts.mini) {
            this.tooltip.textContent = n.group === 'tag' ? n.label : (n.group === 'ghost' ? n.label + ' (not created yet)' : stripExt(baseName(n.id)) + ' — ' + n.degree + ' links');
            this.tooltip.style.display = 'block';
            this.tooltip.style.left = clamp(sx + 14, 0, Math.max(10, this.w - 200)) + 'px';
            this.tooltip.style.top = clamp(sy + 10, 0, Math.max(10, this.h - 30)) + 'px';
          } else this.tooltip.style.display = 'none';
        } else if (this.hoverNode) {
          this.hoverNode = null;
          this.tooltip.style.display = 'none';
          this.startLoop();
        }
      };

      const onUp = e => {
        if (this.destroyed) return;
        const moved = this._downPos && (Math.abs(e.clientX - this._downPos.x) > 4 || Math.abs(e.clientY - this._downPos.y) > 4);
        if (this.dragNode) {
          const n = this.dragNode;
          n.pinned = false;
          this.dragNode = null;
          if (!moved) this.openNode(n);
        } else if (this.panning && !moved && this._downPos) {
          const rect = c.getBoundingClientRect();
          const n = this.nodeAt(e.clientX - rect.left, e.clientY - rect.top);
          if (n) this.openNode(n);
        }
        this.panning = false;
        this._lastPan = null;
        c.classList.remove('dragging');
      };

      const onWheel = e => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const ns = clamp(this.scale * factor, 0.08, 8);
        const w = this.toWorld(sx, sy);
        this.scale = ns;
        this.tx = sx - w.x * ns;
        this.ty = sy - w.y * ns;
        this._fitted = true;
        this.startLoop();
      };

      const onDbl = e => {
        const rect = c.getBoundingClientRect();
        const n = this.nodeAt(e.clientX - rect.left, e.clientY - rect.top);
        if (n && n.group === 'note' && Obs.tabs) Obs.tabs.openNote(n.id);
      };

      c.addEventListener('mousedown', onDown);
      global.addEventListener('mousemove', onMove);
      global.addEventListener('mouseup', onUp);
      c.addEventListener('wheel', onWheel, { passive: false });
      c.addEventListener('dblclick', onDbl);
      this._unbind = () => {
        c.removeEventListener('mousedown', onDown);
        global.removeEventListener('mousemove', onMove);
        global.removeEventListener('mouseup', onUp);
        c.removeEventListener('wheel', onWheel);
        c.removeEventListener('dblclick', onDbl);
      };

      this._themeOff = Obs.bus.on('theme:changed', () => { this.readColors(); this.startLoop(); });
      this._vaultOff = Obs.bus.on('vault:changed', () => { if (!this.destroyed) this.buildGraph(true); });
    }

    openNode(n) {
      if (n.group === 'tag') {
        if (Obs.leftPane) { Obs.leftPane.setPanel('search'); Obs.leftPane.searchFor('#' + n.label.slice(1)); }
        return;
      }
      if (n.group === 'ghost') {
        Obs.vault.createNote(n.label).then(note => { if (Obs.tabs) Obs.tabs.openNote(note.path); });
        return;
      }
      if (Obs.tabs) Obs.tabs.openNote(n.id);
    }

    destroy() {
      this.destroyed = true;
      this._looping = false;
      cancelAnimationFrame(this._raf);
      if (this.ro) this.ro.disconnect();
      if (this._unbind) this._unbind();
      if (this._themeOff) this._themeOff();
      if (this._vaultOff) this._vaultOff();
      this.container.innerHTML = '';
    }
  }

  Obs.graph = { GraphView };
})(typeof window !== 'undefined' ? window : globalThis);
