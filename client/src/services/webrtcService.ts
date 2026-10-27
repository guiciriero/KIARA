/**
 * webrtcService.ts
 *
 * Barril de compatibilidade do subsistema WebRTC. A implementação foi dividida em:
 * - webrtcShared.ts: tipos e utilitários comuns (codecs, degradação, escala);
 * - webrtcBroadcaster.ts: conexões do apresentador para os espectadores;
 * - webrtcViewer.ts: recepção da transmissão no lado do espectador.
 */

export {
  MAX_ICE_CANDIDATE_BUFFER,
  VIDEO_STALL_TIMEOUT_MS,
  computeScaleDown,
  degradationPreferenceFor,
  orderCodecs,
} from './webrtcShared';
export type { BroadcasterOptions, RTCRtpCodecCapability } from './webrtcShared';
export { WebRTCBroadcaster } from './webrtcBroadcaster';
export { WebRTCViewer } from './webrtcViewer';
