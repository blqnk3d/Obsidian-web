let textarea = null;
let changeCallback = null;

export function initEditor(el, onChange) {
  textarea = el;
  changeCallback = onChange;

  textarea.addEventListener('input', () => {
    if (changeCallback) changeCallback(textarea.value);
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

export function focus() {
  textarea?.focus();
}
