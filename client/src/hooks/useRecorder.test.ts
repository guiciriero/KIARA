import { describe, it, expect } from 'vitest';
import {
  buildRecordingFilename,
  formatElapsed,
  pickRecorderMimeType,
  startRecording,
} from './useRecorder';

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public options: { mimeType: string }) {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc']) });
    this.onstop?.();
  }
}

describe('useRecorder utils', () => {
  it('prefere vp9+opus e cai para webm', () => {
    expect(pickRecorderMimeType(() => true)).toBe('video/webm;codecs=vp9,opus');
    expect(pickRecorderMimeType((m) => m === 'video/webm')).toBe('video/webm');
    expect(pickRecorderMimeType(() => false)).toBeNull();
  });

  it('monta o nome do arquivo com data e hora locais', () => {
    expect(buildRecordingFilename(new Date(2025, 0, 5, 9, 7))).toBe('kiara-2025-01-05-0907.webm');
  });

  it('formata o tempo decorrido', () => {
    expect(formatElapsed(65)).toBe('01:05');
    expect(formatElapsed(3725)).toBe('1:02:05');
  });

  it('grava e devolve o blob ao parar', async () => {
    const rec = startRecording(
      {} as MediaStream,
      'video/webm',
      FakeMediaRecorder as unknown as typeof MediaRecorder,
    );
    expect(FakeMediaRecorder.instances[0].state).toBe('recording');
    const blob = await rec.stop();
    expect(blob.size).toBe(3);
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
  });
});
