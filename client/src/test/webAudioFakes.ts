/**
 * Fakes mínimos da Web Audio API para testes em ambiente `node`.
 * Rastreiam conexões, `stop()` e mensagens enviadas aos worklets.
 */

type Ctor = new (...args: never[]) => unknown;

export class FakeAudioParam {
  /** Último alvo pedido via setTargetAtTime */
  target = 1;
  readonly targets: number[] = [];

  setTargetAtTime(target: number): void {
    this.target = target;
    this.targets.push(target);
  }
}

export class FakeAudioNode {
  readonly connections = new Set<FakeAudioNode>();
  disconnectCount = 0;

  connect(dest: FakeAudioNode): FakeAudioNode {
    this.connections.add(dest);
    return dest;
  }

  disconnect(): void {
    this.connections.clear();
    this.disconnectCount++;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

export class FakeMessagePort {
  onmessage: unknown = null;
  closed = false;
  readonly messages: Array<{ data: unknown; transfer?: unknown[] }> = [];

  postMessage(data: unknown, transfer?: unknown[]): void {
    this.messages.push({ data, transfer });
  }

  close(): void {
    this.closed = true;
  }
}

export class FakeMediaStreamTrack {
  readonly kind = 'audio';
  readyState: 'live' | 'ended' = 'live';
  stopCount = 0;

  stop(): void {
    this.stopCount++;
    this.readyState = 'ended';
  }
}

export class FakeMediaStream {
  private readonly tracks: FakeMediaStreamTrack[];

  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.getTracks();
  }
}

export class FakeMediaStreamAudioDestinationNode extends FakeAudioNode {
  channelCount = 0;
  readonly stream = new FakeMediaStream([new FakeMediaStreamTrack()]);
}

export class FakeMediaStreamAudioSourceNode extends FakeAudioNode {
  constructor(readonly mediaStream: FakeMediaStream) {
    super();
  }
}

export class FakeAudioWorkletNode extends FakeAudioNode {
  readonly port = new FakeMessagePort();

  constructor(
    readonly context: FakeAudioContext,
    readonly name: string,
    readonly options?: unknown,
  ) {
    super();
    context.workletNodes.push(this);
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** Se definido, `audioWorklet.addModule` rejeita com esse erro */
  static addModuleError: Error | null = null;

  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  resumeCalls = 0;
  closeCalls = 0;
  /** Nó `ctx.destination` (alto-falante): nada deve ser conectado a ele */
  readonly destination = new FakeAudioNode();
  readonly gains: FakeGainNode[] = [];
  readonly workletNodes: FakeAudioWorkletNode[] = [];
  readonly sourceNodes: FakeMediaStreamAudioSourceNode[] = [];
  readonly destinations: FakeMediaStreamAudioDestinationNode[] = [];
  readonly audioWorklet = {
    addModule: async (): Promise<void> => {
      if (FakeAudioContext.addModuleError) throw FakeAudioContext.addModuleError;
    },
  };

  constructor(readonly options?: unknown) {
    FakeAudioContext.instances.push(this);
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createMediaStreamDestination(): FakeMediaStreamAudioDestinationNode {
    const node = new FakeMediaStreamAudioDestinationNode();
    this.destinations.push(node);
    return node;
  }

  createMediaStreamSource(stream: FakeMediaStream): FakeMediaStreamAudioSourceNode {
    const node = new FakeMediaStreamAudioSourceNode(stream);
    this.sourceNodes.push(node);
    return node;
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
  }
}

const GLOBALS = {
  AudioContext: FakeAudioContext,
  AudioWorkletNode: FakeAudioWorkletNode,
  MediaStream: FakeMediaStream,
  MediaStreamTrack: FakeMediaStreamTrack,
} as const;

/** Instala os fakes em `globalThis`; devolve a função que restaura o estado anterior. */
export function installWebAudioFakes(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, { had: boolean; value: unknown }>();

  FakeAudioContext.instances = [];
  FakeAudioContext.addModuleError = null;

  for (const [name, impl] of Object.entries(GLOBALS) as Array<[string, Ctor]>) {
    saved.set(name, { had: name in g, value: g[name] });
    g[name] = impl;
  }

  return () => {
    for (const [name, { had, value }] of saved) {
      if (had) g[name] = value;
      else delete g[name];
    }
    FakeAudioContext.instances = [];
    FakeAudioContext.addModuleError = null;
  };
}

/** Contexto mais recente criado (o do mixer sob teste). */
export function lastContext(): FakeAudioContext {
  const ctx = FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
  if (!ctx) throw new Error('Nenhum AudioContext fake foi criado');
  return ctx;
}

export function newFakeTrack(): FakeMediaStreamTrack {
  return new FakeMediaStreamTrack();
}
