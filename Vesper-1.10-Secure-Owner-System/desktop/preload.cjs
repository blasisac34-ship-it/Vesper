// Small, safe bridge from the Vesper page to the desktop app. Exposes only Discord status updates.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vesperDesktop', {
  isDesktop: true,
  discord: {
    set: (activity) => ipcRenderer.send('discord:set', activity),
    clear: () => ipcRenderer.send('discord:clear'),
    enable: (on) => ipcRenderer.invoke('discord:enable', !!on),
    status: () => ipcRenderer.invoke('discord:status'),
  },
});

// First-launch setup page only.
contextBridge.exposeInMainWorld('vesperSetup', {
  useServer: (url) => ipcRenderer.invoke('setup:server', url),
  useLocal: () => ipcRenderer.invoke('setup:local'),
});
