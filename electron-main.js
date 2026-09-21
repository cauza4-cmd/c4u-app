const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function prepareWritableData() {
  const base = app.getPath('userData');
  const dataDir = path.join(base, 'data');
  const backupDir = path.join(base, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const dbPath = path.join(dataDir, 'db.json');
  if (!fs.existsSync(dbPath)) {
    const seed = path.join(__dirname, 'data', 'db.json');
    if (fs.existsSync(seed)) fs.copyFileSync(seed, dbPath);
  }

  process.env.C4U_DATA_DIR = dataDir;
  process.env.C4U_BACKUP_DIR = backupDir;
  process.env.HOST = '127.0.0.1';
  process.env.PORT = process.env.PORT || '3000';
}

async function createWindow() {
  prepareWritableData();
  require('./server.js');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f3fb',
    icon: path.join(__dirname, 'public', '4z-system-logo.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  let attempts = 0;
  const load = async () => {
    try {
      await mainWindow.loadURL(`http://127.0.0.1:${process.env.PORT}`);
    } catch (err) {
      attempts += 1;
      if (attempts < 20) return setTimeout(load, 300);
      dialog.showErrorBox('C4U APP', 'Não foi possível iniciar o servidor local do C4U.');
    }
  };
  setTimeout(load, 300);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
