# Obsidian Web

A **local-first, single-page Obsidian clone** for the browser — built with plain **HTML, CSS and JavaScript only**.
No frameworks, no build step, no external libraries, no network requests. Your notes live in the browser's
**IndexedDB** and can be exported at any time as a **.zip** (full vault), single **.md** files, or a **JSON backup**.

## Run it

**Option A — just open it:** double-click `index.html`. Works in Chrome/Edge/Firefox.
*(Some browsers restrict IndexedDB on `file://` — if saving seems off, use Option B.)*

**Option B — serve it (recommended):**

```bash
cd obsidian-web
python3 -m http.server 8000
# open http://localhost:8000
```

On first launch the vault is empty — create a note, import `.md` files, or use the quick switcher to get started.

## Features (vs. real Obsidian)

Implemented in vanilla JS:

| Area | Features |
| --- | --- |
| **Editing** | Split live-preview (write / split / read modes, `Ctrl+E`), autosave to IndexedDB, **find & replace in note** (`Ctrl+F` / `Ctrl+H`), word/char/cursor status bar, formatting toolbar, list auto-continuation, Tab/Shift+Tab indent, pair-wrapping (`**`, `` ` ``, `[[`…), paste screenshots as attachments |
| **Markdown** | Headings, bold/italic/strikethrough, `==highlight==`, **syntax-highlighted** code blocks (js/ts, python, json, css, html/xml, bash, sql — copy button included), quotes, nested + ordered lists, **clickable task lists**, tables with alignment, horizontal rules, safe inline HTML, **footnotes** `[^1]` with numbered section + back-links, **block ids** `^my-id` |
| **Obsidian syntax** | `[[Wikilinks]]` with aliases & `#heading` links, **unresolved links create notes on click**, `![[note]]` / `![[note#section]]` embeds, `![[image.png|300]]` image embeds, `> [!type]` **callouts** (13 styled types, foldable with `-`/`+`), YAML **frontmatter/properties** (rendered collapsible, powers tags & aliases), `#tags` (nested `#a/b`), `%%comments%%` |
| **Vault** | File explorer tree with folders, **drag & drop notes/images onto folders to move them**, sort by name / modified / created, create/rename/move/delete via context menus, **renames auto-update links everywhere**, in-app **trash** with restore, **bookmarks** (starred notes), attachments (images) stored as blobs |
| **Linking** | **Backlinks** with snippets, **outgoing links**, **unlinked mentions**, hover **page preview**, aliases respected (`[[Home]]` → Welcome) |
| **Graph view** | Force-directed canvas graph with auto-fit: zoom/pan/drag nodes, hover highlight, ghost nodes for missing notes (click = create), filters (search/orphans/tags/unresolved), physics sliders, **local graph** per note (also mini version in right sidebar) |
| **Navigation** | **Tabs** (+ middle-click close, session restore), navigate back/forward (`Alt+←/→`), **quick switcher** `Ctrl+O` (fuzzy, Enter creates note), **command palette** `Ctrl+P`, outline pane, `Ctrl+G` graph |
| **Search** | Full-text search with snippets & `<mark>` highlights, match-case & regex toggles |
| **Notes** | **Daily notes** (`Ctrl+Alt+D`, configurable folder/date format), **templates** with `{{title}}/{{date}}/{{time}}`, random note |
| **Slash commands** | Type `/` while writing: `/link`, `/embed`, `/image`, `/template`, `/callout`, `/h1`–`/h4`, `/list`, `/task`, `/table`, `/code`, `/quote`, `/hr`, `/date`, `/time`, `/footnote`. **Tab enters the picker and then Tab-cycles through your notes / images / templates / callout types**, Enter inserts at the cursor. Tab also cycles candidates in the command palette & quick switcher and **completes paths** (folders/notes) in the New-note / Rename dialogs (e.g. from the header title) |
| **Quality of life** | **Drag a note/image from the explorer anywhere onto the open note → inserts a `[[link]]`/`![[img]]` at the cursor** (works in read mode & over the preview too) · drop OS files onto the editor → imports & links them · double-click reading view → edit that exact line · Ctrl/middle-click links → background tab · drop a note onto a tab → opens it there · drag tabs to reorder · double-click tab title → rename · reopen closed tabs (`Ctrl+Shift+T`) · duplicate/move/delete lines · paste a URL over a selection → markdown link · selection word count · click a backlink/mention → jumps to the exact line · hover-previews are clickable |
| **Data** | Export vault **.zip** (folders + attachments + settings), per-note **.md**, per-note **PDF** (menu ⋯ → *Export as PDF…*, palette, or just press the browser's `Ctrl+P` — a dedicated paper stylesheet prints only the note, with proper page margins & page-break rules), **JSON backup**; import **.md/.txt/images** (files, whole folders, or drag & drop), import JSON backup; storage-usage display |
| **Looks** | Dark & light themes, 6 accent colors, adjustable text size, monospace editor option, responsive layout (sidebars collapse on small screens) |

Deliberately **not** implemented (would need libraries or huge effort): LaTeX math, Mermaid diagrams,
Canvas (.canvas), slides, audio recorder, sync/publish, community plugins.

## Keyboard shortcuts

| Keys | Action | Keys | Action |
| --- | --- | --- | --- |
| `Ctrl+P` | Command palette | `Ctrl+O` | Quick switcher |
| `Ctrl+Alt+N` | New note | `Ctrl+E` | Cycle write/split/read |
| `Ctrl+S` | Save now (autosaves anyway) | `Ctrl+G` | Graph view |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+K` | Bold / italic / `[[link]]` | `Ctrl+F` / `Ctrl+H` | Find / find & replace in note |
| `Ctrl+Shift+F` | Search all notes | `Ctrl+Alt+D` | Daily note |
| `Alt+←` / `Alt+→` | Navigate back / forward | `F2` | Rename current note |
| `Ctrl+Shift+←/→` | Previous / next tab | `Ctrl+Alt+W` | Close tab |
| `Ctrl+Shift+T` | Reopen closed tab | `Ctrl+D` | Duplicate line(s) |
| `Alt+↑` / `Alt+↓` | Move line(s) up / down | `Ctrl+Shift+K` | Delete line(s) |
| `Ctrl+Alt+L` / `Ctrl+Alt+R` | Toggle left / right sidebar | `Ctrl+,` | Settings |
| type `[[` | Link autocomplete | drag note → editor | Insert link at cursor |
| type `/` then `Tab` | Slash command → cycle notes/templates/types | drag note → tab | Open note in that tab |

(`Ctrl` = `⌘` on macOS. Full list in *Settings → Hotkeys*.)

## Project structure

```
obsidian-web/
├── index.html              app shell (panels, tab bar, status bar)
├── css/
│   ├── base.css            design tokens, dark/light themes, controls
│   ├── layout.css          app grid: ribbon, sidebars, tabs, status bar
│   ├── editor.css          editor panes + full markdown-preview styling
│   └── components.css      modals, palette, menus, explorer, graph, settings
├── js/
│   ├── util.js             helpers, event bus, paths, fuzzy match, downloads
│   ├── sanitize.js         allow-list HTML sanitizer (XSS choke point)
│   ├── ui.js               icon set (inline SVG), modals, prompts, menus, toasts
│   ├── zip.js              dependency-free ZIP writer (STORE + CRC32)
│   ├── markdown.js         Obsidian-flavored Markdown parser (pure)
│   ├── db.js               IndexedDB wrapper (notes/files/trash/meta)
│   ├── vault.js            in-memory index: links, backlinks, tags, aliases, search, rename
│   ├── graph.js            force-directed graph (canvas)
│   ├── editor.js           note view: textarea + live preview + interactions
│   ├── leftpanes.js        file explorer / search / tags panels
│   ├── rightpane.js        outline, backlinks, outgoing & unlinked links, mini graph
│   ├── tabs.js             tabs, navigation history, session restore
│   ├── palette.js          suggester modals (commands, switcher, templates, trash)
│   ├── commands.js         command registry + hotkey dispatch
│   ├── settings.js         settings modal (appearance/editor/files/data/hotkeys)
│   ├── exportimport.js     ZIP / .md / JSON export, file & folder import
│   └── app.js              bootstrap, wiring
```

## Security

Note content is **untrusted input**, so it is funnelled through a single choke point:

- **`js/sanitize.js`** parses rendered HTML into an *inert* document (nothing loads or runs),
  then keeps only an allow-list of tags/attributes and safe URL schemes. All preview, print and
  hover-preview output goes through it.
- **Raw HTML in notes is still supported** (`<details>`, `<u>`, `<mark>`, `<span>`, tables, …)
  but is sanitised — event handlers (`on*`), `<script>`/`<iframe>`/`<svg>`, inline `style`,
  and `javascript:`/`data:` URLs are stripped.
- **Remote images are blocked.** `![](https://…)` and `![[https://….png]]` render as plain links and
  are never fetched; only vault attachments (`blob:`) and local `data:image/*` are shown.
- **Content-Security-Policy** is declared in `index.html` (`default-src 'none'`, no inline scripts or
  styles, `connect-src 'none'`). When serving over HTTP you can also send it as a header, which
  additionally enables `frame-ancestors` protection.

## Data & privacy

Everything (notes, attachments, settings, trash) is stored **only** in this browser's IndexedDB
(database name: `obsidian-web-vault`). Nothing is uploaded anywhere. Clearing browser data for the
site deletes the vault — keep a ZIP/JSON export as backup. The exported `.zip` contains plain `.md`
files, so it can be opened directly by the real Obsidian as a vault.

Not affiliated with Obsidian / obsidian.md.
