// Electron main process for "עורך PDF" desktop app.
// The editor is served from a tiny built-in HTTP server on 127.0.0.1 (the same
// setup it was built and tested against) instead of file://, which avoids the
// ERR_FAILED that large local pages hit under the file:// protocol.
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const urlmod = require('url');

// Disabling hardware acceleration avoids black-screen issues on some Windows GPUs.
app.disableHardwareAcceleration();

let mainWindow = null;
let pendingFile = null; // a PDF path waiting to be handed to the renderer
let appBaseUrl = null;  // http://127.0.0.1:<port> once the local server is up
let docDirty = false;   // renderer reports unsaved changes
let forceClose = false; // set once the user chose to close (saved or discarded)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function requestHandler(rootDir) {
  return (req, res) => {
    let pathname = '/index.html';
    try { pathname = decodeURIComponent(urlmod.parse(req.url).pathname || '/'); } catch (e) { /* ignore */ }
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const safe = path.normalize(pathname).replace(/^([\\/]|\.\.[\\/])+/, '');
    const filePath = path.join(rootDir, safe);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.statusCode = 404; res.end('Not found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.end(data);
    });
  };
}

// Serve on a FIXED port so the page origin stays the same between launches —
// otherwise localStorage (which holds the saved signatures/stamps library and
// settings) would reset every time the app starts.
function startServer(rootDir) {
  const BASE_PORT = 33017;
  return new Promise((resolve) => {
    const tryPort = (port, attemptsLeft) => {
      const server = http.createServer(requestHandler(rootDir));
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          tryPort(port + 1, attemptsLeft - 1);
        } else {
          const s2 = http.createServer(requestHandler(rootDir));
          s2.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + s2.address().port));
        }
      });
      server.listen(port, '127.0.0.1', () => resolve('http://127.0.0.1:' + port));
    };
    tryPort(BASE_PORT, 8);
  });
}

function findPdfArg(argv) {
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
  pendingFile = findPdfArg(process.argv);

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

    if (appBaseUrl) {
      mainWindow.loadURL(appBaseUrl + '/index.html');
    } else {
      // Fallback if the local server did not start.
      const indexPath = path.join(__dirname, 'app', 'index.html');
      if (fs.existsSync(indexPath)) mainWindow.loadFile(indexPath);
      else showError(mainWindow, 'האפליקציה לא נטענה (שרת מקומי לא עלה).');
    }

    // In-app pages stay in the app; external links (Gmail, WhatsApp Web) open in Chrome.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (appBaseUrl && url.startsWith(appBaseUrl)) return { action: 'allow' };
      if (/^https?:\/\//i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
      if (/^(blob|data):/i.test(url)) return { action: 'allow' };
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (e, url) => {
      if (/^https?:\/\//i.test(url) && (!appBaseUrl || !url.startsWith(appBaseUrl))) {
        e.preventDefault();
        shell.openExternal(url);
      }
    });

    // Never leave the user on a blank/black window — show a readable message.
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (code === -3) return; // ERR_ABORTED (e.g. a redirect) — not a real failure
      showError(mainWindow, 'טעינת האפליקציה נכשלה\n' + desc + ' (' + code + ')\n' + url);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      showError(mainWindow, 'תהליך התצוגה קרס: ' + (details && details.reason));
    });

    // Prompt to save unsaved changes before the window closes.
    mainWindow.on('close', (e) => {
      if (forceClose || !docDirty) return;
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['שמור', 'אל תשמור', 'ביטול'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: 'שמירה',
        message: 'יש שינויים שלא נשמרו במסמך.',
        detail: 'האם לשמור את המסמך לפני היציאה?'
      });
      if (choice === 2) return;                 // Cancel — stay open
      if (choice === 1) { forceClose = true; mainWindow.close(); return; } // Don't save
      mainWindow.webContents.send('save-then-close'); // Save → renderer saves, then allow-close
    });

    mainWindow.on('closed', () => { mainWindow = null; });
  }

  function showError(win, msg) {
    const html =
      '<html><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;background:#0e1526;color:#e8eef7;font-family:Arial,sans-serif;' +
      'display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;direction:rtl">' +
      '<div style="max-width:520px;padding:24px;line-height:1.7">' +
      '<h2 style="color:#60a5fa">עורך PDF</h2><pre style="white-space:pre-wrap;color:#93a2bd">' +
      String(msg).replace(/</g, '&lt;') + '</pre></div></body></html>';
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  }

  ipcMain.handle('open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Renderer reports whether there are unsaved changes.
  ipcMain.on('set-dirty', (_e, v) => { docDirty = !!v; });

  // Renderer asks to close after saving (or the user chose "Save" on close).
  ipcMain.on('allow-close', () => { forceClose = true; if (mainWindow) mainWindow.close(); });

  // Native "Save As" — write the PDF bytes to a location the user picks.
  ipcMain.handle('save-pdf', async (_e, { bytes, name }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'שמירת מסמך',
      defaultPath: name || 'document.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { saved: false, canceled: true };
    try { fs.writeFileSync(filePath, Buffer.from(bytes)); return { saved: true, path: filePath }; }
    catch (err) { return { saved: false, error: String(err) }; }
  });

  ipcMain.handle('get-initial-file', () => {
    if (!pendingFile) return null;
    const payload = readFilePayload(pendingFile);
    pendingFile = null;
    return payload;
  });

  app.whenReady().then(async () => {
    try {
      appBaseUrl = await startServer(path.join(__dirname, 'app'));
    } catch (e) {
      appBaseUrl = null;
    }
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
