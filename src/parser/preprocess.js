import { getImage } from '../core/state.js';

const HIGHLIGHT_RE = /==([^=]+)==/g;
const TAG_RE = /(?:^|\s)(#[^\s#!@$%^&*(),.?":{}|<>]+)/g;
const WIKILINK_RE = /(?<!!)\[\[([^\]]+)\]\]/g;
const EMBED_IMAGE_RE = /!\[\[([^\]]+)\]\]/gi;
const CALLOUT_LINE_RE = /^>\s*\[!(\w+)\]\s*(.*)$/;
const PAGEBREAK_RE = /^\{pagebreak\}\s*$/gm;
const TOC_RE = /^\{toc(?::(\d+))?\}\s*$/gm;

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function preprocessHighlights(text) {
  return text.replace(HIGHLIGHT_RE, '<mark class="highlight">$1</mark>');
}

function preprocessTags(text) {
  return text.replace(TAG_RE, (match, tag) => {
    const prefix = match.startsWith(' ') ? ' ' : '';
    return `${prefix}<span class="tag">${tag}</span>`;
  });
}

function preprocessWikilinks(text) {
  return text.replace(WIKILINK_RE, '<a href="#" data-wikilink="$1">$1</a>');
}

function preprocessImages(text) {
  return text.replace(EMBED_IMAGE_RE, (match, inner) => {
    const parts = inner.split('|');
    const name = parts[0];
    let caption = '';
    let dims = '';
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i].trim();
      if (/^\d+$/.test(p) || /^\d+x\d+$/.test(p)) {
        dims = p;
      } else if (p) {
        caption = p;
      }
    }
    const data = getImage(name);
    if (data) {
      let attrs = '';
      if (dims.includes('x')) {
        const [w, h] = dims.split('x');
        if (w) attrs += ` width="${w}"`;
        if (h) attrs += ` height="${h}"`;
      } else if (dims) {
        attrs += ` width="${dims}"`;
      }
      if (caption) attrs += ` data-caption="${escapeAttr(caption)}"`;
      return `<img src="${data}" alt="${name}" class="embed-image"${attrs}>`;
    }
    return `<span class="missing-embed" title="Image not found: ${name}">${match}</span>`;
  });
}

function preprocessCallouts(text) {
  const lines = text.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(CALLOUT_LINE_RE);

    if (match) {
      const type = match[1].toLowerCase();
      const rawTitle = match[2] || type;
      const title = escapeAttr(rawTitle);

      result.push(`> <span class="callout-marker" data-callout-type="${type}" data-callout-title="${title}"></span>`);
      i++;

      while (i < lines.length) {
        const next = lines[i];
        if (next.startsWith('> ')) {
          result.push(next);
          i++;
        } else if (next === '>') {
          result.push('');
          i++;
        } else {
          break;
        }
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

function preprocessPagebreaks(text) {
  return text.replace(PAGEBREAK_RE, '<div class="page-break"></div>');
}

function preprocessToc(text) {
  return text.replace(TOC_RE, (match, depth) => {
    return `<nav class="toc" data-depth="${depth || ''}"></nav>`;
  });
}

export function preprocess(text) {
  let result = text;
  result = preprocessHighlights(result);
  result = preprocessTags(result);
  result = preprocessImages(result);
  result = preprocessCallouts(result);
  result = preprocessWikilinks(result);
  result = preprocessPagebreaks(result);
  result = preprocessToc(result);
  return result;
}
