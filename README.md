# Static Obsidian

<a href="https://blqnk3d.github.io/Obsidian-web" style="color:#888">To the side </a>

A client-side, markdown-based note editor with live preview, file tree, and Obsidian-like syntax — zero build step, runs entirely in the browser.

## Features

### Editor

- Markdown textarea with live preview (400 ms debounce)
- Split pane: editor left / preview right (50 % each)
- Double-click preview jumps to corresponding source in editor
- Auto-save (500 ms debounce) + `pagehide` force-save

### Formatting Toolbar

- **B** bold, **I** italic, **H** highlight — wrap selection with `**`, `*`, `==`
- **H▾** heading dropdown (H1–H6) — inserts at line start
- **•** bullet list, **1.** numbered list — inserts at line start
- **—** horizontal rule, **&lt;/&gt;** code block
- **[[ ]]** wiki-link — wrap selection with `[[]]`
- **▣▾** callout dropdown — inserts `> [!TYPE]\n> ` template

### File Tree (floating popout window)

- All notes listed sorted by `updated_at` descending
- Create new note (`+`)
- Rename (`✏`), delete (`✖`) on hover
- Deleting the last file auto-creates `untitled.md`
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

| Syntax                    | Meaning                                                |
| ------------------------- | ------------------------------------------------------ |
| `==text==`                | Highlight (`<mark>`)                                   |
| `#tag`                    | Tag badge (`<span class="tag">`)                       |
| `[[wikilink]]`            | Wiki link (clickable → scrolls preview + jumps editor) |
| `![[image.png]]`          | Embedded image (from IndexedDB)                        |
| `![[image.png\|200x150]]` | Image with width x height                              |
| `![[image.png\|200]]`     | Image with fixed width                                 |
| `> [!note] Title`         | Callout box (note/info/tip/warning/danger/quote)       |

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
- Non-PNG → JPEG q0.7, downscale to 1920px max, PNG lossless, SVG bypass
- Naming modes (configurable in settings): date-index, random, prompt each time
- Images overlay (`Images` button, floating window) to view / insert / delete
- Automatic cleanup of unused images (60 s grace period)

### Settings (`⚙`)

- **Naming mode** for pasted images: `date-index` (default), `random`, `prompt`
- **Storage display**: notes count, images count + actual size, browser quota/usage with progress bar
- **Clear all data**: wipes all notes, images, and settings — creates a fresh `untitled.md`

### Multi-File Storage

- IndexedDB: `files` store (key: filename) + `images` store
- Migration from legacy `vault` store (single-file) → `files` (multi-file)
- Auto-naming: `untitled.md`, `untitled1.md`, `untitled2.md` …
- Rename prompt on load for untitled notes with content

### Export / Import

- Download `.md` (current note)
- Export JSON (all notes + images) — consolidated in a single modal
- Import JSON (via `Import vault` button in file tree footer)
- Print / PDF (via browser print dialog)

### Additional UI

- Dark theme (high contrast, Obsidian-like)
- Floating file tree popout (draggable, hideable)
- Floating images overlay (draggable, styled like file tree)
- Mutual exclusion: opening Files closes Images and vice-versa
- Rename overlay for untitled notes on load
- Scrollable preview with thin scrollbars
- Logo SVG as browser tab favicon
- Toolbar for common formatting operations

### Security

- DOMPurify sanitization of rendered HTML
- Allowed tags / attributes explicitly configured

### Out of Scope (not implemented)

- No note embeds, no block refs, no checkbox sync
- No code highlighting
- No filesystem access — everything in IndexedDB
- No service worker / PWA

## Architecture

```
index.html              – Entry point, import-map (CDN), topbar with toolbar, split-pane
assets/css/styles.css   – Full dark theme (~770 lines)
assets/logo.svg         – App logo / favicon
src/
├── app.js              – Init lifecycle, sidebar/images drag/toggle, jump, rename prompt
├── core/
│   ├── state.js        – Event bus, global state (content, filename, files, images, tags)
│   ├── storage.js      – IndexedDB CRUD (files/images), migration, export/import, image cleanup, clearStore
│   └── settings.js     – Image naming mode in localStorage
├── parser/
│   ├── config.js       – markdown-it init (html, breaks, linkify)
│   └── preprocess.js   – Regex transforms: highlights, tags, images, callouts, wikilinks
├── render/
│   ├── preview.js      – DOMPurify + debounced render (400 ms)
│   └── postprocess.js  – Callout DOM, KaTeX (display+inline), Mermaid, wikilink clicks
└── ui/
    ├── editor.js       – Textarea wrapper, insertAtCursor, wrapSelection, insertLinePrefix, searchAndJump
    ├── handlers.js     – Paste/drop, images overlay, export modal, settings modal, toolbar, pagehide save
    └── sidebar.js      – File list render, switch, create, rename, delete (auto-create on last)
```

## CDN Dependencies (via Import Map)

| Library     | CDN                                                     |
| ----------- | ------------------------------------------------------- |
| markdown-it | `cdn.jsdelivr.net/npm/markdown-it@14.1.1/+esm`          |
| dompurify   | `cdn.jsdelivr.net/npm/dompurify@3.2.4/+esm`             |
| katex       | `cdn.jsdelivr.net/npm/katex@0.16.11/+esm`               |
| mermaid     | `cdn.jsdelivr.net/npm/mermaid@11.4.1/+esm`              |
| KaTeX CSS   | `cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css` |

## Usage

Open `index.html` in a browser (`file://` or `http://`). No server required.

## Files

| File                    | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `TEST.md`               | Test document covering all supported features            |
| `assets/logo.svg`       | App logo / favicon                                       |
| `assets/css/styles.css` | All styles (dark theme, callout colors, print, overlays) |
