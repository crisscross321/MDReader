const { ipcMain, dialog, shell, clipboard, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');

/**
 * External-change watcher.
 * Watches the parent directory instead of the file: editors such as VS Code
 * or vim save by writing a temp file and renaming it over the original,
 * which silently detaches a per-file fs.watch. Events are debounced and
 * compared against the last known (mtime, size), so a burst of events turns
 * into one notification and our own saves (recorded via markFileSaved)
 * never echo back.
 */
const files = new Map(); // filePath -> { mtimeMs, size, timer }
const dirs = new Map(); // dir -> { watcher, count }

function snapshot(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch (_) {
    return null;
  }
}

function sameName(a, b) {
  return a.normalize('NFC') === b.normalize('NFC');
}

function notifyChanged(filePath) {
  const entry = files.get(filePath);
  if (!entry) return;
  const now = snapshot(filePath);
  if (!now) return; // mid-rename or deleted; a later event will follow
  if (now.mtimeMs === entry.mtimeMs && now.size === entry.size) return;
  Object.assign(entry, now);
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('file:changed', { path: filePath });
  }
}

function onDirEvent(dir, name) {
  for (const [filePath, entry] of files) {
    if (path.dirname(filePath) !== dir) continue;
    if (name && !sameName(String(name), path.basename(filePath))) continue;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => notifyChanged(filePath), 150);
  }
}

function addFileWatcher(filePath) {
  if (!filePath || files.has(filePath)) return;
  const dir = path.dirname(filePath);
  let watched = dirs.get(dir);
  if (!watched) {
    try {
      const watcher = fs.watch(dir, { persistent: false }, (_type, name) => onDirEvent(dir, name));
      watched = { watcher, count: 0 };
      dirs.set(dir, watched);
    } catch (err) {
      console.warn('[Watcher] failed to watch:', dir, err.message);
      return;
    }
  }
  watched.count += 1;
  files.set(filePath, { ...(snapshot(filePath) || { mtimeMs: 0, size: 0 }), timer: null });
}

function removeFileWatcher(filePath) {
  const entry = files.get(filePath);
  if (!entry) return;
  clearTimeout(entry.timer);
  files.delete(filePath);
  const dir = path.dirname(filePath);
  const watched = dirs.get(dir);
  if (watched && --watched.count <= 0) {
    watched.watcher.close();
    dirs.delete(dir);
  }
}

function markFileSaved(filePath) {
  const entry = files.get(filePath);
  const now = snapshot(filePath);
  if (entry && now) Object.assign(entry, now);
}

async function readDoc(filePath) {
  try {
    // Strip BOM so Windows-generated files don't show \uFEFF
    const content = (await fs.promises.readFile(filePath, 'utf-8')).replace(/^\uFEFF/, '');
    addFileWatcher(filePath);
    return { path: filePath, content };
  } catch (err) {
    dialog.showErrorBox(t('cannotOpen'), t('failedRead', { name: path.basename(filePath), error: err.message }));
    return null;
  }
}

async function writeDoc(filePath, content) {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    addFileWatcher(filePath);
    markFileSaved(filePath);
    return { path: filePath, success: true };
  } catch (err) {
    dialog.showErrorBox(t('cannotSave'), t('failedSave', { name: path.basename(filePath), error: err.message }));
    return { success: false, error: err.message };
  }
}

// Local link targets that are safe to hand to the default app. Anything
// else (apps, scripts, installers, unknown types) is only revealed in the
// file manager, so a crafted link can never launch a program.
const OPENABLE_EXT = new Set([
  'pdf', 'txt', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic',
  'mp3', 'm4a', 'wav', 'flac', 'mp4', 'mov', 'm4v', 'webm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key', 'epub',
]);

function registerFileHandlers() {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const docs = [];
    for (const filePath of result.filePaths) {
      const doc = await readDoc(filePath);
      if (doc) docs.push(doc);
    }
    return docs.length > 0 ? docs : null;
  });

  ipcMain.handle('file:read', (_event, filePath) => readDoc(filePath));

  ipcMain.handle('file:save', (_event, filePath, content) => writeDoc(filePath, content));

  ipcMain.handle('file:save-as', async (_event, content) => {
    const result = await dialog.showSaveDialog({
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    return writeDoc(result.filePath, content);
  });

  ipcMain.handle('dialog:confirm-discard', async (_event, fileName) => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: [t('save'), t('dontSave'), t('cancel')],
      defaultId: 0,
      cancelId: 2,
      message: t('saveChanges', { name: fileName }),
      detail: t('changesLost'),
    });
    return ['save', 'discard', 'cancel'][result.response];
  });

  ipcMain.handle('dialog:confirm-reload', async (_event, fileName) => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: [t('reload'), t('keepLocal')],
      defaultId: 1,
      cancelId: 1,
      message: t('changedOnDisk', { name: fileName }),
      detail: t('modifiedOutside'),
    });
    return result.response === 0 ? 'reload' : 'keep';
  });

  ipcMain.on('shell:open-external', (_event, url) => {
    if (typeof url !== 'string' || !/^(https?:|mailto:)/i.test(url)) return;
    shell.openExternal(url).catch((err) => console.error('openExternal failed:', err));
  });

  ipcMain.on('shell:open-local', (_event, filePath) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) return;
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const isDir = fs.statSync(filePath).isDirectory();
    if (OPENABLE_EXT.has(ext) && !isDir) shell.openPath(filePath);
    else shell.showItemInFolder(filePath);
  });

  ipcMain.on('clipboard:write', (_event, text) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });

  ipcMain.on('file:watch-add', (_event, filePath) => addFileWatcher(filePath));
  ipcMain.on('file:watch-remove', (_event, filePath) => removeFileWatcher(filePath));
}

module.exports = { registerFileHandlers, readDoc };
