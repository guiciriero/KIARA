/**
 * e2ee.ts
 * Liga a criptografia de ponta a ponta (Insertable Streams) aos senders e receivers de um
 * RTCPeerConnection. A cifra em si fica em utils/e2eeCrypto.ts e roda no worker.
 */

/** O que o WebRTCBroadcaster e o WebRTCViewer precisam de uma sessão E2EE */
export interface E2eeTransform {
  protectSender(sender: RTCRtpSender): void;
  protectReceiver(receiver: RTCRtpReceiver): void;
  destroy(): void;
}

/** true se o navegador tem RTCRtpScriptTransform, Worker e crypto.subtle (contexto seguro) */
export function isE2eeSupported(): boolean {
  return (
    typeof RTCRtpScriptTransform !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof globalThis.crypto?.subtle !== 'undefined'
  );
}

/**
 * Uma sessão = um worker + uma chave de mídia. O dono (broadcaster ou viewer) chama `destroy()`
 * ao encerrar. Sem suporte do navegador, o construtor FALHA: a transmissão nunca segue sem cifra.
 */
export class E2eeSession implements E2eeTransform {
  private worker: Worker | null;

  constructor(private readonly key: CryptoKey) {
    if (!isE2eeSupported()) {
      throw new Error('Este navegador não suporta criptografia de ponta a ponta (RTCRtpScriptTransform).');
    }
    this.worker = new Worker(new URL('../workers/e2ee.worker.ts', import.meta.url), {
      type: 'module',
      name: 'kiara-e2ee',
    });
  }

  private transformFor(mode: 'encrypt' | 'decrypt'): RTCRtpScriptTransform {
    if (!this.worker) throw new Error('Sessão E2EE encerrada.');
    return new RTCRtpScriptTransform(this.worker, { mode, key: this.key });
  }

  protectSender(sender: RTCRtpSender): void {
    if (sender.transform) return;
    sender.transform = this.transformFor('encrypt');
  }

  protectReceiver(receiver: RTCRtpReceiver): void {
    if (receiver.transform) return;
    receiver.transform = this.transformFor('decrypt');
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
