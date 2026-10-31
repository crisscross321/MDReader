const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerFileHandlers, readDoc } = require('./fileHandlers');
const { createMenu } = require('./menu');
const settings = require('./settings');

const MD_EXT = /\.(md|markdown|mdown)$/i;

let mainWindow = null;
let pendingFiles = [];
let allowClose = false;
let rendererReady = false;
let closeRequestPending = false;

// ---- Settings: theme, rendering switches, recent files ----

function broadcastSettings() {
  rebuildMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:changed', settings.get());
  }
}

function setSetting(key, value) {
  if (!settings.set(key, value)) return;
  // The renderer follows prefers-color-scheme, which tracks themeSource.
  if (key === 'theme') nativeTheme.themeSource = value;
  broadcastSettings();
}

function rebuildMenu() {
  createMenu(settings.get(), {
    openRecent: (filePath) => openFileInRenderer(filePath),
    clearRecent: () => {
      settings.clearRecent();
      app.clearRecentDocuments();
      broadcastSettings();
    },
    setSetting,
    toggleTheme: () => setSetting('theme', nativeTheme.shouldUseDarkColors ? 'light' : 'dark'),
  });
}

ipcMain.handle('settings:get', () => settings.get());
ipcMain.on('settings:set', (_event, key, value) => setSetting(key, value));
ipcMain.on('recent:add', (_event, filePath) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return;
  settings.addRecent(filePath);
  app.addRecentDocument(filePath);
  broadcastSettings();
});

// ---- Window lifecycle ----

ipcMain.on('app:renderer-ready', () => {
  rendererReady = true;
  const queued = pendingFiles;
  pendingFiles = [];
  queued.forEach(openFileInRenderer);
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

ipcMain.on('app:set-title', (_event, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title || 'MD reader');
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
    // Match the first paint to the theme so dark mode does not flash white.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1E1E1E' : '#F5F5F5',
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const indexFile = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(indexFile);

  // The window only ever shows index.html: block navigation and popups so a
  // link that slips past the preview click handler cannot replace the app.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
    closeRequestPending = false;
  });

  mainWindow.on('close', (event) => {
    if (allowClose || !rendererReady) return;
    event.preventDefault();
    if (closeRequestPending) return;
    closeRequestPending = true;
    mainWindow.webContents.send('app:before-close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    closeRequestPending = false;
  });
}

async function openFileInRenderer(filePath) {
  if (!mainWindow || !rendererReady) {
    pendingFiles.push(filePath);
    if (!mainWindow && app.isReady()) createWindow();
    return;
  }
  const doc = await readDoc(path.resolve(filePath));
  if (doc && mainWindow) mainWindow.webContents.send('file:opened', doc);
}

app.whenReady().then(() => {
  nativeTheme.themeSource = settings.get().theme;
  createWindow();
  rebuildMenu();
  registerFileHandlers();

  // Files passed on the command line
  process.argv
    .slice(1)
    .filter((arg) => MD_EXT.test(arg) && fs.existsSync(arg))
    .forEach((arg) => pendingFiles.push(path.resolve(arg)));
});

// Finder double-click / Dock drop (macOS)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) openFileInRenderer(filePath);
  else pendingFiles.push(filePath);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
