/**
 * e2ee.worker.ts
 * Worker do RTCRtpScriptTransform: cifra (remetente) ou decifra (receptor) cada quadro codificado.
 * É um arquivo real, carregado por `new Worker(new URL(...), { type: 'module' })`: a CSP do servidor
 * (`worker-src 'self'`) bloquearia um worker `blob:`.
 *
 * A chave chega nas `options` da transformação (CryptoKey é clonável), então cada transformação
 * tem a própria `FrameCipher` e, portanto, o próprio prefixo de IV.
 */

import { FrameCipher, createFrameTransform, type EncodedFrameLike, type FrameTransformMode } from '../utils/e2eeCrypto';

interface TransformerLike {
  readable: ReadableStream<EncodedFrameLike>;
  writable: WritableStream<EncodedFrameLike>;
  options: { mode: FrameTransformMode; key: CryptoKey };
}

interface RtcTransformEvent {
  transformer: TransformerLike;
}

/** `DedicatedWorkerGlobalScope` não está nos tipos DOM usados pelo projeto */
const scope = self as unknown as { onrtctransform: ((event: RtcTransformEvent) => void) | null };

scope.onrtctransform = (event) => {
  const { readable, writable, options } = event.transformer;
  const cipher = new FrameCipher(options.key);
  const transform = createFrameTransform(cipher, options.mode, (err) => {
    console.warn(`[KIARA:e2ee] Quadro descartado (${options.mode}):`, err);
  });
  void readable.pipeThrough(new TransformStream<EncodedFrameLike, EncodedFrameLike>({ transform })).pipeTo(writable);
};
