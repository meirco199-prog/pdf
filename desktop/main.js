// Electron main process for "עורך PDF" desktop app.
// Opens a PDF that was double-clicked / "opened with" this app, and routes
// subsequent opens to the running window.
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let pendingFile = null; // a PDF path waiting to be handed to the renderer

function findPdfArg(argv) {
  // argv includes the executable and possibly Chromium switches; pick a real .pdf path
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a && !a.startsWith('--') && /\.pdf$/i.test(a)) {
      try { if (fs.existsSync(a)) return a; } catch (e) { /* ignore */ }
    }
  }
  return null;
}

function readFilePayload(p) {
  try {
    const buf = fs.readFileSync(p);
    // Array of byte values — the renderer rebuilds it via new Uint8Array(data).buffer
    return { name: path.basename(p), data: Array.from(buf) };
  } catch (e) {
    return null;
  }
}

function sendFileToWindow(p) {
  const payload = readFilePayload(p);
  if (payload && mainWindow) mainWindow.webContents.send('open-file', payload);
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // File the app was launched with (Windows file association passes the path here).
  pendingFile = findPdfArg(process.argv);

  // A second launch (e.g. double-clicking another PDF) is routed to this instance.
  app.on('second-instance', (event, argv) => {
    const p = findPdfArg(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (p) sendFileToWindow(p);
    } else if (p) {
      pendingFile = p;
    }
  });

  // macOS "open with" event.
  app.on('open-file', (event, p) => {
    event.preventDefault();
    if (mainWindow) sendFileToWindow(p);
    else pendingFile = p;
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 850,
      minWidth: 720,
      minHeight: 560,
      backgroundColor: '#0e1526',
      icon: path.join(__dirname, 'build', 'icon.ico'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    });
    Menu.setApplicationMenu(null);
    mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
    mainWindow.on('closed', () => { mainWindow = null; });
  }

  // Renderer asks (on load) for the file the app was opened with.
  ipcMain.handle('get-initial-file', () => {
    if (!pendingFile) return null;
    const payload = readFilePayload(pendingFile);
    pendingFile = null;
    return payload;
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
