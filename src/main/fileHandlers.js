const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function registerFileHandlers() {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { path: filePath, content };
  });

  ipcMain.handle('file:save', async (_event, filePath, content) => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      console.error('Save failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:save-as', async (_event, content) => {
    const result = await dialog.showSaveDialog({
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled) return null;

    try {
      await fs.promises.writeFile(result.filePath, content, 'utf-8');
      return { path: result.filePath, success: true };
    } catch (err) {
      console.error('Save As failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:read', async (_event, filePath) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { path: filePath, content };
    } catch (err) {
      console.error('Read failed:', err);
      return null;
    }
  });
}

module.exports = { registerFileHandlers };
