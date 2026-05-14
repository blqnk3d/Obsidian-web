import { init as initStorage, save } from './core/storage.js';
import { state, setContent, on } from './core/state.js';
import { initParser } from './parser/config.js';
import { initPreview, scheduleRender } from './render/preview.js';
import { initEditor, setContent as setEditorContent } from './ui/editor.js';
import { initHandlers } from './ui/handlers.js';

let saveTimer = null;
const SAVE_DEBOUNCE = 500;

async function init() {
  const editorEl = document.getElementById('editor');
  const previewEl = document.getElementById('preview');

  initParser();
  initEditor(editorEl, handleEditorChange);
  initPreview(previewEl);
  initHandlers();

  await initStorage();

  setEditorContent(state.content);
  scheduleRender(state.content);

  on('content-change', (content) => {
    scheduleRender(content);
    debounceSave();
  });

  on('filename-change', (name) => {
    document.getElementById('filename').textContent = name;
  });
}

function handleEditorChange(content) {
  setContent(content);
}

function debounceSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DEBOUNCE);
}

document.addEventListener('DOMContentLoaded', init);
