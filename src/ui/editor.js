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

export function wrapSelection(before, after) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  if (selected) {
    textarea.value = textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end);
    textarea.setSelectionRange(start + before.length, end + before.length);
  } else {
    textarea.value = textarea.value.slice(0, start) + before + after + textarea.value.slice(end);
    textarea.setSelectionRange(start + before.length, start + before.length);
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function insertLinePrefix(prefix) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
  textarea.value = textarea.value.slice(0, lineStart) + prefix + textarea.value.slice(lineStart);
  textarea.setSelectionRange(start + prefix.length, start + prefix.length);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
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
