# Static Obsidian

A client-side, markdown-based note editor with live preview, file tree, and Obsidian-like syntax — zero build step, runs entirely in the browser.

## Features

### Editor
- Markdown textarea with live preview (400 ms debounce)
- Split pane: editor left / preview right (50 % each)
- Double-click preview jumps to corresponding source in editor
- Auto-save (500 ms debounce) + `pagehide` force-save

### File Tree (floating popout window)
- All notes listed sorted by `updated_at` descending
- Create new note (`+`)
- Rename (`✏`), delete (`✖`) on hover
- Active file highlighted with accent left border
- Window draggable by title bar, hide via `─`
- Restore via `☰ Files` button in topbar
- Visibility persisted in `localStorage`

### Markdown / GFM
- Headings, lists, tables, code blocks, blockquotes, horizontal rules
- `**bold**`, `*italic*`, `~~strikethrough~~`, `` `code` ``
- Links and images
- `breaks: true` — newlines become `<br>`

### Obsidian Syntax
| Syntax | Meaning |
|--------|---------|
| `==text==` | Highlight (`<mark>`) |
| `#tag` | Tag badge (`<span class="tag">`) |
| `[[wikilink]]` | Wiki link (clickable → scrolls preview + jumps editor) |
| `![[image.png]]` | Embedded image (from IndexedDB) |
| `![[image.png\|200x150]]` | Image with width x height |
| `![[image.png\|200]]` | Image with fixed width |
| `> [!note] Title` | Callout box (note/info/tip/warning/danger/quote) |

### Callouts
- Color-coded: note (blue), info (teal), tip (green), warning (orange), danger (red), quote (gray)
- Title bar + body, implemented via preprocessor + postprocessor

### KaTeX (LaTeX)
- `$...$` for inline math
- `$$...$$` for display math (works across multiple `<br>` tags)
- Rendered client-side with KaTeX

### Mermaid
- Diagrams in code blocks with `mermaid` language
- Rendered asynchronously with Mermaid (dark theme)

### Images
- Paste / drag & drop images → base64 in IndexedDB
- `![[name]]` inserts the image
- Images overlay (`Images` button) to view / delete
- Automatic cleanup of unused images (60 s grace period)

### Multi-File Storage
- IndexedDB: `files` store (key: filename) + `images` store
- Migration from legacy `vault` store (single-file) → `files` (multi-file)
- Auto-naming: `untitled.md`, `untitled1.md`, `untitled2.md` …
- Rename prompt on load for untitled notes with content

### Export / Import
- Download `.md` (current note)
- Export JSON (all notes + images)
- Import JSON
- Print / PDF

### Additional UI
- Dark theme (high contrast, Obsidian-like)
- Floating file tree popout (formerly a sidebar) — draggable, hideable
- Rename overlay for untitled notes on load
- Scrollable preview with thin scrollbars

### Security
- DOMPurify sanitization of rendered HTML
- Allowed tags / attributes explicitly configured

### Out of Scope (not implemented)
- No note embeds, no block refs, no checkbox sync
- No code highlighting, no settings page
- No filesystem access — everything in IndexedDB
- No service worker / PWA

## Architecture

```
index.html              – Entry point, import-map (CDN), topbar, split-pane
assets/css/styles.css   – Full dark theme (~700 lines)
src/
├── app.js              – Init lifecycle, sidebar window (drag/hide), jump, rename prompt
├── core/
│   ├── state.js        – Event bus, global state (content, filename, files, images, tags)
│   └── storage.js      – IndexedDB CRUD (files/images), migration, export/import, image cleanup
├── parser/
│   ├── config.js       – markdown-it init (html, breaks, linkify)
│   └── preprocess.js   – Regex transforms: highlights, tags, images, callouts, wikilinks
├── render/
│   ├── preview.js      – DOMPurify + debounced render (400 ms)
│   └── postprocess.js  – Callout DOM, KaTeX (display+inline), Mermaid, wikilink clicks
└── ui/
    ├── editor.js       – Textarea wrapper, insertAtCursor, searchAndJump
    ├── handlers.js     – Paste/drop, images overlay, rename, download, print, export/import
    └── sidebar.js      – File list render, switch, create, rename, delete
```

## CDN Dependencies (via Import Map)

| Library | CDN |
|---------|-----|
| markdown-it | `cdn.jsdelivr.net/npm/markdown-it@14.1.1/+esm` |
| dompurify | `cdn.jsdelivr.net/npm/dompurify@3.2.4/+esm` |
| katex | `cdn.jsdelivr.net/npm/katex@0.16.11/+esm` |
| mermaid | `cdn.jsdelivr.net/npm/mermaid@11.4.1/+esm` |
| KaTeX CSS | `cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css` |

## Usage

Open `index.html` in a browser (`file://` or `http://`). No server required.

## Files

| File | Purpose |
|------|---------|
| `TEST.md` | Test document covering all supported features |
| `assets/logo.svg` | App logo |
| `assets/css/styles.css` | All styles (dark theme, callout colors, print, overlays) |
