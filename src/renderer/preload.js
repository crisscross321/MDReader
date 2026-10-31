const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * MD reader — Preload (contextBridge, sandboxed)
 * Renderer runs with contextIsolation + sandbox; this whitelist is its only
 * route to main-process capabilities. Path helpers use the WHATWG URL API so
 * the preload needs no Node modules.
 */

function toFileUrl(filePath) {
  let p = String(filePath).replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(p)) p = '/' + p; // Windows drive path
  const encoded = p
    .split('/')
    .map((seg) => (/^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  return 'file://' + encoded;
}

function fromFileUrl(url) {
  let p = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
  return p;
}

/**
 * Resolve a link/image target (as written in, or percent-encoded by, the
 * Markdown) against the document's directory.
 * @returns {{url: string, path: string, hash: string} | null}
 */
function resolveFileUrl(docPath, target) {
  if (!docPath || !target) return null;
  try {
    const url = new URL(target, toFileUrl(docPath));
    if (url.protocol !== 'file:') return null;
    return { url: url.href, path: fromFileUrl(url), hash: url.hash.slice(1) };
  } catch (_) {
    return null;
  }
}

function basename(filePath) {
  return String(filePath || '').split(/[\\/]/).pop();
}

function on(channel, callback) {
  ipcRenderer.on(channel, (_event, data) => callback(data));
}

contextBridge.exposeInMainWorld('mdReader', {
  platform: process.platform,

  // ---- File ops ----
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', filePath, content),
  saveFileAs: (content) => ipcRenderer.invoke('file:save-as', content),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),

  // ---- Dialogs ----
  confirmDiscard: (fileName) => ipcRenderer.invoke('dialog:confirm-discard', fileName),
  confirmReload: (fileName) => ipcRenderer.invoke('dialog:confirm-reload', fileName),

  // ---- Close handshake ----
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  cancelClose: () => ipcRenderer.send('app:close-cancelled'),
  notifyRendererReady: () => ipcRenderer.send('app:renderer-ready'),

  // ---- Window / shell ----
  setWindowTitle: (title) => ipcRenderer.send('app:set-title', title),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  openLocalPath: (filePath) => ipcRenderer.send('shell:open-local', filePath),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),

  // ---- Settings / recent files ----
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.send('settings:set', key, value),
  addRecent: (filePath) => ipcRenderer.send('recent:add', filePath),

  // ---- Path helpers ----
  basename,
  resolveFileUrl,
  // File.path was removed in Electron 32; dropped files need webUtils.
  pathForFile: (file) => webUtils.getPathForFile(file),

  // ---- Watcher ----
  watchFile: (filePath) => ipcRenderer.send('file:watch-add', filePath),
  unwatchFile: (filePath) => ipcRenderer.send('file:watch-remove', filePath),

  // ---- Events ----
  onBeforeClose: (callback) => on('app:before-close', callback),
  onFileOpened: (callback) => on('file:opened', callback),
  onFileChanged: (callback) => on('file:changed', callback),
  onMenuAction: (callback) => on('menu:action', callback),
  onSettingsChanged: (callback) => on('settings:changed', callback),
});
