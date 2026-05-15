import { getImage } from '../core/state.js';

const HIGHLIGHT_RE = /==([^=]+)==/g;
const TAG_RE = /(?:^|\s)(#[^\s#!@$%^&*(),.?":{}|<>]+)/g;
const WIKILINK_RE = /(?<!!)\[\[([^\]]+)\]\]/g;
const EMBED_IMAGE_RE = /!\[\[([^\]]+)\]\]/gi;
const CALLOUT_LINE_RE = /^>\s*\[!(\w+)\]\s*(.*)$/;
const PAGEBREAK_RE = /^\{pagebreak\}\s*$/gm;

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
    const dims = parts[1] || '';
    const data = getImage(name);
    if (data) {
      let dimAttrs = '';
      if (dims.includes('x')) {
        const [w, h] = dims.split('x');
        if (w) dimAttrs += ` width="${w}"`;
        if (h) dimAttrs += ` height="${h}"`;
      } else if (dims) {
        dimAttrs = ` width="${dims}"`;
      }
      return `<img src="${data}" alt="${name}" class="embed-image"${dimAttrs}>`;
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

export function preprocess(text) {
  let result = text;
  result = preprocessHighlights(result);
  result = preprocessTags(result);
  result = preprocessImages(result);
  result = preprocessCallouts(result);
  result = preprocessWikilinks(result);
  result = preprocessPagebreaks(result);
  return result;
}
