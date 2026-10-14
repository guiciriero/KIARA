/**
 * statsService.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseRTCStats, classifyQuality, clearPeerSample, resetEmptyReportWarning } from './statsService';
import { createMockStatsReport, installRtcGlobals } from '../test/rtcFakes';

describe('statsService', () => {
  let restoreGlobals: () => void;

  beforeEach(() => {
    restoreGlobals = installRtcGlobals();
    clearPeerSample('peer-1');
    clearPeerSample('peer-2');
  });

  afterEach(() => {
    restoreGlobals();
  });

  describe('classifyQuality', () => {
    it('classifica como excellent quando RTT < 50ms e perda < 1%', () => {
      expect(classifyQuality(40, 0.5)).toBe('excellent');
      expect(classifyQuality(0, 0)).toBe('excellent');
    });

    it('classifica como good quando RTT < 150ms e perda < 3%', () => {
      expect(classifyQuality(100, 2)).toBe('good');
      expect(classifyQuality(49, 1.5)).toBe('good');
    });

    it('classifica como fair quando RTT < 300ms e perda < 8%', () => {
      expect(classifyQuality(200, 5)).toBe('fair');
      expect(classifyQuality(140, 7)).toBe('fair');
    });

    it('classifica como poor em cenários de alta latência ou perda', () => {
      expect(classifyQuality(350, 1)).toBe('poor');
      expect(classifyQuality(50, 9)).toBe('poor');
    });
  });

  describe('parseRTCStats', () => {
    it('extrai métricas e calcula bitrate e perda de pacotes via delta', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      const report1 = createMockStatsReport([
        {
          id: 'v-out',
          type: 'outbound-rtp',
          kind: 'video',
          framesPerSecond: 60,
          bytesSent: 100000,
          packetsSent: 100,
          qualityLimitationReason: 'none',
        },
        {
          id: 'a-out',
          type: 'outbound-rtp',
          kind: 'audio',
          bytesSent: 10000,
        },
        {
          id: 'v-remote',
          type: 'remote-inbound-rtp',
          kind: 'video',
          packetsLost: 2,
          jitter: 0.005,
          roundTripTime: 0.03,
        },
        {
          id: 't-1',
          type: 'transport',
          selectedCandidatePairId: 'cp-1',
        },
        {
          id: 'cp-1',
          type: 'candidate-pair',
          state: 'succeeded',
          currentRoundTripTime: 0.025,
        },
      ]);

      const stats1 = parseRTCStats(report1, 'peer-1');
      expect(stats1.fps).toBe(60);
      expect(stats1.latencyMs).toBe(25);
      expect(stats1.jitterMs).toBe(5);
      expect(stats1.qualityLimitation).toBe('none');

      // Segunda amostra 1 segundo depois (1000ms delta)
      vi.setSystemTime(2000);

      const report2 = createMockStatsReport([
        {
          id: 'v-out',
          type: 'outbound-rtp',
          kind: 'video',
          framesPerSecond: 60,
          bytesSent: 600000, // +500KB = 4000 kbps
          packetsSent: 500,  // +400 packets
          qualityLimitationReason: 'bandwidth',
        },
        {
          id: 'a-out',
          type: 'outbound-rtp',
          kind: 'audio',
          bytesSent: 26000,  // +16KB = 128 kbps
        },
        {
          id: 'v-remote',
          type: 'remote-inbound-rtp',
          kind: 'video',
          packetsLost: 6,    // +4 lost packets -> 4 / (400 + 4) = ~0.99% -> ~1%
          jitter: 0.012,
          roundTripTime: 0.045,
        },
        {
          id: 't-1',
          type: 'transport',
          selectedCandidatePairId: 'cp-1',
        },
        {
          id: 'cp-1',
          type: 'candidate-pair',
          state: 'succeeded',
          currentRoundTripTime: 0.045,
        },
      ]);

      const stats2 = parseRTCStats(report2, 'peer-1');
      expect(stats2.videoBitrate).toBe(4000);
      expect(stats2.audioBitrate).toBe(128);
      expect(stats2.latencyMs).toBe(45);
      expect(stats2.lossPercent).toBe(1);
      expect(stats2.jitterMs).toBe(12);
      expect(stats2.qualityLimitation).toBe('bandwidth');

      vi.useRealTimers();
    });
  });

  describe('relatório sem entradas úteis', () => {
    it('não lança, devolve métricas zeradas e avisa uma única vez por sessão', () => {
      resetEmptyReportWarning();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const empty = createMockStatsReport([]);
      const first = parseRTCStats(empty, 'peer-1');
      const second = parseRTCStats(empty, 'peer-1');

      expect(first.fps).toBe(0);
      expect(first.latencyMs).toBe(0);
      expect(second.videoBitrate).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);

      warn.mockRestore();
    });

    it('não avisa quando há entradas úteis', () => {
      resetEmptyReportWarning();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      parseRTCStats(
        createMockStatsReport([{ id: 'v', type: 'outbound-rtp', kind: 'video', framesPerSecond: 30 }]),
        'peer-2',
      );
      expect(warn).not.toHaveBeenCalled();

      warn.mockRestore();
    });
  });
});
