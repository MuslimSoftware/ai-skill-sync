const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skillSync', {
  getConfig: () => ipcRenderer.invoke('skill-sync:get-config'),
  inspect: (payload = {}) => ipcRenderer.invoke('skill-sync:inspect', payload),
  sync: (payload = {}) => ipcRenderer.invoke('skill-sync:sync', payload),
  openPath: (targetPath) => ipcRenderer.invoke('skill-sync:open-path', targetPath),
  skillDetails: (payload = {}) => ipcRenderer.invoke('skill-sync:skill-details', payload)
});
