const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerFileHandlers, addFileWatcher } = require('./fileHandlers');
const { createMenu } = require('./menu');

let mainWindow = null;
let pendingFilePath = null;
let allowClose = false;
let rendererReady = false;
let closeRequestPending = false;

ipcMain.on('app:renderer-ready', () => {
  rendererReady = true;
});

ipcMain.on('app:close-cancelled', () => {
  closeRequestPending = false;
});

// Renderer signals it's safe to close (after dirty-check)
ipcMain.on('app:close-confirmed', () => {
  if (mainWindow) {
    allowClose = true;
    closeRequestPending = false;
    mainWindow.close();
  }
});

// Renderer asks to open a local file (relative link click in preview)
ipcMain.on('file:open-path', (_event, filePath) => {
  if (filePath && mainWindow) {
    openFileInRenderer(filePath);
  }
});

// Renderer asks to sync the window title (dirty marker etc.)
ipcMain.on('app:set-title', (_event, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title ? title : 'MD reader');
  }
});

function createWindow() {
  allowClose = false;
  rendererReady = false;
  closeRequestPending = false;
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 13 },
    backgroundColor: '#F5F5F5',
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      // 安全基线：renderer 无 Node、上下文隔离；preload 需要 path/url 做路径解析，故 sandbox 关闭，
      // 隔离由 contextIsolation + CSP 双重保证（renderer 永远拿不到 preload 作用域内的 require）
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
    closeRequestPending = false;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingFilePath) {
      openFileInRenderer(pendingFilePath);
      pendingFilePath = null;
    }
  });

  mainWindow.on('close', (event) => {
    if (allowClose) return;

    if (!rendererReady) {
      allowClose = true;
      return;
    }

    event.preventDefault();

    if (closeRequestPending) {
      return;
    }

    closeRequestPending = true;
    mainWindow.webContents.send('app:before-close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    closeRequestPending = false;
  });
}

function openFileInRenderer(filePath) {
  if (!mainWindow) return;
  const resolved = path.resolve(filePath);
  try {
    // Strip BOM so Windows-generated files don't show \uFEFF
    const content = fs.readFileSync(resolved, 'utf-8').replace(/^\uFEFF/, '');
    mainWindow.webContents.send('file:opened', { path: resolved, content });
    mainWindow.setTitle(path.basename(resolved) + ' - MD reader');
    addFileWatcher(resolved);
    app.addRecentDocument(resolved);
  } catch (err) {
    console.error('Failed to read file:', err);
    dialog.showErrorBox(
      'Cannot open file',
      `Failed to read ${path.basename(resolved)}:\n${err.message}`
    );
  }
}

app.whenReady().then(() => {
  createWindow();
  createMenu();
  registerFileHandlers();

  // Handle file opened via CLI args
  const fileArg = process.argv.find(
    (arg) => arg.endsWith('.md') || arg.endsWith('.markdown')
  );
  if (fileArg && fs.existsSync(fileArg)) {
    pendingFilePath = path.resolve(fileArg);
  }
});

// Handle file opened via Finder double-click
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  // If window is still loading, defer via pendingFilePath instead of
  // sending IPC into a not-yet-initialized renderer
  if (
    mainWindow &&
    mainWindow.webContents &&
    !mainWindow.webContents.isLoading() &&
    mainWindow.webContents.getURL()
  ) {
    openFileInRenderer(filePath);
  } else {
    pendingFilePath = filePath;
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Export for menu.js to use
module.exports = { getMainWindow: () => mainWindow, openFileInRenderer };
