// Bridge: renderer asks for native folder → main shows the OS dialog.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('melonDesktop', {
    pickFolder: () => ipcRenderer.invoke('pick-folder'),
});
