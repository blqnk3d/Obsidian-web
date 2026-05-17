import { state, setContent } from './state.js';
import { saveFile } from './storage.js';

const GIT_SETTINGS_KEY = 'obsidian-web-git-settings';
const REMOTE_SHA_KEY = 'obsidian-web-git-sha-map';

const dirtyFiles = new Set();

const PROVIDERS = {
  github: {
    label: 'GitHub',
    baseUrl: 'https://api.github.com',
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  gitlab: {
    label: 'GitLab',
    baseUrl: 'https://gitlab.com/api/v4',
    authHeader: (token) => ({ 'PRIVATE-TOKEN': token }),
  },
  gitea: {
    label: 'Gitea',
    baseUrl: '',
    authHeader: (token) => ({ Authorization: `token ${token}` }),
  },
  custom: {
    label: 'Custom',
    baseUrl: '',
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
  },
};

export function getProviderConfig(provider) {
  return PROVIDERS[provider] || PROVIDERS.github;
}

function b64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

function utf8ToB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export function getGitSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(GIT_SETTINGS_KEY));
    return {
      provider: 'github',
      host: '',
      owner: '',
      repo: '',
      token: '',
      branch: 'main',
      folder: 'notes/',
      authorName: '',
      authorEmail: '',
      autoSync: true,
      syncInterval: 600000,
      lastSyncAt: null,
      lastSyncStatus: '',
      ...stored,
    };
  } catch {
    return {
      provider: 'github',
      host: '',
      owner: '',
      repo: '',
      token: '',
      branch: 'main',
      folder: 'notes/',
      authorName: '',
      authorEmail: '',
      autoSync: true,
      syncInterval: 600000,
      lastSyncAt: null,
      lastSyncStatus: '',
    };
  }
}

export function saveGitSettings(partial) {
  const current = getGitSettings();
  const merged = { ...current, ...partial };
  localStorage.setItem(GIT_SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

export function getRemoteShaMap() {
  try {
    return JSON.parse(localStorage.getItem(REMOTE_SHA_KEY)) || {};
  } catch {
    return {};
  }
}

export function setRemoteShaMap(map) {
  localStorage.setItem(REMOTE_SHA_KEY, JSON.stringify(map));
}

export function markDirty(fileName) {
  dirtyFiles.add(fileName);
}

export function clearDirty() {
  dirtyFiles.clear();
}

export function getDirtyFiles() {
  return new Set(dirtyFiles);
}

function buildApiUrl(settings) {
  const provider = getProviderConfig(settings.provider);
  let base = provider.baseUrl;
  if (settings.provider === 'gitea' && settings.host) {
    base = `https://${settings.host}/api/v1`;
  } else if (settings.provider === 'custom' && settings.host) {
    base = settings.host;
  }
  return base.replace(/\/+$/, '');
}

function authHeaders(settings) {
  const provider = getProviderConfig(settings.provider);
  return provider.authHeader(settings.token);
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function encodeProjectPath(owner, repo) {
  return `${encodeURIComponent(owner)}%2F${encodeURIComponent(repo)}`;
}

async function apiFetch(url, settings, options = {}) {
  const headers = {
    'Accept': 'application/json',
    ...authHeaders(settings),
    ...options.headers,
  };
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${body || resp.statusText}`);
  }
  return resp.json();
}

async function listRemoteFiles(settings) {
  const base = buildApiUrl(settings);
  const folder = settings.folder.replace(/^\/+|\/+$/g, '');

  switch (settings.provider) {
    case 'gitlab': {
      const project = encodeProjectPath(settings.owner, settings.repo);
      const url = `${base}/projects/${project}/repository/tree?path=${encodeURIComponent(folder)}&ref=${encodeURIComponent(settings.branch)}&per_page=100`;
      const items = await apiFetch(url, settings);
      return items.filter(i => i.type === 'blob' && i.path.endsWith('.md')).map(i => i.path);
    }
    case 'github':
    case 'gitea':
    case 'custom':
    default: {
      const url = `${base}/repos/${settings.owner}/${settings.repo}/contents/${encodePath(folder)}?ref=${encodeURIComponent(settings.branch)}`;
      const items = await apiFetch(url, settings);
      if (!Array.isArray(items)) return [];
      return items.filter(i => i.type === 'file' && i.name.endsWith('.md')).map(i => i.name);
    }
  }
}

async function getRemoteFile(settings, path) {
  const base = buildApiUrl(settings);
  const folder = settings.folder.replace(/^\/+|\/+$/g, '');
  const fullPath = folder ? `${folder}/${path}` : path;

  switch (settings.provider) {
    case 'gitlab': {
      const project = encodeProjectPath(settings.owner, settings.repo);
      const encoded = encodeURIComponent(fullPath);
      const url = `${base}/projects/${project}/repository/files/${encoded}?ref=${encodeURIComponent(settings.branch)}`;
      const data = await apiFetch(url, settings);
      return { content: b64ToUtf8(data.content), sha: data.commit_id || data.blob_id };
    }
    case 'github':
    case 'gitea':
    case 'custom':
    default: {
      const url = `${base}/repos/${settings.owner}/${settings.repo}/contents/${encodePath(fullPath)}?ref=${encodeURIComponent(settings.branch)}`;
      const data = await apiFetch(url, settings);
      return { content: b64ToUtf8(data.content), sha: data.sha };
    }
  }
}

async function updateRemoteFile(settings, path, content, message, sha) {
  const base = buildApiUrl(settings);
  const folder = settings.folder.replace(/^\/+|\/+$/g, '');
  const fullPath = folder ? `${folder}/${path}` : path;
  const contentBase64 = utf8ToB64(content);
  const author = settings.authorName ? { name: settings.authorName, email: settings.authorEmail || '' } : undefined;

  switch (settings.provider) {
    case 'gitlab': {
      const project = encodeProjectPath(settings.owner, settings.repo);
      const encoded = encodeURIComponent(fullPath);
      const url = `${base}/projects/${project}/repository/files/${encoded}`;
      const body = {
        branch: settings.branch,
        commit_message: message,
        content: contentBase64,
        encoding: 'base64',
        author_name: author?.name,
        author_email: author?.email,
      };
      if (sha) body.previous_path = fullPath;

      const method = sha ? 'PUT' : 'POST';
      const resp = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(settings),
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`GitLab API ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      return { sha: data.commit_id || data.blob_id };
    }
    case 'github':
    case 'gitea':
    case 'custom':
    default: {
      const url = `${base}/repos/${settings.owner}/${settings.repo}/contents/${encodePath(fullPath)}`;
      const body = {
        message,
        content: contentBase64,
        branch: settings.branch,
      };
      if (sha) body.sha = sha;
      if (author) body.committer = author;

      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(settings),
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      return { sha: data.content?.sha || data.sha };
    }
  }
}

async function deleteRemoteFile(settings, path, message, sha) {
  const base = buildApiUrl(settings);
  const folder = settings.folder.replace(/^\/+|\/+$/g, '');
  const fullPath = folder ? `${folder}/${path}` : path;
  const author = settings.authorName ? { name: settings.authorName, email: settings.authorEmail || '' } : undefined;

  switch (settings.provider) {
    case 'gitlab': {
      const project = encodeProjectPath(settings.owner, settings.repo);
      const encoded = encodeURIComponent(fullPath);
      const url = `${base}/projects/${project}/repository/files/${encoded}`;
      const body = {
        branch: settings.branch,
        commit_message: message,
        author_name: author?.name,
        author_email: author?.email,
      };
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(settings),
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`GitLab API ${resp.status}: ${errText}`);
      }
      return true;
    }
    case 'github':
    case 'gitea':
    case 'custom':
    default: {
      const url = `${base}/repos/${settings.owner}/${settings.repo}/contents/${encodePath(fullPath)}`;
      const body = { message, branch: settings.branch, sha };
      if (author) body.committer = author;

      const resp = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(settings),
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API ${resp.status}: ${errText}`);
      }
      return true;
    }
  }
}

export async function testGitConnection() {
  const settings = getGitSettings();
  if (!settings.owner || !settings.repo || !settings.token) {
    throw new Error('Owner, repo, and token are required');
  }
  const base = buildApiUrl(settings);
  switch (settings.provider) {
    case 'gitlab': {
      const project = encodeProjectPath(settings.owner, settings.repo);
      await apiFetch(`${base}/projects/${project}`, settings);
      break;
    }
    case 'github':
    case 'gitea':
    case 'custom':
    default: {
      await apiFetch(`${base}/repos/${settings.owner}/${settings.repo}`, settings);
      break;
    }
  }
  return true;
}

export async function pullFromRemote(onProgress) {
  const settings = getGitSettings();
  if (!settings.owner || !settings.repo || !settings.token) {
    throw new Error('Configure Git settings first');
  }

  onProgress?.('Listing remote files...');
  const remoteFiles = await listRemoteFiles(settings);
  const shaMap = getRemoteShaMap();
  const newShaMap = {};
  let synced = 0;

  for (const fileName of remoteFiles) {
    onProgress?.(`Pulling ${fileName}...`);
    const { content, sha } = await getRemoteFile(settings, fileName);
    newShaMap[fileName] = sha;

    const existing = state.fileContents.get(fileName);
    if (existing !== content) {
      await saveFile(fileName, content);
      if (fileName === state.filename) {
        setContent(content);
      }
    }
    synced++;
  }

  setRemoteShaMap(newShaMap);
  saveGitSettings({
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: `Pulled ${synced} files`,
  });

  return { synced, files: remoteFiles };
}

export async function pushToRemote(onProgress, filesToPush) {
  const settings = getGitSettings();
  if (!settings.owner || !settings.repo || !settings.token) {
    throw new Error('Configure Git settings first');
  }

  const shaMap = getRemoteShaMap();
  const newShaMap = { ...shaMap };
  let pushed = 0;

  let files;
  if (filesToPush) {
    files = filesToPush.filter(f => state.fileContents.has(f)).map(f => [f, state.fileContents.get(f)]);
  } else {
    files = [...state.fileContents.entries()];
  }

  onProgress?.(`Pushing ${files.length} files...`);

  for (const [fileName, content] of files) {
    onProgress?.(`Pushing ${fileName}...`);
    const sha = shaMap[fileName] || null;
    const message = sha ? `Update ${fileName}` : `Add ${fileName}`;
    const result = await updateRemoteFile(settings, fileName, content, message, sha);
    newShaMap[fileName] = result.sha;
    pushed++;
  }

  if (!filesToPush) {
    for (const fileName of Object.keys(shaMap)) {
      if (!state.fileContents.has(fileName)) {
        onProgress?.(`Deleting ${fileName}...`);
        await deleteRemoteFile(settings, fileName, `Delete ${fileName}`, shaMap[fileName]);
        delete newShaMap[fileName];
      }
    }
  }

  setRemoteShaMap(newShaMap);
  clearDirty();
  saveGitSettings({
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: `Pushed ${pushed} files`,
  });

  return { pushed };
}
