import DOMPurify from 'dompurify';
import { parse } from '../parser/config.js';
import { postprocess } from './postprocess.js';

let previewEl = null;
let debounceTimer = null;
const DEBOUNCE_MS = 400;

export function initPreview(containerEl) {
  previewEl = containerEl;
}

export function scheduleRender(content) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => render(content), DEBOUNCE_MS);
}

export function render(content) {
  if (!previewEl) return;

  const rawHtml = parse(content);
  const clean = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1','h2','h3','h4','h5','h6','p','br','hr',
      'ul','ol','li','dl','dt','dd',
      'table','thead','tbody','tr','th','td',
      'blockquote','pre','code','span','div',
      'a','img','strong','em','del','ins','sub','sup',
      'mark','abbr','address','input',
    ],
    ALLOWED_ATTR: [
      'href','src','alt','title','class','id','data-wikilink',
      'width','height','target','rel','type','checked','disabled',
    ],
    ALLOW_DATA_ATTR: true,
  });

  previewEl.innerHTML = clean;
  postprocess(previewEl);
}
