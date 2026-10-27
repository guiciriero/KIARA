/**
 * Gravação local da live: MediaRecorder sobre o stream combinado (vídeo + faixa do mixer).
 * Nada é enviado ao servidor; ao parar, o arquivo .webm é baixado no próprio computador.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm'];

/** Escolhe o primeiro formato suportado (VP9+Opus, com fallback para webm genérico) */
export function pickRecorderMimeType(
  isSupported: (mime: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
): string | null {
  return MIME_CANDIDATES.find((m) => isSupported(m)) ?? null;
}

/** kiara-AAAA-MM-DD-HHmm.webm (hora local) */
export function buildRecordingFilename(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `kiara-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.webm`;
}

/** Formata segundos como MM:SS (ou H:MM:SS) */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/** Baixa o blob como arquivo e revoga a URL depois */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export interface ActiveRecording {
  /** Para a gravação; resolve com o blob final */
  stop(): Promise<Blob>;
}

/** Inicia um MediaRecorder; separado do hook para ser testável com um MediaRecorder falso */
export function startRecording(
  stream: MediaStream,
  mimeType: string,
  Recorder: typeof MediaRecorder = MediaRecorder,
): ActiveRecording {
  const chunks: Blob[] = [];
  const recorder = new Recorder(stream, { mimeType });
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(1000);
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        if (recorder.state === 'inactive') {
          resolve(new Blob(chunks, { type: mimeType }));
          return;
        }
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        recorder.stop();
      }),
  };
}

export function useRecorder(
  getStream: () => MediaStream | null,
  /** A gravação para sozinha quando a live termina (active vira false) */
  active: boolean,
) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<ActiveRecording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const finish = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setIsRecording(false);
    setElapsed(0);
    if (!recording) return;
    const blob = await recording.stop();
    if (blob.size > 0) downloadBlob(blob, buildRecordingFilename());
  }, []);

  const start = useCallback(() => {
    if (recordingRef.current) return;
    const stream = getStream();
    const mime = pickRecorderMimeType();
    if (!stream || !mime) {
      setError('Este navegador não consegue gravar a transmissão.');
      return;
    }
    try {
      recordingRef.current = startRecording(stream, mime);
    } catch {
      setError('Não foi possível iniciar a gravação.');
      return;
    }
    setError(null);
    setIsRecording(true);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 500);
  }, [getStream]);

  useEffect(() => {
    if (!active && recordingRef.current) void finish();
  }, [active, finish]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    void recordingRef.current?.stop();
    recordingRef.current = null;
  }, []);

  return { isRecording, elapsed, error, start, stop: finish };
}
