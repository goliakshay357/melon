const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('melonDesktop', {
    pickFolder: () => ipcRenderer.invoke('pick-folder'),
    setDeveloperDebugger: (enabled) => ipcRenderer.send('developer-debugger', enabled === true),
});
