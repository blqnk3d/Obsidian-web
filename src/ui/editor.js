const CURSOR = '{cursor}';

export const SNIPPET_TEMPLATES = {
  'code': '```\n{cursor}\n```',
  'code-js': '```javascript\n{cursor}\n```',
  'code-py': '```python\n{cursor}\n```',
  'code-bash': '```bash\n{cursor}\n```',
  'code-html': '```html\n{cursor}\n```',
  'callout': '> [!NOTE]\n> {cursor}',
  'mermaid': '```mermaid\n{cursor}\n```',
  'latex': '$$\n{cursor}\n$$',
  'img': '![[{cursor}]]',
  'img-embed': '![[{cursor}]]',
  'link': '[{cursor}](url)',
  'todo': '- [ ] {cursor}',
  'pagebreak': '{pagebreak}',
};

const TAB_SNIPPETS = {
  table: () => insertTable(4, 4),
  code: () => insertTemplate(SNIPPET_TEMPLATES['code']),
  callout: () => insertTemplate(SNIPPET_TEMPLATES['callout']),
  mermaid: () => insertTemplate(SNIPPET_TEMPLATES['mermaid']),
  img: () => insertTemplate(SNIPPET_TEMPLATES['img']),
  link: () => insertTemplate(SNIPPET_TEMPLATES['link']),
  todo: () => insertTemplate(SNIPPET_TEMPLATES['todo']),
  latex: () => insertTemplate(SNIPPET_TEMPLATES['latex']),
};

let textarea = null;
let changeCallback = null;

export function initEditor(el, onChange) {
  textarea = el;
  changeCallback = onChange;

  textarea.addEventListener('input', () => {
    if (changeCallback) changeCallback(textarea.value);
  });

  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'b': e.preventDefault(); wrapSelection('**', '**'); return;
        case 'i': e.preventDefault(); wrapSelection('*', '*'); return;
        case 'h': e.preventDefault(); wrapSelection('==', '=='); return;
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const value = textarea.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const beforeCursor = value.slice(lineStart, start);
      const word = beforeCursor.trim();
      if (word && TAB_SNIPPETS[word]) {
        textarea.value = value.slice(0, lineStart) + value.slice(start);
        textarea.selectionStart = textarea.selectionEnd = lineStart;
        TAB_SNIPPETS[word]();
      } else {
        insertAtCursor('    ');
      }
    }
  });
}

export function getContent() {
  return textarea ? textarea.value : '';
}

export function setContent(text) {
  if (!textarea) return;
  textarea.value = text;
}

export function insertAtCursor(text) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + text + after;
  const newPos = start + text.length;
  textarea.setSelectionRange(newPos, newPos);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function wrapSelection(before, after) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);

  if (!selected) {
    textarea.value = textarea.value.slice(0, start) + before + after + textarea.value.slice(end);
    textarea.setSelectionRange(start + before.length, start + before.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const firstNonWS = selected.search(/\S/);
  if (firstNonWS === -1) {
    textarea.value = textarea.value.slice(0, start) + before + after + textarea.value.slice(end);
    textarea.setSelectionRange(start + before.length, start + before.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  let lastNonWS = -1;
  for (let i = selected.length - 1; i >= 0; i--) {
    const c = selected[i];
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
      lastNonWS = i;
      break;
    }
  }

  const leading = selected.slice(0, firstNonWS);
  const middle = selected.slice(firstNonWS, lastNonWS + 1);
  const trailing = selected.slice(lastNonWS + 1);

  textarea.value = textarea.value.slice(0, start) + leading + before + middle + after + trailing + textarea.value.slice(end);
  textarea.setSelectionRange(
    start + leading.length + before.length,
    start + leading.length + before.length + middle.length
  );
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function insertLinePrefix(prefix) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;

  if (start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    textarea.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const firstLineStart = value.lastIndexOf('\n', start - 1) + 1;

  const lastSelectedChar = Math.max(0, end - 1);
  const lastLineStart = value.lastIndexOf('\n', lastSelectedChar - 1) + 1;

  let lastLineEnd = value.indexOf('\n', lastLineStart);
  if (lastLineEnd === -1) lastLineEnd = value.length;

  const block = value.slice(firstLineStart, lastLineEnd);
  const lines = block.split('\n');
  const prefixed = lines.map(l => prefix + l).join('\n');

  textarea.value = value.slice(0, firstLineStart) + prefixed + value.slice(lastLineEnd);
  const lineCount = lines.length;
  textarea.setSelectionRange(start + prefix.length, end + prefix.length * lineCount);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function insertTemplate(text) {
  if (!textarea) return;
  const idx = text.indexOf(CURSOR);
  const clean = idx !== -1 ? text.replace(CURSOR, '') : text;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, start) + clean + textarea.value.slice(end);
  const newPos = idx !== -1 ? start + idx : start + clean.length;
  textarea.setSelectionRange(newPos, newPos);
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function insertTable(rows, cols) {
  if (!textarea) return;
  const headerCells = Array(cols).fill(' ');
  headerCells[0] = '{cursor}';
  const header = '| ' + headerCells.join(' | ') + ' |';
  const sep = '| ' + Array(cols).fill('---').join(' | ') + ' |';
  const body = Array.from({ length: rows }, () => '| ' + Array(cols).fill(' ').join(' | ') + ' |');
  insertTemplate([header, sep, ...body].join('\n'));
}

export function focus() {
  textarea?.focus();
}

export function searchAndJump(query) {
  if (!textarea || !query) return;
  const idx = textarea.value.indexOf(query);
  if (idx === -1) return false;
  textarea.focus();
  textarea.setSelectionRange(idx, idx + query.length);
  textarea.scrollTop = (idx / textarea.value.length) * textarea.scrollHeight;
  return true;
}
