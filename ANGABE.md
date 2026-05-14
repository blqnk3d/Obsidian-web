Visual & UX Style
Theme: Dark mode only. High contrast text, low-saturation backgrounds. Obsidian-like but stripped of chrome.
Layout: Fixed 50/50 split pane. Editor left (monospace, line numbers optional), preview right (sans-serif, proportional spacing).
Typography: System UI stack (-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif). Editor uses Consolas, "Courier New", monospace. Line-height 1.6, generous paragraph spacing.
Components:
Callouts: Left border accent, muted background, flat header. No collapse toggles.
Highlights: background: #4b5563, rounded corners.
Tags: Inline pill style, subtle background, monospace font for consistency.
Wiki-links: Dashed underline, accent color, hover state only.
Chrome: Minimal top bar showing filename, save indicator, and export button. No sidebar, no file tree, no settings panel.
Performance-first styling: CSS-only scrollbars, zero transitions, no shadows, hardware-accelerated transforms only if needed.
Hard Limitations (Static/Client-Side)
Storage Quota: IndexedDB typically allows 50-100MB per origin. Base64 images inflate 33%. Practical vault limit: ~30MB total.
Parse Performance: Regex + markdown-it + post-processors run on every keystroke. Files >50KB will introduce noticeable lag. Debounce (300ms) and render throttling are mandatory.
No Real Filesystem: Browser sandbox prevents direct disk access. All files are isolated to browser storage. Export/import required for portability.
Cross-Note Resolution: ![[note]] and [[note]] cannot safely resolve other files without loading, parsing, and sanitizing them in memory. XSS and recursion risks are high.
Security: Raw HTML injection blocked. DOMPurify strips scripts/styles. Mermaid/KaTeX run post-render, adding ~150-300ms overhead per large block.
Feature Cost vs. Value Assessment
Feature
Cost (Dev/Perf)
Value (Static Context)
Decision
Standard MD + GFM
Low
High
Keep
LaTeX ($/$$)
Low
High
Keep (KaTeX)
Mermaid diagrams
Medium
Medium
Keep (deferred render)
==highlights==
Low
Medium
Keep (inline regex)
#tags
Low
Medium
Keep (visual only, no filter UI)

> [!callout]
> Medium
> Medium
> Keep (flat only, no nesting/folding)
> [[wiki-links]]
> Medium
> High
> Keep (mock navigation, no cross-file load)
> ![[image]] paste/drop
> Medium
> High
> Keep (base64 inline)
> Auto-save + Export
> Low
> High
> Keep (IndexedDB + JSON)
> ![[note]] embeds
> High
> Medium
> Drop (recursive parse, XSS risk, memory bloat)
> Block refs ^id
> High
> Low
> Drop (DOM ID mapping, scroll sync fragile)
> Task checkbox sync
> Medium
> Medium
> Drop (cursor tracking + text replacement brittle)
> File tree / Multi-note router
> High
> High
> Drop (requires state router, sync logic, exceeds static scope)
> Syntax highlighting (code)
> Medium
> Low
> Drop (heavy libs, marginal gain for static MD)
> Theme switching / Settings
> Low
> Low
> Drop (unnecessary complexity)
> Final Scope Definition
> Core: Single-note editor, live preview, debounced auto-save.
> Syntax: MD + GFM, highlights, tags (display), flat callouts, wiki-links (mock), LaTeX, Mermaid.
> Media: Image paste/drop → base64 → inline ![[img]].
> Storage: IndexedDB (content + image cache), JSON export/import.
> Style: Dark, minimal, split-pane, system fonts, zero animations.
> Excluded: Embeds, block refs, file tree, checkbox sync, cross-note routing, code highlighting, settings.
> This scope delivers 80% of daily Obsidian usage while remaining fully static, under 50KB gzipped (excluding vendors), and performant on low-end devices.

Architecture Overview
Type: Client-side SPA, zero backend. Runs entirely in browser.
Pattern: Unidirectional data flow (Editor → State → Parser → Sanitized DOM → Post-process).
Dependencies: Loaded via CDN or local vendor/ folder. No build step required. ES modules for clean separation.
File Structure & Naming
static-obsidian/
├── index.html
├── assets/
│ └── css/
│ └── styles.css
├── src/
│ ├── core/
│ │ ├── state.js # Central vault state & event bus
│ │ └── storage.js # IndexedDB/localStorage abstraction
│ ├── parser/
│ │ ├── config.js # markdown-it setup & GFM plugins
│ │ ├── preprocess.js # String/regex transforms for Obsidian syntax
│ │ └── plugins/
│ │ ├── callouts.js
│ │ ├── wikilinks.js
│ │ ├── embeds.js
│ │ └── highlights.js
│ ├── render/
│ │ ├── preview.js # DOM injection & sanitization
│ │ └── postprocess.js # KaTeX, Mermaid, interactive bindings
│ ├── ui/
│ │ ├── editor.js # CodeMirror/textarea config
│ │ └── handlers.js # Drag/drop, paste, click routing
│ └── app.js # Entry point, initialization, lifecycle
└── vendor/ # Local copies of CDN libraries (optional)
Module Responsibilities
state.js: Holds raw markdown, image cache, tag index, metadata. Emits change events.
storage.js: Persists state to IndexedDB. Handles export/import fallbacks. Manages image blobs.
preprocess.js: Scans raw markdown for ==highlights==, #tags, [[links]], ![[embeds]]. Converts to safe HTML placeholders before parser.
parser/config.js: Initializes markdown-it with GFM. Registers custom block/inline rules from plugins/.
preview.js: Receives HTML string, runs DOMPurify, injects into preview pane. Debounces updates.
postprocess.js: Triggers KaTeX auto-render, Mermaid init, attaches listeners to checkboxes and wiki-links.
ui/editor.js: Syncs cursor state, exposes text replacement API for image insertion.
ui/handlers.js: Intercepts paste/drop, extracts files, routes to storage, inserts ![[filename]] syntax.
Data & Storage Strategy
Content: Single JSON document per vault in IndexedDB. Keys: id, content, updated_at.
Media: Images stored as base64 or Blob references in a dedicated images object store. Indexed by filename for ![[name]] resolution.
Indexing: Tags and wiki-link targets extracted on save. Stored in metadata table for quick lookup.
Persistence: Auto-save on input debounce (500ms). Manual export/import via JSON.
Phased Implementation Plan
Phase 1: Core Infrastructure
Scaffold HTML/CSS layout (split editor/preview).
Implement state.js and storage.js with basic save/load.
Integrate markdown parser, connect editor to preview with debounced rendering.
Add DOMPurify sanitization pipeline.
Phase 2: Obsidian Syntax Support
Build preprocess.js for ==highlights== and #tags.
Implement callouts.js (block rule parsing > [!type], generating styled divs).
Add wikilinks.js (inline rule, generating <a> with data attributes).
Build tag index extraction on save.
Phase 3: Media & Interactivity
Implement handlers.js for clipboard paste and drag/drop.
Route files through storage.js, convert to base64/blob, update image cache.
Auto-insert ![[filename]] at cursor position.
Add checkbox sync (GFM render → click listener → update raw markdown).
Phase 4: Advanced Rendering & Block References
Integrate KaTeX auto-render in postprocess.js. Configure $ and $$ delimiters.
Initialize Mermaid for fenced code blocks.
Implement block references (^id): parse IDs, assign DOM anchors, enable click-to-scroll or embed resolution.
Optimize: Defer Mermaid/KaTeX until after DOM insertion. Add render throttling for large files.
Key Technical Decisions
Parser: markdown-it (superior plugin API and AST access vs marked).
Editor: CodeMirror 6 via ESM CDN. Fallback to native <textarea> if bandwidth constrained.
Storage: IndexedDB for reliability with large media. localStorage for UI config only.
Security: DOMPurify mandatory before any DOM injection. Sanitize after preprocess, before postprocess.
Performance: Debounced render (300-500ms). Post-processing targets only updated DOM fragments. Static constraint enforced by eliminating all network calls after initial load.
