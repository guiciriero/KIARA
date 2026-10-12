/**
 * rtcConfig.ts
 *
 * Configurações globais de WebRTC, servidores ICE (STUN/TURN) e constantes
 * para controle de resiliência e recuperação de conexão (ICE restart).
 */

const getTurnConfig = (): RTCIceServer[] => {
  const url = import.meta.env?.VITE_TURN_URL;
  const username = import.meta.env?.VITE_TURN_USER;
  const credential = import.meta.env?.VITE_TURN_CREDENTIAL;

  if (url && username && credential) {
    return [
      {
        urls: url as string,
        username: username as string,
        credential: credential as string,
      },
    ];
  }
  return [];
};

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...getTurnConfig(),
];

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 2,
};

/** Período de tolerância (em ms) para reconexão espontânea em caso de 'disconnected' */
export const ICE_DISCONNECTED_GRACE_MS = 3000;

/** Número máximo de tentativas de ICE restart antes de recriar o peer */
export const MAX_ICE_RESTART_ATTEMPTS = 3;

/** Intervalo base de backoff (em ms) entre tentativas */
export const ICE_RESTART_BACKOFF_BASE_MS = 1000;
