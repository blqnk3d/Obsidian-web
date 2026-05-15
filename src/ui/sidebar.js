import { state, on, setFilename, setContent, emit } from '../core/state.js';
import { saveFile, loadFile, deleteFile, renameFile, save, nextUntitledName } from '../core/storage.js';
import { setContent as setEditorContent, focus } from './editor.js';
import { scheduleRender } from '../render/preview.js';

let sidebarEl = null;
let fileListEl = null;
let onFileSwitch = null;

export function initSidebar(container, onSwitch) {
  sidebarEl = container;
  onFileSwitch = onSwitch;

  fileListEl = document.getElementById('file-list');

  document.getElementById('new-note-btn')?.addEventListener('click', createNewNote);

  on('file-list-change', renderFileList);

  renderFileList(state.files);
}

function renderFileList(files) {
  if (!fileListEl) return;
  fileListEl.innerHTML = '';

  const sorted = [...files].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

  for (const file of sorted) {
    const item = document.createElement('div');
    item.className = 'file-item';
    if (file.name === state.filename) item.classList.add('active');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = file.name;
    nameSpan.title = file.name;

    const actions = document.createElement('span');
    actions.className = 'file-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'file-action-btn';
    renameBtn.textContent = '\u270E';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(item, file.name);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'file-action-btn';
    delBtn.textContent = '\u2716';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFileHandler(file.name);
    });

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);

    item.appendChild(nameSpan);
    item.appendChild(actions);

    item.addEventListener('click', () => switchToFile(file.name));

    fileListEl.appendChild(item);
  }
}

async function switchToFile(name) {
  if (name === state.filename) return;

  await save();
  const content = state.fileContents.get(name);
  if (content !== undefined) {
    setEditorContent(content);
    setContent(content);
  } else {
    const loaded = await loadFile(name);
    setEditorContent(loaded);
    setContent(loaded);
  }
  setFilename(name);
  scheduleRender(state.content);
  emit('file-switch', name);
  renderFileList(state.files);
  focus();
}

async function createNewNote() {
  await save();
  const name = nextUntitledName();
  state.fileContents.set(name, '');
  state.files.push({ name, updated_at: new Date().toISOString() });
  setFilename(name);
  setEditorContent('');
  setContent('');
  scheduleRender('');
  await saveFile(name, '');
  renderFileList(state.files);
  focus();
}

function startRename(item, oldName) {
  const nameSpan = item.querySelector('.file-name');
  const input = document.createElement('input');
  input.className = 'file-rename-input';
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    let newName = input.value.trim();
    if (!newName) { cancel(); return; }
    if (!newName.includes('.')) newName += '.md';
    if (newName === oldName) { cancel(); return; }
    if (state.files.find(f => f.name === newName)) { cancel(); return; }

    const wasCurrent = oldName === state.filename;
    await renameFile(oldName, newName);
    if (wasCurrent) {
      setFilename(newName);
      state.fileContents.set(newName, state.content);
    }
    renderFileList(state.files);
  };

  const cancel = () => {
    renderFileList(state.files);
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { cancel(); }
  });
}

async function deleteFileHandler(name) {
  await deleteFile(name);
  state.fileContents.delete(name);

  if (name === state.filename) {
    const remaining = [...state.files].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    const next = remaining[0];
    if (next) {
      const content = state.fileContents.get(next.name) || '';
      setEditorContent(content);
      setContent(content);
      setFilename(next.name);
      scheduleRender(state.content);
    } else {
      const newName = nextUntitledName();
      state.fileContents.set(newName, '');
      state.files.push({ name: newName, updated_at: new Date().toISOString() });
      setFilename(newName);
      setEditorContent('');
      setContent('');
      scheduleRender('');
      await saveFile(newName, '');
    }
  }
  renderFileList(state.files);
}
