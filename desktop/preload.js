// Exposes a tiny, safe bridge to the web app (matches window.electronAPI usage
// already present in index.html).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Returns { name, data } for the PDF the app was opened with, or null.
  getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
  // Fires when the user opens another PDF while the app is already running.
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_event, payload) => cb(payload))
});
