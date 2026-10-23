const { contextBridge, ipcRenderer, sharedTexture } = require('electron');
const api = {
  ready: () => ipcRenderer.invoke('poc:ready'),
  done: (r) => ipcRenderer.invoke('poc:done', r),
  onTexture: (cb) => sharedTexture.setSharedTextureReceiver(cb),
};
if (process.contextIsolated) contextBridge.exposeInMainWorld('poc', api); else window.poc = api;