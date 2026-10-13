// Sandboxed Electron preload scripts must use its limited CommonJS loader.
// oxlint-disable-next-line typescript/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('focalDesktop', {
  closeCapture: () => ipcRenderer.invoke('focal:capture-close'),
  openCapture: () => ipcRenderer.invoke('focal:capture-open'),
  chooseBackupFolder: () => ipcRenderer.invoke('focal:backup-folder'),
  settings: () => ipcRenderer.invoke('focal:settings'),
  setLogin: (enabled) => ipcRenderer.invoke('focal:login', enabled),
});
