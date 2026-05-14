import MarkdownIt from 'markdown-it';
import { preprocess } from './preprocess.js';
import { calloutsPlugin } from './plugins/callouts.js';

let md = null;

export function initParser() {
  md = MarkdownIt({
    html: true,
    xhtmlOut: false,
    breaks: true,
    linkify: true,
    typographer: true,
  });

  md.use(calloutsPlugin);
}

export function parse(text) {
  const processed = preprocess(text);
  return md.render(processed);
}
