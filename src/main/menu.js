const { Menu, app, BrowserWindow } = require('electron');
const path = require('path');
const { t } = require('./i18n');

function sendMenuAction(action, payload) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('menu:action', { action, payload });
  }
}

/**
 * Build (or rebuild) the application menu from the current settings.
 * @param {object} settings - see settings.js
 * @param {{openRecent: Function, clearRecent: Function, setSetting: Function, toggleTheme: Function}} handlers
 */
function createMenu(settings, handlers) {
  const recentItems = settings.recent.length
    ? [
        ...settings.recent.map((filePath) => ({
          label: path.basename(filePath),
          sublabel: path.dirname(filePath),
          click: () => handlers.openRecent(filePath),
        })),
        { type: 'separator' },
        { label: t('clearRecent'), click: handlers.clearRecent },
      ]
    : [{ label: t('clearRecent'), enabled: false }];

  const themeItem = (value, key) => ({
    label: t(key),
    type: 'radio',
    checked: settings.theme === value,
    click: () => handlers.setSetting('theme', value),
  });

  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about', label: t('about') },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: t('file'),
      submenu: [
        { label: t('new'), accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new') },
        { label: t('open'), accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open') },
        { label: t('openRecent'), submenu: recentItems },
        { type: 'separator' },
        { label: t('save'), accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
        { label: t('saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('save-as') },
        { type: 'separator' },
        { label: t('closeDocument'), accelerator: 'CmdOrCtrl+W', click: () => sendMenuAction('close-document') },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: t('edit'),
      submenu: [
        { role: 'undo', label: t('undo') },
        { role: 'redo', label: t('redo') },
        { type: 'separator' },
        { role: 'cut', label: t('cut') },
        { role: 'copy', label: t('copy') },
        { role: 'paste', label: t('paste') },
        { role: 'selectAll', label: t('selectAll') },
      ],
    },
    {
      label: t('view'),
      submenu: [
        { label: t('toggleSidebar'), accelerator: 'CmdOrCtrl+B', click: () => sendMenuAction('toggle-sidebar') },
        { label: t('toggleOutline'), accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenuAction('toggle-outline') },
        { label: t('toggleEditMode'), accelerator: 'CmdOrCtrl+E', click: () => sendMenuAction('toggle-mode') },
        { type: 'separator' },
        { label: t('toggleTheme'), accelerator: 'CmdOrCtrl+Shift+T', click: handlers.toggleTheme },
        {
          label: t('theme'),
          submenu: [themeItem('system', 'themeSystem'), themeItem('light', 'themeLight'), themeItem('dark', 'themeDark')],
        },
        {
          label: t('rendering'),
          submenu: [
            {
              label: t('breaks'),
              type: 'checkbox',
              checked: settings.breaks,
              click: (item) => handlers.setSetting('breaks', item.checked),
            },
            {
              label: t('typographer'),
              type: 'checkbox',
              checked: settings.typographer,
              click: (item) => handlers.setSetting('typographer', item.checked),
            },
          ],
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: t('window'),
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { createMenu };
