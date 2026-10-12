'use strict';

/**
 * Preload (sandbox: apenas require('electron')).
 * Expõe `window.screenShareHost` conforme ScreenShareHostApi (shared/types/index.ts).
 * Nunca expõe ipcRenderer nem objetos do Electron.
 *
 * Os handlers do processo principal respondem {ok:true,data} | {ok:false,error};
 * aqui o erro é convertido em Error com mensagem legível em pt-BR.
 */

const { contextBridge, ipcRenderer } = require('electron');

const PLATFORMS = { win32: 'windows', darwin: 'macos' };
const platform = PLATFORMS[process.platform];

async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || res.ok !== true) {
    throw new Error((res && res.error) || 'Erro desconhecido no aplicativo desktop.');
  }
  return res.data;
}

// Único listener de áudio ativo (start repetido substitui o anterior).
let chunkListener = null;

function removeChunkListener() {
  if (chunkListener) {
    ipcRenderer.removeListener('audio:chunk', chunkListener);
    chunkListener = null;
  }
}

const api = {
  platform,
  audio: {
    listSources: () => invoke('audio:list'),

    async start(pids, onChunk) {
      if (typeof onChunk !== 'function') {
        throw new Error('Callback de áudio inválida.');
      }
      removeChunkListener();
      // Registra antes de invocar para não perder os primeiros chunks.
      const listener = (_event, chunk) => {
        if (!chunk || !ArrayBuffer.isView(chunk.pcm)) return;
        onChunk({
          pid: chunk.pid,
          pcm: chunk.pcm,
          frames: chunk.frames,
          sampleRate: chunk.sampleRate,
          channels: chunk.channels,
        });
      };
      chunkListener = listener;
      ipcRenderer.on('audio:chunk', listener);
      try {
        await invoke('audio:start', pids);
      } catch (err) {
        if (chunkListener === listener) removeChunkListener();
        throw err;
      }
    },

    async stop() {
      removeChunkListener();
      await invoke('audio:stop');
    },
  },
  capture: {
    listSources: () => invoke('capture:list'),
    selectSource: (id) => invoke('capture:select', id),
  },
};

if (platform) {
  contextBridge.exposeInMainWorld('screenShareHost', api);
}
