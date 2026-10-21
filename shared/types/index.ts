/**
 * Tipos compartilhados entre servidor e cliente.
 * Centraliza as definições de interface para garantir consistência
 * em toda a aplicação.
 */

// ─── Sala de Compartilhamento ─────────────────────────────────────────────────

/** Informações de uma sala de compartilhamento */
export interface Room {
  id: string;
  code: string;           // Código de convite legível (ex.: "ABC-123")
  hostId: string;         // Socket ID do apresentador
  createdAt: number;      // Timestamp de criação
  viewerCount: number;
  isActive: boolean;
}

/** Configurações de qualidade da transmissão */
export interface StreamConfig {
  video: VideoConfig;
  audio: AudioConfig;
}

export interface VideoConfig {
  width: number;          // Largura em pixels (max 3840)
  height: number;         // Altura em pixels (max 2160)
  frameRate: number;      // FPS (1-120)
  codec: VideoCodec;
  bitrate: number;        // kbps
  quality: 'low' | 'medium' | 'high' | 'ultra';
}

export interface AudioConfig {
  sampleRate: 44100 | 48000;
  bitrate: number;        // kbps (até 320)
  codec: AudioCodec;
  sources: AudioSource[]; // Fontes de áudio selecionadas
}

export type VideoCodec = 'H264' | 'H265' | 'VP9' | 'VP8' | 'AV1';
export type AudioCodec = 'opus' | 'aac';

// ─── Fontes de Áudio ─────────────────────────────────────────────────────────

/** Representa um processo/aplicativo com saída de áudio capturável */
export interface AudioSource {
  id: string;             // Identificador único (PID ou nome do sink-input)
  processId: number;      // PID do processo
  processName: string;    // Nome do executável
  displayName: string;    // Nome amigável para exibição
  iconBase64?: string;    // Ícone do aplicativo em base64
  volume: number;         // Volume 0.0 a 1.0
  isMuted: boolean;
  platform: 'windows' | 'linux' | 'macos';
}
// ─── Ponte Electron (preload → renderer) ─────────────────────────────────────
// Exposta em `window.screenShareHost` SOMENTE quando rodando no app desktop.
// No navegador comum a propriedade não existe.

/** Bloco de áudio PCM de um aplicativo (float32 intercalado L,R,L,R...) */
export interface NativeAudioChunk {
  pid: number;
  pcm: Float32Array;
  frames: number;       // amostras por canal
  sampleRate: number;   // sempre 48000
  channels: number;     // sempre 2
}

/** Tela ou janela disponível para captura de vídeo */
export interface CaptureSourceInfo {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnailDataUrl: string;
}

/** Estado da atualização do app desktop (união discriminada por `status`). */
interface UpdateStateBase {
  currentVersion: string;
  /** SHA curto do commit do build instalado (ou "dev") */
  build?: string;
}

export type UpdateState =
  | (UpdateStateBase & { status: 'disabled'; message: string })
  | (UpdateStateBase & { status: 'idle' })
  | (UpdateStateBase & { status: 'checking' })
  | (UpdateStateBase & { status: 'available'; latestVersion: string })
  | (UpdateStateBase & { status: 'not-available' })
  | (UpdateStateBase & { status: 'downloading'; latestVersion?: string; progress: number })
  | (UpdateStateBase & { status: 'downloaded'; latestVersion?: string; progress: 100 })
  | (UpdateStateBase & { status: 'error'; latestVersion?: string; message: string });

export interface ScreenShareHostApi {
  platform: 'windows' | 'macos';
  audio: {
    /** Lista aplicativos cujo áudio pode ser capturado */
    listSources(): Promise<AudioSource[]>;
    /** Inicia a captura dos PIDs. Rejeita com mensagem legível em caso de falha. */
    start(pids: number[], onChunk: (chunk: NativeAudioChunk) => void): Promise<void>;
    stop(): Promise<void>;
  };
  capture: {
    listSources(): Promise<CaptureSourceInfo[]>;
    /** Define a fonte usada pelo PRÓXIMO getDisplayMedia (uso único) */
    selectSource(id: string): Promise<void>;
  };
  app: {
    /**
     * URL pública (https) desta instância do app, gerada pelo túnel embutido.
     * null quando o túnel não está ativo (modo dev, ou falha ao criar o túnel).
     */
    getPublicUrl(): Promise<string | null>;
    /**
     * Abre no navegador padrão o link de transmissão de OUTRA pessoa.
     * O processo principal valida: https + caminho /view/CÓDIGO (6 caracteres).
     * Rejeita com mensagem legível em pt-BR se o link for inválido.
     */
    openViewerLink(url: string): Promise<void>;
  };
  updater: {
    getState(): Promise<UpdateState>;
    /** Consulta o feed de releases; o resultado chega em `onState`. */
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    /** Fecha o app e roda o instalador. Só vale em `downloaded`. */
    install(): Promise<UpdateState>;
    /** Assina mudanças de estado; devolve a função que cancela a assinatura. */
    onState(cb: (state: UpdateState) => void): () => void;
  };
}


// ─── Eventos WebSocket / Sinalização ─────────────────────────────────────────

/** Tipos de eventos trocados entre cliente e servidor */
export type SignalingEvent =
  | 'room:create'
  | 'room:join'
  | 'room:leave'
  | 'room:error'
  | 'room:created'
  | 'room:joined'
  | 'room:pending-approval'
  | 'room:join-request'
  | 'room:respond-join'
  | 'room:viewer-joined'
  | 'room:viewer-left'
  | 'room:join-cancelled'
  | 'room:host-disconnected'
  | 'room:update-features'
  | 'room:features-update'
  | 'room:set-name'
  | 'chat:reaction'
  | 'webrtc:offer'
  | 'webrtc:answer'
  | 'webrtc:ice-candidate'
  | 'stream:config-update'
  | 'stream:quality-request'
  | 'stream:stats'
  // ── Co-apresentação (direta, sem aprovação do host) ───────────────────────
  /** C→S viewer reivindica a vaga de co-apresentador e começa a transmitir */
  | 'room:start-copresent'
  /** C→S co-apresentador libera a vaga ao parar de transmitir */
  | 'room:stop-copresent'
  /** S→viewer resposta à reivindicação da vaga (aceita ou ocupada) */
  | 'room:copresent-response'
  /** S→sala um co-apresentador iniciou a transmissão */
  | 'room:copresenter-joined'
  /** S→sala um co-apresentador parou de transmitir */
  | 'room:copresenter-left';

/** Payload genérico de evento de sinalização */
export interface SignalingMessage<T = unknown> {
  event: SignalingEvent;
  roomId: string;
  senderId: string;
  targetId?: string;      // ID do destinatário específico (se peer-to-peer)
  payload: T;
}
// ─── Salas: payloads do protocolo (Socket.IO) ────────────────────────────────

/** Servidor ICE entregue pelo servidor de sinalização (TURN com credencial efêmera). */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Códigos de erro estáveis de `room:error` (a interface decide o que fazer com cada um). */
export type RoomErrorCode =
  | 'invalid-request'
  | 'invalid-code'
  | 'not-found'
  | 'closed'
  | 'room-full'
  | 'password-required'
  | 'wrong-password'
  | 'denied'
  | 'rate-limited'
  | 'server-busy'
  | 'internal';

export interface RoomErrorPayload {
  message: string;
  code: RoomErrorCode;
}

/** C→S `room:create` (o payload inteiro é opcional) */
export interface CreateRoomPayload {
  /** Senha da sala (4 a 64 caracteres). Ausente = sala sem senha. */
  password?: string;
  /** Se true, cada espectador só entra depois que o apresentador aprovar. */
  requireApproval?: boolean;
  /** Pede conexão somente via relay TURN (esconde o IP do apresentador). */
  privacyMode?: boolean;
  /** Permite reações na sala (padrão true) */
  reactionsEnabled?: boolean;
  /** Código preferencial para a sala (ex.: sala permanente) */
  preferredCode?: string;
}

/** Configurações de funcionalidades da sala (reações) */
export interface RoomFeaturesPayload {
  reactionsEnabled: boolean;
}

/** S→C `room:created` */
export interface RoomCreatedPayload {
  roomId: string;
  code: string;
  inviteUrl: string;
  iceServers: IceServerConfig[];
  /** Limite de espectadores simultâneos desta sala */
  maxViewers: number;
  hasPassword: boolean;
  requireApproval: boolean;
  /** true somente se o pedido foi atendido (exige TURN configurado no servidor) */
  privacyMode: boolean;
  reactionsEnabled: boolean;
}

/** C→S `room:join` */
export interface JoinRoomPayload {
  code: string;
  password?: string;
  /** Apelido exibido nas reações (até 24 caracteres) */
  name?: string;
}

// ─── Co-apresentação ─────────────────────────────────────────────────────────

/** C→S `room:start-copresent` — viewer começa a transmitir também (sem aprovação) */
export interface CopresentStartPayload {
  /** Apelido do co-apresentador (até 24 caracteres) */
  name?: string;
}

/** S→viewer `room:copresent-response` */
export interface CopresentResponsePayload {
  /** false = a vaga de co-apresentador já está ocupada */
  accepted: boolean;
  /** Socket ID do host (destino dos offers WebRTC quando accepted=true) */
  hostId?: string;
}

/** S→sala `room:copresenter-joined` / `room:copresenter-left` */
export interface CopresenterChangedPayload {
  copresenterId: string;
  name: string;
}

/** C→S `room:set-name` */
export interface UpdateNamePayload {
  name: string;
}

/** S→C `room:joined` (só depois de senha e aprovação) */
export interface RoomJoinedPayload {
  roomId: string;
  hostId: string;
  viewerCount: number;
  iceServers: IceServerConfig[];
  reactionsEnabled: boolean;
}

/** S→host `room:join-request` (sala com aprovação) */
export interface JoinRequestPayload {
  viewerId: string;
  name: string;
}

/** C(host)→S `room:respond-join` */
export interface RespondJoinPayload {
  viewerId: string;
  approved: boolean;
}

/** S→host `room:join-cancelled` (quando espectador pendente desconecta) */
export interface JoinCancelledPayload {
  viewerId: string;
}

/** Reações permitidas (cada lado mantém sua lista em runtime; aqui só o tipo). */
export type ReactionEmoji = '👍' | '❤️' | '😂' | '😮' | '👏' | '🔥';

/** C→S `chat:reaction` */
export interface SendReactionPayload {
  emoji: ReactionEmoji;
}

/** S→sala `chat:reaction` */
export interface ReactionEvent {
  id: string;
  senderId: string;
  name: string;
  emoji: ReactionEmoji;
  timestamp: number;
}



// ─── WebRTC ──────────────────────────────────────────────────────────────────

export interface RTCOfferPayload {
  sdp: string;
  type: 'offer';
  /** Configuração de stream enviada opcionalmente junto com a offer */
  config?: StreamConfig;
}

export interface RTCAnswerPayload {
  sdp: string;
  type: 'answer';
}

export interface RTCIceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type ViewerQualityPreference = 'auto' | '1080p' | '720p' | '480p' | '360p';

export interface QualityRequestPayload {
  targetHeight?: number | null; // null ou 0 = original/auto
  maxBitrateKbps?: number | null;
  preference: ViewerQualityPreference;
}

// ─── Estatísticas de Transmissão ─────────────────────────────────────────────

export interface StreamStats {
  fps: number;
  videoBitrate: number;   // kbps atual
  audioBitrate: number;   // kbps atual
  latencyMs: number;      // RTT do par de candidatos ICE selecionado
  packetsLost: number;    // Total acumulado de pacotes perdidos (reportado pelo espectador)
  lossPercent: number;    // Perda no último intervalo de amostragem (0-100)
  jitterMs: number;       // Jitter reportado pelo espectador
  /** Motivo pelo qual o encoder reduziu qualidade ('none' = sem limitação) */
  qualityLimitation: 'none' | 'cpu' | 'bandwidth' | 'other';
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';
  timestamp: number;
}

// ─── Estado da Aplicação ─────────────────────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
