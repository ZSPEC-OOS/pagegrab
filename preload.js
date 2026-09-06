const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pagegrab', {
  captureFullPage: (webContentsId) => ipcRenderer.invoke('capture-fullpage', webContentsId),
  savePng: (base64Data) => ipcRenderer.invoke('save-png', base64Data),
});
