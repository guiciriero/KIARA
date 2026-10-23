const { contextBridge, ipcRenderer, sharedTexture } = require('electron');
const api = {
  ready: () => ipcRenderer.invoke('poc:ready'),
  done: (r) => ipcRenderer.invoke('poc:done', r),
  // modo "frame": o preload cria o VideoFrame e entrega pronto a pagina
  onTexture: (cb) => sharedTexture.setSharedTextureReceiver(cb),
  onFrame: (cb) => sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }) => {
    const vf = importedSharedTexture.getVideoFrame();
    importedSharedTexture.release();
    cb(vf);
  }),
};
if (process.contextIsolated) contextBridge.exposeInMainWorld('poc', api); else window.poc = api;