const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerFileHandlers } = require('./fileHandlers');
const { createMenu } = require('./menu');

let mainWindow = null;
let pendingFilePath = null;

function createWindow() {
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
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingFilePath) {
      openFileInRenderer(pendingFilePath);
      pendingFilePath = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openFileInRenderer(filePath) {
  if (!mainWindow) return;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.webContents.send('file:opened', { path: filePath, content });
    mainWindow.setTitle(path.basename(filePath) + ' - MD reader');
  } catch (err) {
    console.error('Failed to read file:', err);
  }
}

app.whenReady().then(() => {
  createWindow();
  createMenu(mainWindow);
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
  if (mainWindow && mainWindow.webContents) {
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
