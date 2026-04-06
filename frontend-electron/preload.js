const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('krakenApp', {
  getAppMeta: () => ipcRenderer.invoke('app:get-app-meta'),
  getSettings: () => ipcRenderer.invoke('app:get-settings'),
  updateSettings: (patch) => ipcRenderer.invoke('app:update-settings', patch),
  getUpdateState: () => ipcRenderer.invoke('app:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  getDeviceInfo: () => ipcRenderer.invoke('app:get-device-info'),
  setBrightness: (value) => ipcRenderer.invoke('app:set-brightness', value),
  recoverLiquid: () => ipcRenderer.invoke('app:recover-liquid'),
  listGallery: () => ipcRenderer.invoke('app:list-gallery'),
  getAppState: () => ipcRenderer.invoke('app:get-app-state'),
  saveAppState: (state) => ipcRenderer.invoke('app:save-app-state', state),
  assetExists: (assetPath) => ipcRenderer.invoke('app:asset-exists', assetPath),
  deleteAsset: (assetPath) => ipcRenderer.invoke('app:delete-asset', assetPath),
  openGalleryFolder: () => ipcRenderer.invoke('app:open-gallery-folder'),
  pickFile: () => ipcRenderer.invoke('app:pick-file'),
  writeAsset: (payload) => ipcRenderer.invoke('app:write-asset', payload),
  getPreset: (assetPath) => ipcRenderer.invoke('app:get-preset', assetPath),
  savePreset: (assetPath, preset) => ipcRenderer.invoke('app:save-preset', assetPath, preset),
  searchGifs: (query) => ipcRenderer.invoke('app:search-gifs', query),
  downloadSearchResult: (payload) => ipcRenderer.invoke('app:download-search-result', payload),
  onDeployProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('app:deploy-progress', wrapped);
    return () => ipcRenderer.removeListener('app:deploy-progress', wrapped);
  },
  onUpdateState: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('app:update-state', wrapped);
    return () => ipcRenderer.removeListener('app:update-state', wrapped);
  }
});
