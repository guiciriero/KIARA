import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  cloudflaredBinaryName,
  isWayland,
  buildCommandLineSwitches,
} = require('./platformConfig.js');

describe('platformConfig', () => {
  describe('cloudflaredBinaryName', () => {
    it('retorna cloudflared.exe para win32 e cloudflared para outras plataformas', () => {
      expect(cloudflaredBinaryName('win32')).toBe('cloudflared.exe');
      expect(cloudflaredBinaryName('linux')).toBe('cloudflared');
      expect(cloudflaredBinaryName('darwin')).toBe('cloudflared');
    });
  });

  describe('isWayland', () => {
    it('detecta XDG_SESSION_TYPE=wayland com case-insensitive', () => {
      expect(isWayland({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
      expect(isWayland({ XDG_SESSION_TYPE: 'Wayland' })).toBe(true);
      expect(isWayland({ XDG_SESSION_TYPE: 'x11' })).toBe(false);
      expect(isWayland({})).toBe(false);
      expect(isWayland(undefined)).toBe(false);
    });
  });

  describe('buildCommandLineSwitches', () => {
    it('inclui switches base em Windows e macOS', () => {
      const winSwitches = buildCommandLineSwitches({ platform: 'win32' });
      const winMap = new Map(winSwitches);
      expect(winMap.has('enable-gpu-rasterization')).toBe(true);
      expect(winMap.has('enable-zero-copy')).toBe(true);
      expect(winMap.has('enable-accelerated-video-decode')).toBe(true);
      expect(winMap.has('ignore-gpu-blocklist')).toBe(true);

      const features = winMap.get('enable-features');
      expect(features).toContain('VaapiVideoDecoder');
      expect(features).not.toContain('WebRTCPipeWireCapturer');
    });

    it('inclui WebRTCPipeWireCapturer no Linux (X11)', () => {
      const linuxSwitches = buildCommandLineSwitches({
        platform: 'linux',
        env: { XDG_SESSION_TYPE: 'x11' },
      });
      const linuxMap = new Map(linuxSwitches);
      const features = linuxMap.get('enable-features');
      expect(features).toContain('WebRTCPipeWireCapturer');
      expect(features).not.toContain('UseOzonePlatform');
      expect(linuxMap.has('ozone-platform-hint')).toBe(false);
    });

    it('inclui UseOzonePlatform e ozone-platform-hint=auto no Linux Wayland', () => {
      const waylandSwitches = buildCommandLineSwitches({
        platform: 'linux',
        env: { XDG_SESSION_TYPE: 'wayland' },
      });
      const waylandMap = new Map(waylandSwitches);
      const features = waylandMap.get('enable-features');
      expect(features).toContain('WebRTCPipeWireCapturer');
      expect(features).toContain('UseOzonePlatform');
      expect(waylandMap.get('ozone-platform-hint')).toBe('auto');
    });
  });
});
