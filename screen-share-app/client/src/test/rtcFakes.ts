/**
 * rtcFakes.ts
 *
 * Implementações falsas (fakes) para RTCPeerConnection, RTCRtpSender,
 * MediaStream e Socket.io para testes unitários com Vitest em ambiente Node.
 */

import type { RTCRtpCodecCapability } from '../services/webrtcService';

export class FakeMediaStreamTrack {
  kind: 'video' | 'audio';
  id: string;
  enabled = true;
  contentHint = '';
  stopped = false;
  onended: ((this: MediaStreamTrack, ev: Event) => unknown) | null = null;

  constructor(kind: 'video' | 'audio', id = `track-${Math.random()}`) {
    this.kind = kind;
    this.id = id;
  }

  stop(): void {
    this.stopped = true;
    if (this.onended) {
      this.onended.call(this as unknown as MediaStreamTrack, new Event('ended'));
    }
  }
}

export class FakeMediaStream {
  tracks: FakeMediaStreamTrack[];

  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks(): MediaStreamTrack[] {
    return this.tracks as unknown as MediaStreamTrack[];
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'video') as unknown as MediaStreamTrack[];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio') as unknown as MediaStreamTrack[];
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track as unknown as FakeMediaStreamTrack);
  }

  removeTrack(track: MediaStreamTrack): void {
    const idx = this.tracks.findIndex((t) => t.id === track.id);
    if (idx !== -1) {
      this.tracks.splice(idx, 1);
    }
  }
}

export class FakeRTCRtpSender {
  track: MediaStreamTrack | null;
  parameters: RTCRtpSendParameters;
  replaceTrackCalledWith: (MediaStreamTrack | null)[] = [];
  failReplaceTrack = false;

  constructor(track: MediaStreamTrack | null = null) {
    this.track = track;
    this.parameters = {
      encodings: [{}],
      headerExtensions: [],
      rtcp: { cname: '', reducedSize: false },
      codecs: [],
      transactionId: '',
    };
  }

  getParameters(): RTCRtpSendParameters {
    return JSON.parse(JSON.stringify(this.parameters));
  }

  async setParameters(params: RTCRtpSendParameters): Promise<void> {
    this.parameters = JSON.parse(JSON.stringify(params));
  }

  async replaceTrack(newTrack: MediaStreamTrack | null): Promise<void> {
    if (this.failReplaceTrack) {
      throw new Error('Falha simulada no replaceTrack');
    }
    this.replaceTrackCalledWith.push(newTrack);
    this.track = newTrack;
  }
}

export class FakeRTCRtpTransceiver {
  sender: FakeRTCRtpSender;
  receiver: { track: MediaStreamTrack };
  direction: RTCRtpTransceiverDirection = 'sendrecv';
  preferredCodecs: RTCRtpCodecCapability[] = [];

  constructor(kind: 'video' | 'audio', senderTrack: MediaStreamTrack | null = null) {
    this.sender = new FakeRTCRtpSender(senderTrack);
    this.receiver = { track: new FakeMediaStreamTrack(kind) as unknown as MediaStreamTrack };
  }

  setCodecPreferences(codecs: RTCRtpCodecCapability[]): void {
    this.preferredCodecs = [...codecs];
  }
}

export class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  config: RTCConfiguration;
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  isClosed = false;
  restartIceCount = 0;
  appliedIceCandidates: RTCIceCandidateInit[] = [];

  onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => unknown) | null = null;
  onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  oniceconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => unknown) | null = null;

  senders: FakeRTCRtpSender[] = [];
  transceivers: FakeRTCRtpTransceiver[] = [];
  mockStatsReport: RTCStatsReport | null = null;

  constructor(config: RTCConfiguration = {}) {
    this.config = config;
    FakeRTCPeerConnection.instances.push(this);
  }

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    const sender = new FakeRTCRtpSender(track);
    this.senders.push(sender);
    const transceiver = new FakeRTCRtpTransceiver(track.kind as 'video' | 'audio', track);
    transceiver.sender = sender;
    this.transceivers.push(transceiver);
    return sender as unknown as RTCRtpSender;
  }

  addTransceiver(
    trackOrKind: MediaStreamTrack | string,
    init?: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver {
    const kind = typeof trackOrKind === 'string' ? (trackOrKind as 'video' | 'audio') : (trackOrKind.kind as 'video' | 'audio');
    const track = typeof trackOrKind === 'string' ? null : trackOrKind;
    const transceiver = new FakeRTCRtpTransceiver(kind, track);
    if (init?.direction) {
      transceiver.direction = init.direction;
    }
    this.transceivers.push(transceiver);
    this.senders.push(transceiver.sender);
    return transceiver as unknown as RTCRtpTransceiver;
  }

  getSenders(): RTCRtpSender[] {
    return this.senders as unknown as RTCRtpSender[];
  }

  getTransceivers(): RTCRtpTransceiver[] {
    return this.transceivers as unknown as RTCRtpTransceiver[];
  }

  async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    const sdp = options?.iceRestart ? 'v=0\r\no=mock-ice-restart\r\n' : 'v=0\r\no=mock-offer\r\n';
    return { type: 'offer', sdp };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0\r\no=mock-answer\r\n' };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.appliedIceCandidates.push(candidate);
  }

  restartIce(): void {
    this.restartIceCount += 1;
  }

  async getStats(): Promise<RTCStatsReport> {
    return this.mockStatsReport ?? (new Map() as unknown as RTCStatsReport);
  }

  close(): void {
    this.isClosed = true;
    this.connectionState = 'closed';
  }

  simulateConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    if (this.onconnectionstatechange) {
      this.onconnectionstatechange.call(this as unknown as RTCPeerConnection, new Event('connectionstatechange'));
    }
  }

  simulateIceConnectionState(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    if (this.oniceconnectionstatechange) {
      this.oniceconnectionstatechange.call(this as unknown as RTCPeerConnection, new Event('iceconnectionstatechange'));
    }
  }
}

type EventCallback = (...args: unknown[]) => void;

export class FakeSocket {
  listeners: Map<string, Set<EventCallback>> = new Map();
  emitted: { event: string; data: unknown }[] = [];

  on(event: string, callback: EventCallback): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return this;
  }

  off(event: string, callback?: EventCallback): this {
    if (!callback) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(callback);
    }
    return this;
  }

  once(event: string, callback: EventCallback): this {
    const wrapped: EventCallback = (...args: unknown[]) => {
      this.off(event, wrapped);
      callback(...args);
    };
    return this.on(event, wrapped);
  }

  emit(event: string, data?: unknown): boolean {
    this.emitted.push({ event, data });
    return true;
  }

  simulateEvent(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of [...callbacks]) {
        cb(...args);
      }
    }
  }

  getEmissions(eventName: string): unknown[] {
    return this.emitted.filter((e) => e.event === eventName).map((e) => e.data);
  }
}

export function createMockStatsReport(entries: Record<string, unknown>[]): RTCStatsReport {
  const map = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const id = (entry.id as string) || `id-${Math.random()}`;
    map.set(id, { ...entry, id });
  }
  return map as unknown as RTCStatsReport;
}

export function installRtcGlobals(): () => void {
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalRTCSessionDescription = globalThis.RTCSessionDescription;
  const originalRTCIceCandidate = globalThis.RTCIceCandidate;
  const originalRTCRtpSender = globalThis.RTCRtpSender;
  const originalMediaStream = globalThis.MediaStream;
  const originalMediaStreamTrack = globalThis.MediaStreamTrack;

  globalThis.RTCPeerConnection = FakeRTCPeerConnection as unknown as typeof RTCPeerConnection;
  globalThis.RTCSessionDescription = class {
    type: RTCSdpType;
    sdp: string;
    constructor(init: RTCSessionDescriptionInit) {
      this.type = init.type;
      this.sdp = init.sdp ?? '';
    }
    toJSON() {
      return { type: this.type, sdp: this.sdp };
    }
  } as unknown as typeof RTCSessionDescription;

  globalThis.RTCIceCandidate = class {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
    constructor(init: RTCIceCandidateInit) {
      this.candidate = init.candidate ?? '';
      this.sdpMid = init.sdpMid ?? null;
      this.sdpMLineIndex = init.sdpMLineIndex ?? null;
    }
    toJSON() {
      return { candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex };
    }
  } as unknown as typeof RTCIceCandidate;

  (globalThis.RTCRtpSender as unknown) = {
    getCapabilities: (kind: string) => {
      if (kind === 'video') {
        return {
          codecs: [
            { mimeType: 'video/VP8', clockRate: 90000 },
            {
              mimeType: 'video/H264',
              clockRate: 90000,
              sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
            },
            {
              mimeType: 'video/H264',
              clockRate: 90000,
              sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032',
            },
            { mimeType: 'video/VP9', clockRate: 90000 },
          ],
          headerExtensions: [],
        };
      }
      return { codecs: [], headerExtensions: [] };
    },
  };

  globalThis.MediaStream = FakeMediaStream as unknown as typeof MediaStream;
  globalThis.MediaStreamTrack = FakeMediaStreamTrack as unknown as typeof MediaStreamTrack;

  return () => {
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.RTCSessionDescription = originalRTCSessionDescription;
    globalThis.RTCIceCandidate = originalRTCIceCandidate;
    globalThis.RTCRtpSender = originalRTCRtpSender;
    globalThis.MediaStream = originalMediaStream;
    globalThis.MediaStreamTrack = originalMediaStreamTrack;
    FakeRTCPeerConnection.instances = [];
  };
}
