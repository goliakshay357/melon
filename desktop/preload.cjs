const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('melonDesktop', {
    pickFolder: () => ipcRenderer.invoke('pick-folder'),
});
