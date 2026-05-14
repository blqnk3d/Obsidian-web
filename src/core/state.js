const listeners = new Map();

export const state = {
  content: '',
  filename: 'untitled.md',
  images: new Map(),
  tags: new Set(),
  wikilinks: new Set(),
  metadata: { updated_at: null },
  saveStatus: 'saved',
};

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, data) {
  listeners.get(event)?.forEach(fn => fn(data));
}

export function setContent(content) {
  state.content = content;
  extractMetadata(content);
  emit('content-change', content);
}

export function setFilename(name) {
  state.filename = name;
  emit('filename-change', name);
}

export function setSaveStatus(status) {
  state.saveStatus = status;
  emit('save-status', status);
}

export function addImage(name, base64) {
  state.images.set(name, base64);
  emit('image-add', { name, base64 });
}

export function getImage(name) {
  return state.images.get(name);
}

function extractMetadata(content) {
  state.tags.clear();
  state.wikilinks.clear();

  const tagRe = /(?:^|\s)(#[^\s#]+)/g;
  let m;
  while ((m = tagRe.exec(content)) !== null) {
    state.tags.add(m[1]);
  }

  const linkRe = /\[\[([^\]]+)\]\]/g;
  while ((m = linkRe.exec(content)) !== null) {
    state.wikilinks.add(m[0]);
  }
}

export function getExportData() {
  return {
    filename: state.filename,
    content: state.content,
    images: Object.fromEntries(state.images),
    metadata: state.metadata,
    exported_at: new Date().toISOString(),
  };
}

export function loadImportData(data) {
  setFilename(data.filename || 'untitled.md');
  setContent(data.content || '');
  state.images = new Map(Object.entries(data.images || {}));
  state.metadata = data.metadata || { updated_at: null };
  emit('import', data);
}
