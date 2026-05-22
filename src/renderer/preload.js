const { ipcRenderer } = require('electron');

// Expose IPC API to renderer
window.mdReader = {
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (filePath, content) =>
    ipcRenderer.invoke('file:save', filePath, content),
  saveFileAs: (content) => ipcRenderer.invoke('file:save-as', content),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),

  onFileOpened: (callback) => {
    ipcRenderer.on('file:opened', (_event, data) => callback(data));
  },
  onMenuAction: (callback) => {
    ipcRenderer.on('menu:action', (_event, action) => callback(action));
  },
};
