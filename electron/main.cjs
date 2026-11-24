// Electron desktop shell for Nexora POS: native window + SQLite database on disk.
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const { PosDatabase } = require('./db.cjs');

let db;
let win;

function dataDir() {
  return app.getPath('userData'); // e.g. C:\Users\<you>\AppData\Roaming\Nexora POS
}

async function createWindow() {
  const file = path.join(dataDir(), 'nexora.db');
  db = await PosDatabase.open(file);
  db.dailyBackup(path.join(dataDir(), 'backups'));

  win = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1000,
    minHeight: 650,
    title: 'Nexora POS',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#121a2c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.maximize();

  // Links that open new windows go to the normal browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_SERVER_URL) await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('db:load', () => db.load());
ipcMain.handle('db:save', (_e, state) => {
  db.save(state);
  return true;
});
// Synchronous save used when the window is closing so nothing is lost.
ipcMain.on('db:saveSync', (e, state) => {
  try {
    db.save(state);
    e.returnValue = true;
  } catch (err) {
    console.error(err);
    e.returnValue = false;
  }
});
ipcMain.handle('db:info', () => ({ path: db.file, backups: path.join(dataDir(), 'backups') }));
ipcMain.handle('db:openFolder', () => shell.openPath(dataDir()));
// How an AI assistant (Claude Desktop etc.) should launch the read-only MCP connector on this PC.
ipcMain.handle('mcp:config', () => ({
  command: process.execPath,
  args: [path.join(app.getAppPath(), 'mcp', 'server.mjs'), db.file],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}));

Menu.setApplicationMenu(null);

// Only one copy of the till app at a time (prevents two windows writing the same database).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => {
    db?.close();
    app.quit();
  });
}
