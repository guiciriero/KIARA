'use strict';

/**
 * Configuração por plataforma (módulo PURO, sem Electron). Testado em platformConfig.test.ts.
 *
 * Observação: o preload roda em sandbox e não pode dar require de arquivos locais, então o
 * mapa process.platform -> 'windows' | 'macos' | 'linux' de `window.screenShareHost.platform`
 * fica duplicado em preload.js (o teste confere que os dois continuam coerentes).
 */

/** Nome do binário do cloudflared por plataforma (o do Windows é .exe). */
function cloudflaredBinaryName(platform) {
  return platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/** Sessão Wayland (XDG_SESSION_TYPE=wayland). */
function isWayland(env) {
  return String((env && env.XDG_SESSION_TYPE) || '').toLowerCase() === 'wayland';
}

/**
 * Switches de linha de comando do Chromium (GPU / baixa latência), na forma [nome, valor?].
 * Base igual em todas as plataformas (comportamento original); no Linux acrescenta
 * WebRTCPipeWireCapturer (captura de tela/janela via PipeWire) e, em sessão Wayland,
 * UseOzonePlatform + ozone-platform-hint=auto.
 *
 * @param {{ platform: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {Array<[string] | [string, string]>}
 */
function buildCommandLineSwitches({ platform, env = {} }) {
  const features = [
    'VaapiVideoDecoder',
    'VaapiVideoEncoder',
    'CanvasOopRasterization',
    'WebRtcHideLocalIpsWithMdns',
    'PlatformHEVCDecoderSupport',
    'WebRtcUseMinMaxVEADimensions',
  ];
  // NÃO usar 'disable-frame-rate-limit' nem 'disable-gpu-vsync' (saturam GPU/CPU sem ganho).
  const switches = [
    ['enable-gpu-rasterization'],
    ['enable-zero-copy'],
    ['enable-accelerated-video-decode'],
    ['enable-accelerated-mjpeg-decode'],
    ['enable-webrtc-hw-encoding'],
    ['enable-webrtc-hw-decoding'],
    ['ignore-gpu-blocklist'],
    ['disable-background-timer-throttling'],
    ['disable-renderer-backgrounding'],
    ['disable-backgrounding-occluded-windows'],
  ];
  if (platform === 'linux') {
    features.push('WebRTCPipeWireCapturer');
    if (isWayland(env)) {
      features.push('UseOzonePlatform');
      switches.push(['ozone-platform-hint', 'auto']);
    }
  }
  switches.push(['enable-features', features.join(',')]);
  return switches;
}

module.exports = { cloudflaredBinaryName, isWayland, buildCommandLineSwitches };
