/**
 * Hook do co-apresentador: um espectador que também transmite a própria tela.
 *
 * Sem etapa de permissão: o clique em "Iniciar" captura a tela na hora (o seletor nativo do
 * navegador é o único consentimento), reivindica a vaga única no servidor e envia o offer
 * WebRTC direto ao host (`broadcaster.connectToPeer(hostId)`). Se a vaga estiver ocupada,
 * a captura é desfeita e o usuário é avisado.
 * O áudio passa por um BroadcastAudio, como em useBroadcast.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { WebRTCBroadcaster } from '../services/webrtcService';
import { captureDisplay, stopStream, contentHintForQuality } from '../services/captureService';
import { BroadcastAudio } from '../services/broadcastAudio';
import type { AudioSelectionItem } from '../services/broadcastAudio';
import { isCancellation, toMediaError, getErrorMessage } from '../services/mediaError';
import { E2eeSession } from '../services/e2ee';
import type {
  VideoConfig,
  IceServerConfig,
  CopresentStartPayload,
  CopresentResponsePayload,
} from '@shared/index';

export interface CopresenterState {
  isSharing: boolean;
  isPaused: boolean;
  /** Cópia só de vídeo da captura, para o preview local */
  stream: MediaStream | null;
  error: string | null;
  /** Capturando a tela / aguardando o servidor confirmar a vaga */
  starting: boolean;
}

const INITIAL_STATE: CopresenterState = {
  isSharing: false,
  isPaused: false,
  stream: null,
  error: null,
  starting: false,
};

const CLAIM_TIMEOUT_MS = 8000;

export function useCopresenter(
  socket: Socket | null,
  hostId: string | null,
  iceServers: IceServerConfig[],
  videoConfig: VideoConfig,
  audioSelection: AudioSelectionItem[],
  /** (desktop) ID da tela/janela escolhida na interface */
  captureSourceId: string | null,
  /** Dados enviados ao iniciar (ex.: apelido) */
  roomOptions?: CopresentStartPayload,
  /** Sala E2EE: chave de mídia derivada da senha (null = sala sem E2EE) */
  mediaKey: CryptoKey | null = null,
) {
  const broadcasterRef = useRef<WebRTCBroadcaster | null>(null);
  const e2eeRef = useRef<E2eeSession | null>(null);
  const audioRef = useRef<BroadcastAudio | null>(null);
  /** Stream enviado ao WebRTC (vídeo + faixa estável do mixer) */
  const streamRef = useRef<MediaStream | null>(null);
  /** Stream bruto do getDisplayMedia; guarda as faixas de áudio do sistema no modo web */
  const captureStreamRef = useRef<MediaStream | null>(null);
  /** true entre o clique em Iniciar e a transmissão estar no ar (evita cliques duplos) */
  const startingRef = useRef(false);

  const latest = useRef({ hostId, iceServers, videoConfig, audioSelection, captureSourceId, roomOptions, mediaKey });
  latest.current = { hostId, iceServers, videoConfig, audioSelection, captureSourceId, roomOptions, mediaKey };

  const [state, setState] = useState<CopresenterState>(INITIAL_STATE);

  const release = useCallback(() => {
    broadcasterRef.current?.destroy();
    broadcasterRef.current = null;
    e2eeRef.current?.destroy();
    e2eeRef.current = null;

    void audioRef.current?.destroy();
    audioRef.current = null;

    stopStream(streamRef.current);
    streamRef.current = null;
    stopStream(captureStreamRef.current);
    captureStreamRef.current = null;
  }, []);

  // Ao desmontar, libera a captura e a vaga de co-apresentador
  useEffect(() => () => {
    if (broadcasterRef.current) socket?.emit('room:stop-copresent');
    release();
  }, [release, socket]);

  // Aplica ao vivo a seleção de fontes, volume e mute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.sync(audioSelection).catch((err) => {
      setState((s) => ({ ...s, error: getErrorMessage(err) }));
    });
  }, [audioSelection]);

  /** Para a transmissão local sem sair da sala e libera a vaga no servidor */
  const stopCopresent = useCallback(() => {
    const wasActive = broadcasterRef.current !== null || startingRef.current;
    startingRef.current = false;
    release();
    setState(INITIAL_STATE);
    if (wasActive) socket?.emit('room:stop-copresent');
  }, [release, socket]);

  /** Aguarda a resposta do servidor à reivindicação da vaga */
  const claimSlot = useCallback(
    (payload: CopresentStartPayload) =>
      new Promise<CopresentResponsePayload>((resolve, reject) => {
        if (!socket) {
          reject(new Error('Não foi possível conectar ao servidor. Recarregue a página e tente novamente.'));
          return;
        }
        const done = () => {
          clearTimeout(timer);
          socket.off('room:copresent-response', onResponse);
        };
        const onResponse = (data: CopresentResponsePayload) => { done(); resolve(data); };
        const timer = setTimeout(() => {
          done();
          reject(new Error('O servidor demorou muito para responder. Tente novamente.'));
        }, CLAIM_TIMEOUT_MS);
        socket.on('room:copresent-response', onResponse);
        socket.emit('room:start-copresent', payload);
      }),
    [socket],
  );

  /** Captura a tela e começa a transmitir ao host, sem pedir permissão a ninguém */
  const startCopresent = useCallback(async () => {
    if (!socket || startingRef.current || broadcasterRef.current) return;
    const cfg = latest.current;
    startingRef.current = true;
    setState({ ...INITIAL_STATE, starting: true });

    let claimed = false;
    try {
      const host = window.screenShareHost;
      // 1. Seletor nativo: se o usuário cancelar, nada foi reivindicado ainda
      const capture = await captureDisplay(cfg.videoConfig, {
        withAudio: true,
        captureSourceId: cfg.captureSourceId,
        contentHint: contentHintForQuality(cfg.videoConfig.quality),
      });
      captureStreamRef.current = capture.stream;

      // 2. Reivindica a vaga única de co-apresentador
      claimed = true;
      const response = await claimSlot({ ...cfg.roomOptions });
      const targetId = response.hostId ?? cfg.hostId;
      if (!response.accepted) {
        throw new Error('Já existe outra pessoa transmitindo nesta sala.');
      }
      if (!targetId) throw new Error('Não foi possível identificar o apresentador.');

      const audio = await BroadcastAudio.create(host);
      audioRef.current = audio;
      if (!host) audio.attachSystemAudio(capture.audioTracks);

      // Falha de áudio não impede a transmissão: o vídeo segue e o erro é exibido
      let audioError: string | null = null;
      try {
        await audio.sync(latest.current.audioSelection);
      } catch (err) {
        audioError = getErrorMessage(err);
      }

      const combined = new MediaStream([capture.videoTrack, audio.track]);
      streamRef.current = combined;

      // Sala E2EE: a tela do co-apresentador também sai cifrada com a chave da sala
      const e2ee = cfg.mediaKey ? new E2eeSession(cfg.mediaKey) : undefined;
      e2eeRef.current = e2ee ?? null;

      // maxViewers 1: o co-apresentador só envia para o host, nunca para outros espectadores
      const broadcaster = new WebRTCBroadcaster(socket, cfg.videoConfig, {
        iceServers: cfg.iceServers,
        privacyMode: false,
        maxViewers: 1,
        e2ee,
      });
      broadcaster.setLocalStream(combined);
      broadcasterRef.current = broadcaster;
      broadcaster.connectToPeer(targetId);

      // O usuário clicou em "Parar compartilhamento" no seletor nativo
      capture.videoTrack.onended = stopCopresent;

      startingRef.current = false;
      setState({
        ...INITIAL_STATE,
        isSharing: true,
        stream: new MediaStream(combined.getVideoTracks()),
        error: audioError,
      });
    } catch (err) {
      startingRef.current = false;
      release();
      if (claimed) socket.emit('room:stop-copresent');
      setState({
        ...INITIAL_STATE,
        // Cancelar o seletor não é erro a exibir
        error: isCancellation(toMediaError(err)) ? null : toMediaError(err).message,
      });
    }
  }, [socket, claimSlot, release, stopCopresent]);

  const togglePause = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setState((s) => ({ ...s, isPaused: !s.isPaused }));
  }, []);

  /** Aplica ao vivo mudanças de qualidade de vídeo */
  const updateVideoConfig = useCallback(async (partial: Partial<VideoConfig>) => {
    await broadcasterRef.current?.updateVideoConfig(partial);
  }, []);

  return { state, startCopresent, stopCopresent, togglePause, updateVideoConfig };
}
