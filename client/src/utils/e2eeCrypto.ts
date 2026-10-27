/**
 * e2eeCrypto.ts
 * Criptografia de ponta a ponta da mídia (Insertable Streams). Só usa `crypto.subtle`, então roda
 * no navegador, no worker e no Node 22 (testes).
 *
 * Dois segredos saem da MESMA senha, e o servidor só enxerga um deles:
 *   senha --PBKDF2-SHA-256(sal = versão + código da sala)--> 32 bytes --HKDF--> chave de mídia AES-GCM
 *                                                                          \--> token de entrada
 * O token de entrada vai no campo `password` do Socket.IO (o servidor guarda um hash scrypt dele).
 * A chave de mídia é uma CryptoKey NÃO extraível e nunca sai do navegador. Como os dois vêm de
 * `info` diferentes do HKDF, o token não revela a chave.
 *
 * Limites (ver README): a força é a da senha. Quem tiver o token pode tentar força bruta offline
 * na senha. Não há rotação de chave.
 */

/** Versão do esquema de derivação (entra no sal; mudar invalida todas as salas E2EE antigas) */
export const E2EE_VERSION = 1;
/** Iterações do PBKDF2-SHA-256 (recomendação OWASP 2023 para SHA-256) */
export const E2EE_PBKDF2_ITERATIONS = 600_000;

const IV_BYTES = 12;
const TAG_BYTES = 16;
/** 6 bytes aleatórios por transformação + contador de 48 bits: o IV nunca se repete com a mesma chave */
const IV_PREFIX_BYTES = 6;
const COUNTER_LIMIT = 2 ** 48;

export interface E2eeKeys {
  /** Chave AES-GCM de 256 bits, não extraível */
  mediaKey: CryptoKey;
  /** 32 bytes em base64url (43 caracteres): vai no campo `password` do servidor */
  entryToken: string;
}

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sal do PBKDF2: versão + código da sala (a mesma senha gera chaves diferentes em salas diferentes) */
function saltFor(roomCode: string): Uint8Array<ArrayBuffer> {
  return utf8(`kiara-e2ee-v${E2EE_VERSION}:${roomCode.trim().toUpperCase()}`);
}

/** Deriva a chave de mídia e o token de entrada a partir da senha e do código da sala */
export async function deriveE2eeKeys(
  password: string,
  roomCode: string,
  iterations: number = E2EE_PBKDF2_ITERATIONS,
): Promise<E2eeKeys> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Este navegador não oferece criptografia (crypto.subtle). Use HTTPS ou localhost.');

  const passwordKey = await subtle.importKey('raw', utf8(password.normalize('NFKC')), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const master = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltFor(roomCode), iterations },
    passwordKey,
    256,
  );

  const hkdfKey = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hkdf = (purpose: string): HkdfParams => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: utf8(`kiara-e2ee-v${E2EE_VERSION}/${purpose}`),
  });

  const mediaKey = await subtle.deriveKey(hkdf('media'), hkdfKey, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const tokenBits = await subtle.deriveBits(hkdf('entry'), hkdfKey, 256);

  return { mediaKey, entryToken: toBase64Url(new Uint8Array(tokenBits)) };
}

/**
 * Cifra e decifra o payload INTEIRO de um quadro codificado (sem cabeçalho em claro). O resultado
 * é `IV (12 bytes) + texto cifrado + tag GCM (16 bytes)`. Medido no Chrome 156: funciona com VP9,
 * VP8 e Opus; AV1 e H.264 falham, por isso a sala E2EE só negocia VP9/VP8.
 */
export class FrameCipher {
  private readonly prefix: Uint8Array;
  private counter = 0;

  constructor(
    private readonly key: CryptoKey,
    /** Só para testes: prefixo fixo */
    prefix?: Uint8Array,
  ) {
    this.prefix = prefix ?? globalThis.crypto.getRandomValues(new Uint8Array(IV_PREFIX_BYTES));
  }

  /** Próximo IV: prefixo aleatório (6 bytes) + contador de 48 bits em big-endian */
  nextIv(): Uint8Array<ArrayBuffer> {
    if (this.counter >= COUNTER_LIMIT) throw new Error('Contador de IV esgotado: reconecte para gerar um novo prefixo.');
    const iv = new Uint8Array(IV_BYTES);
    iv.set(this.prefix, 0);
    const view = new DataView(iv.buffer);
    view.setUint16(IV_PREFIX_BYTES, Math.floor(this.counter / 2 ** 32));
    view.setUint32(IV_PREFIX_BYTES + 2, this.counter % 2 ** 32);
    this.counter += 1;
    return iv;
  }

  async encrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    const iv = this.nextIv();
    const cipher = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, data);
    const out = new Uint8Array(IV_BYTES + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), IV_BYTES);
    return out.buffer;
  }

  async decrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    if (data.byteLength < IV_BYTES + TAG_BYTES) throw new Error('Quadro menor que IV + tag.');
    const iv = new Uint8Array(data, 0, IV_BYTES);
    return globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, data.slice(IV_BYTES));
  }
}

/** Parte do RTCEncodedVideoFrame/RTCEncodedAudioFrame de que a cifra precisa */
export interface EncodedFrameLike {
  data: ArrayBuffer;
}

export type FrameTransformMode = 'encrypt' | 'decrypt';

/**
 * Função de `TransformStream` que cifra ou decifra cada quadro. Na decifração, quadro que não
 * autentica (chave errada, adulterado, não cifrado) é DESCARTADO, nunca repassado, e `onDrop` avisa.
 */
export function createFrameTransform(
  cipher: FrameCipher,
  mode: FrameTransformMode,
  onDrop?: (error: unknown) => void,
): (frame: EncodedFrameLike, controller: { enqueue(frame: EncodedFrameLike): void }) => Promise<void> {
  return async (frame, controller) => {
    try {
      frame.data = mode === 'encrypt' ? await cipher.encrypt(frame.data) : await cipher.decrypt(frame.data);
    } catch (err) {
      // Cifrar nunca deve falhar; se falhar, não deixa sair quadro em claro
      onDrop?.(err);
      return;
    }
    controller.enqueue(frame);
  };
}
