// Exposes a tiny, safe bridge to the web app (matches window.electronAPI usage
// already present in index.html).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Returns { name, data } for the PDF the app was opened with, or null.
  getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
  // Fires when the user opens another PDF while the app is already running.
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_event, payload) => cb(payload)),
  // Open a link (Gmail / WhatsApp Web) in the system default browser (Chrome).
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Save/close support.
  setDirty: (v) => ipcRenderer.send('set-dirty', v),
  savePdf: (bytes, name) => ipcRenderer.invoke('save-pdf', { bytes, name }),
  onSaveThenClose: (cb) => ipcRenderer.on('save-then-close', () => cb()),
  allowClose: () => ipcRenderer.send('allow-close')
});
