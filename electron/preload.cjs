// Exposes a tiny, safe database API to the app (no direct Node access from the page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexoraDesktop', {
  load: () => ipcRenderer.invoke('db:load'),
  save: (state) => ipcRenderer.invoke('db:save', state),
  saveSync: (state) => ipcRenderer.sendSync('db:saveSync', state),
  info: () => ipcRenderer.invoke('db:info'),
  openDataFolder: () => ipcRenderer.invoke('db:openFolder'),
  mcpConfig: () => ipcRenderer.invoke('mcp:config'),
});
