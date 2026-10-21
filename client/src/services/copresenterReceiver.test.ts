/**
 * copresenterReceiver.test.ts
 *
 * O Host recebe a tela do co-apresentador reaproveitando o WebRTCViewer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CopresenterReceiver,
  EMPTY_COPRESENTER_SNAPSHOT,
  type CopresenterSnapshot,
} from './copresenterReceiver';
import {
  FakeSocket,
  FakeMediaStream,
  FakeRTCPeerConnection,
  installRtcGlobals,
} from '../test/rtcFakes';

describe('CopresenterReceiver', () => {
  let restoreGlobals: () => void;
  let socket: FakeSocket;
  let snapshots: CopresenterSnapshot[];
  let receiver: CopresenterReceiver;

  beforeEach(() => {
    restoreGlobals = installRtcGlobals();
    socket = new FakeSocket();
    snapshots = [];
    receiver = new CopresenterReceiver(socket as unknown as never, [], (s) => snapshots.push(s));
  });

  afterEach(() => {
    receiver.destroy();
    restoreGlobals();
    vi.restoreAllMocks();
  });

  const last = () => snapshots[snapshots.length - 1];

  async function deliverOffer(senderId: string): Promise<void> {
    socket.simulateEvent('webrtc:offer', {
      senderId,
      offer: { type: 'offer', sdp: 'v=0\r\no=copresenter\r\n' },
    });
    await vi.waitFor(() => {
      expect(socket.getEmissions('webrtc:answer').length).toBeGreaterThan(0);
    });
  }

  function deliverStream(): MediaStream {
    const pc = FakeRTCPeerConnection.instances[FakeRTCPeerConnection.instances.length - 1];
    const stream = new FakeMediaStream([]) as unknown as MediaStream;
    pc.ontrack?.call(pc as unknown as RTCPeerConnection, { streams: [stream] } as unknown as RTCTrackEvent);
    return stream;
  }

  it('anuncia o co-apresentador assim que ele entra, ainda sem vídeo', () => {
    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-1', name: 'Ana' });

    expect(last()).toEqual({ copresenter: { id: 'cp-1', name: 'Ana' }, stream: null });
  });

  it('entrega a tela recebida e responde ao offer do co-apresentador', async () => {
    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-1', name: 'Ana' });
    await deliverOffer('cp-1');

    const answer = socket.getEmissions('webrtc:answer')[0] as { targetId: string };
    expect(answer.targetId).toBe('cp-1');

    const stream = deliverStream();
    expect(last()).toEqual({ copresenter: { id: 'cp-1', name: 'Ana' }, stream });
  });

  it('ignora offers de quem não é o co-apresentador', async () => {
    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-1', name: 'Ana' });
    socket.simulateEvent('webrtc:offer', {
      senderId: 'intruso',
      offer: { type: 'offer', sdp: 'v=0\r\no=intruso\r\n' },
    });

    await Promise.resolve();
    expect(socket.getEmissions('webrtc:answer')).toHaveLength(0);
    expect(FakeRTCPeerConnection.instances).toHaveLength(0);
  });

  it('limpa tela e conexão quando o co-apresentador sai', async () => {
    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-1', name: 'Ana' });
    await deliverOffer('cp-1');
    deliverStream();

    socket.simulateEvent('room:copresenter-left', { copresenterId: 'cp-1', name: 'Ana' });

    expect(last()).toEqual(EMPTY_COPRESENTER_SNAPSHOT);
    expect(FakeRTCPeerConnection.instances[0].isClosed).toBe(true);
  });

  it('saída de quem não ocupa a vaga não afeta o co-apresentador atual', () => {
    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-2', name: 'Bia' });
    const before = snapshots.length;

    socket.simulateEvent('room:copresenter-left', { copresenterId: 'cp-1', name: 'Ana' });

    expect(snapshots).toHaveLength(before);
    expect(last().copresenter?.id).toBe('cp-2');
  });

  it('troca de co-apresentador descarta a conexão anterior e o vídeo antigo', async () => {
    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-1', name: 'Ana' });
    await deliverOffer('cp-1');
    const oldPc = FakeRTCPeerConnection.instances[0];

    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-2', name: 'Bia' });
    expect(oldPc.isClosed).toBe(true);
    expect(last()).toEqual({ copresenter: { id: 'cp-2', name: 'Bia' }, stream: null });

    // Vídeo tardio da conexão antiga não pode reaparecer
    const staleStream = new FakeMediaStream([]) as unknown as MediaStream;
    const count = snapshots.length;
    oldPc.ontrack?.call(oldPc as unknown as RTCPeerConnection, { streams: [staleStream] } as unknown as RTCTrackEvent);
    expect(snapshots).toHaveLength(count);
  });

  it('destroy remove os ouvintes e encerra a conexão', async () => {
    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-1', name: 'Ana' });
    await deliverOffer('cp-1');

    receiver.destroy();
    const count = snapshots.length;
    socket.simulateEvent('room:copresenter-joined', { copresenterId: 'cp-3', name: 'Caio' });

    expect(snapshots).toHaveLength(count);
    expect(FakeRTCPeerConnection.instances[0].isClosed).toBe(true);
  });
});
