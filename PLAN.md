# Static Obsidian — Implementation Plan

## Overview
Client-side SPA: single-note editor with live Markdown preview, Obsidian-like syntax,
IndexedDB persistence, zero backend, zero build step.

## Architecture
```
Editor (textarea) → State (raw MD) → Parser (markdown-it + plugins) → DOMPurify → Preview (DOM)
                                  ↕                                   ↕
                           IndexedDB                           Post-process (KaTeX, Mermaid)
```

## File Structure
```
Obsidian-web/
├── index.html              # Shell: top bar, split panes, script imports
├── PLAN.md
├── ANGABE.md
├── assets/
│   └── css/
│       └── styles.css      # All styles (dark theme, split, components)
├── src/
│   ├── core/
│   │   ├── state.js        # Vault state, event bus, metadata
│   │   └── storage.js      # IndexedDB save/load, JSON export/import
│   ├── parser/
│   │   ├── preprocess.js   # Regex: ==highlights==, #tags, [[links]], ![[images]]
│   │   ├── config.js       # markdown-it init + html:true + callouts plugin
│   │   └── plugins/
│   │       └── callouts.js # > [!type] → callout divs (core rule)
│   ├── render/
│   │   ├── preview.js      # DOMPurify sanitize + debounced DOM injection
│   │   └── postprocess.js  # KaTeX, Mermaid deferred, wikilink bindings
│   ├── ui/
│   │   ├── editor.js       # Textarea wrapper + cursor API
│   │   └── handlers.js     # Paste/drop → image → base64 → ![[name]]
│   └── app.js              # Init, lifecycle, wiring
└── vendor/                 # (empty — CDN loaded)
```

## Phases

### Phase 1 — Core Infrastructure
1. `index.html` — top bar, split-pane, importmap for CDN deps
2. `styles.css` — dark theme, 50/50 split, typography, components
3. `state.js` — raw markdown, image cache, tag index, event bus
4. `storage.js` — IndexedDB save/load/export/import
5. `preprocess.js` — regex for ==highlights== → `<mark>`, #tags → `<span>`, [[links]] → `<a>`, ![[images]] → `<img>`
6. `config.js` — markdown-it with `html: true`, callouts plugin
7. `callouts.js` — core rule transform: `> [!type]` → callout div
8. `preview.js` — DOMPurify sanitize, debounced render (400ms)
9. `editor.js` — textarea wrapper, cursor API
10. `handlers.js` — paste/drop → image storage → insert
11. `app.js` — init, wire, lifecycle
12. `postprocess.js` — KaTeX, Mermaid, wikilink click bindings

### Phase 3 — Media
1. `handlers.js` — paste/drop → extract image → storage → `![[name]]` insert
2. Image cache in `state.js` / `storage.js`

### Phase 4 — Advanced Rendering
1. `postprocess.js` — KaTeX auto-render on `$…$`, `$$…$$`
2. Mermaid deferred render on `.language-mermaid` code blocks

## Excluded (per spec)
Embeds (`![[note]]`), block refs (`^id`), checkbox sync, file tree, code highlighting, settings.

## Key Decisions
- **Editor**: Native `<textarea>` (no CodeMirror dependency — keeps bundle minimal)
- **Parser**: markdown-it via CDN (esm)
- **Sanitizer**: DOMPurify via CDN
- **Storage**: IndexedDB single-object-store
- **Debounce**: 400ms on render
- **CDN libs**: markdown-it, DOMPurify, KaTeX, Mermaid
