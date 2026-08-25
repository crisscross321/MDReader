const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Watcher registry — notifies renderer when an open file changes on disk.
 * Saves performed by the app itself are suppressed via lastSavedAt.
 */
const watchers = new Map(); // filePath -> { watcher, lastSavedAt }

function addFileWatcher(filePath) {
  if (!filePath || watchers.has(filePath)) return;
  try {
    const watcher = fs.watch(filePath, { persistent: false }, () => {
      const entry = watchers.get(filePath);
      if (!entry) return;
      // Ignore changes caused by our own save
      try {
        const stat = fs.statSync(filePath);
        if (entry.lastSavedAt && stat.mtimeMs - entry.lastSavedAt < 800) return;
      } catch (_) {
        return; // file missing — ignore
      }
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('file:changed', { path: filePath });
      }
    });
    watchers.set(filePath, { watcher, lastSavedAt: 0 });
  } catch (err) {
    console.warn('[Watcher] failed to watch:', filePath, err.message);
  }
}

function removeFileWatcher(filePath) {
  const entry = watchers.get(filePath);
  if (!entry) return;
  try {
    entry.watcher.close();
  } catch (_) {
    /* ignore */
  }
  watchers.delete(filePath);
}

function markFileSaved(filePath) {
  const entry = watchers.get(filePath);
  if (!entry) return;
  try {
    entry.lastSavedAt = fs.statSync(filePath).mtimeMs;
  } catch (_) {
    entry.lastSavedAt = Date.now();
  }
}

function stripBom(content) {
  return content.replace(/^\uFEFF/, '');
}

function registerFileHandlers() {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const docs = [];
    for (const filePath of result.filePaths) {
      try {
        const content = stripBom(await fs.promises.readFile(filePath, 'utf-8'));
        docs.push({ path: filePath, content });
        addFileWatcher(filePath);
      } catch (err) {
        console.error('Open failed:', err);
        dialog.showErrorBox(
          'Cannot open file',
          `Failed to read ${path.basename(filePath)}:\n${err.message}`
        );
      }
    }
    return docs.length > 0 ? docs : null;
  });

  ipcMain.handle('file:save', async (_event, filePath, content) => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      markFileSaved(filePath);
      return { success: true };
    } catch (err) {
      console.error('Save failed:', err);
      dialog.showErrorBox(
        'Cannot save file',
        `Failed to save ${path.basename(filePath)}:\n${err.message}`
      );
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
      addFileWatcher(result.filePath);
      markFileSaved(result.filePath);
      return { path: result.filePath, success: true };
    } catch (err) {
      console.error('Save As failed:', err);
      dialog.showErrorBox(
        'Cannot save file',
        `Failed to save ${path.basename(result.filePath)}:\n${err.message}`
      );
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:read', async (_event, filePath) => {
    try {
      const content = stripBom(await fs.promises.readFile(filePath, 'utf-8'));
      addFileWatcher(filePath);
      return { path: filePath, content };
    } catch (err) {
      console.error('Read failed:', err);
      dialog.showErrorBox(
        'Cannot open file',
        `Failed to read ${path.basename(filePath)}:\n${err.message}`
      );
      return null;
    }
  });

  ipcMain.handle('dialog:confirm-discard', async (_event, fileName) => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Save', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Save changes to "${fileName}"?`,
      detail: 'Your changes will be lost if you don\'t save them.',
    });
    if (result.response === 0) return 'save';
    if (result.response === 1) return 'discard';
    return 'cancel';
  });

  ipcMain.handle('dialog:confirm-reload', async (_event, fileName) => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Reload from disk', 'Keep local changes'],
      defaultId: 1,
      cancelId: 1,
      message: `"${fileName}" was changed on disk`,
      detail: 'The file has been modified outside of MD reader.',
    });
    return result.response === 0 ? 'reload' : 'keep';
  });

  ipcMain.handle('shell:open-external', async (_event, url) => {
    if (typeof url !== 'string') return;
    // Only allow web links and local files
    if (!/^(https?|file):/i.test(url)) return;
    try {
      await shell.openExternal(url);
    } catch (err) {
      console.error('openExternal failed:', err);
    }
  });

  ipcMain.on('file:watch-add', (_event, filePath) => addFileWatcher(filePath));
  ipcMain.on('file:watch-remove', (_event, filePath) => removeFileWatcher(filePath));
}

module.exports = { registerFileHandlers, addFileWatcher, removeFileWatcher };
