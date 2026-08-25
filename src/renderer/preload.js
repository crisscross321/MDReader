const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * MD reader — Preload (contextBridge)
 * Renderer 处于 contextIsolation + sandbox 环境，只能通过这里暴露的白名单 API
 * 访问主进程能力。禁止暴露任意 require / Node 全局。
 */

function resolveFileUrl(docPath, relative) {
  if (!docPath || !relative) return null;
  // 去掉 query / hash 后取纯路径
  const clean = relative.split('?')[0].split('#')[0];
  if (!clean) return null;
  try {
    const absolute = path.resolve(path.dirname(docPath), clean);
    const url = pathToFileURL(absolute).href;
    // 保留锚点（如 ./a.md#section）
    const hashIndex = relative.indexOf('#');
    return {
      url: hashIndex >= 0 ? url + relative.slice(hashIndex) : url,
      path: absolute,
    };
  } catch (_) {
    return null;
  }
}

function basename(filePath) {
  try {
    return path.basename(filePath || '');
  } catch (_) {
    return filePath || '';
  }
}

contextBridge.exposeInMainWorld('mdReader', {
  // ---- File ops ----
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', filePath, content),
  saveFileAs: (content) => ipcRenderer.invoke('file:save-as', content),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  openLocalFile: (filePath) => ipcRenderer.send('file:open-path', filePath),

  // ---- Dialogs ----
  confirmDiscard: (fileName) => ipcRenderer.invoke('dialog:confirm-discard', fileName),
  confirmReload: (fileName) => ipcRenderer.invoke('dialog:confirm-reload', fileName),

  // ---- Close handshake ----
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  cancelClose: () => ipcRenderer.send('app:close-cancelled'),
  notifyRendererReady: () => ipcRenderer.send('app:renderer-ready'),

  // ---- Window / shell ----
  setWindowTitle: (title) => ipcRenderer.send('app:set-title', title),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // ---- Path helpers ----
  basename,
  resolveFileUrl,

  // ---- Watcher ----
  watchFile: (filePath) => ipcRenderer.send('file:watch-add', filePath),
  unwatchFile: (filePath) => ipcRenderer.send('file:watch-remove', filePath),

  // ---- Events (返回 undefined；回调由 renderer 侧自行持有) ----
  onBeforeClose: (callback) => {
    ipcRenderer.on('app:before-close', () => callback());
  },
  onFileOpened: (callback) => {
    ipcRenderer.on('file:opened', (_event, data) => callback(data));
  },
  onFileChanged: (callback) => {
    ipcRenderer.on('file:changed', (_event, data) => callback(data));
  },
  onMenuAction: (callback) => {
    ipcRenderer.on('menu:action', (_event, data) => callback(data));
  },
});
