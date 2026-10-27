import { describe, it, expect, vi } from 'vitest';
import { deriveE2eeKeys, FrameCipher, createFrameTransform, E2EE_VERSION } from './e2eeCrypto';

// Poucas iterações: o teste valida a estrutura, não o custo do PBKDF2 de produção
const FAST = 1000;
/** Mesmo formato que o validador do servidor aceita (server/src/utils/validators.ts) */
const SERVER_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;
const toArray = (buf: ArrayBuffer): number[] => Array.from(new Uint8Array(buf));

describe('deriveE2eeKeys', () => {
  it('gera um token de entrada de 43 caracteres base64url, aceito pelo servidor', async () => {
    const { entryToken } = await deriveE2eeKeys('senha-forte-123', 'ABC234', FAST);
    expect(entryToken).toMatch(SERVER_TOKEN);
  });

  it('é determinístico: mesma senha e mesma sala geram o mesmo token', async () => {
    const a = await deriveE2eeKeys('senha-forte-123', 'ABC234', FAST);
    const b = await deriveE2eeKeys('senha-forte-123', 'ABC234', FAST);
    expect(a.entryToken).toBe(b.entryToken);
  });

  it('senha ou sala diferentes geram tokens diferentes', async () => {
    const base = await deriveE2eeKeys('senha-forte-123', 'ABC234', FAST);
    const otherPassword = await deriveE2eeKeys('senha-forte-124', 'ABC234', FAST);
    const otherRoom = await deriveE2eeKeys('senha-forte-123', 'ABC235', FAST);
    expect(otherPassword.entryToken).not.toBe(base.entryToken);
    expect(otherRoom.entryToken).not.toBe(base.entryToken);
  });

  it('normaliza maiúsculas e espaços do código da sala', async () => {
    const a = await deriveE2eeKeys('senha-forte-123', 'abc234', FAST);
    const b = await deriveE2eeKeys('senha-forte-123', ' ABC234 ', FAST);
    expect(a.entryToken).toBe(b.entryToken);
  });

  it('a chave de mídia não é extraível e não tem relação com o token', async () => {
    const { mediaKey, entryToken } = await deriveE2eeKeys('senha-forte-123', 'ABC234', FAST);
    expect(mediaKey.extractable).toBe(false);
    expect(mediaKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', mediaKey)).rejects.toThrow();

    // O token não decifra o que a chave de mídia cifrou (são derivações HKDF independentes)
    const raw = Uint8Array.from(atob(entryToken.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0));
    const tokenAsKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const sealed = await new FrameCipher(mediaKey).encrypt(bytes(1, 2, 3));
    await expect(new FrameCipher(tokenAsKey).decrypt(sealed)).rejects.toThrow();
  });

  it('a versão do esquema faz parte da derivação', () => {
    expect(E2EE_VERSION).toBe(1);
  });
});

describe('FrameCipher', () => {
  async function keyFor(password: string) {
    return (await deriveE2eeKeys(password, 'ABC234', FAST)).mediaKey;
  }

  it('cifra e decifra com a mesma chave (IV de 12 bytes na frente, tag de 16 no fim)', async () => {
    const key = await keyFor('senha-forte-123');
    const sender = new FrameCipher(key);
    const receiver = new FrameCipher(key);
    const plain = bytes(10, 20, 30, 40, 50);

    const sealed = await sender.encrypt(plain);
    expect(sealed.byteLength).toBe(12 + 5 + 16);
    expect(toArray(sealed).slice(12, 17)).not.toEqual([10, 20, 30, 40, 50]);
    expect(toArray(await receiver.decrypt(sealed))).toEqual([10, 20, 30, 40, 50]);
  });

  it('com chave diferente a decifração falha (OperationError)', async () => {
    const sealed = await new FrameCipher(await keyFor('senha-forte-123')).encrypt(bytes(1, 2, 3));
    await expect(new FrameCipher(await keyFor('outra-senha-456')).decrypt(sealed)).rejects.toThrow();
  });

  it('quadro adulterado ou menor que IV + tag é rejeitado', async () => {
    const key = await keyFor('senha-forte-123');
    const cipher = new FrameCipher(key);
    const sealed = new Uint8Array(await cipher.encrypt(bytes(1, 2, 3)));
    sealed[14] ^= 0xff;
    await expect(cipher.decrypt(sealed.buffer)).rejects.toThrow();
    await expect(cipher.decrypt(bytes(1, 2, 3))).rejects.toThrow('menor');
  });

  it('IV = prefixo aleatório + contador de 48 bits que nunca se repete', async () => {
    const key = await keyFor('senha-forte-123');
    const prefix = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const cipher = new FrameCipher(key, prefix);

    const first = cipher.nextIv();
    const second = cipher.nextIv();
    expect(Array.from(first.slice(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(first.slice(6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(second.slice(6))).toEqual([0, 0, 0, 0, 0, 1]);

    // Passa do limite de 32 bits sem repetir
    (cipher as unknown as { counter: number }).counter = 2 ** 32 - 1;
    expect(Array.from(cipher.nextIv().slice(6))).toEqual([0, 0, 0xff, 0xff, 0xff, 0xff]);
    expect(Array.from(cipher.nextIv().slice(6))).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('dois cifradores (duas transformações) têm prefixos diferentes', async () => {
    const key = await keyFor('senha-forte-123');
    const a = new FrameCipher(key).nextIv();
    const b = new FrameCipher(key).nextIv();
    expect(Array.from(a.slice(0, 6))).not.toEqual(Array.from(b.slice(0, 6)));
  });

  it('o contador esgotado falha em vez de reaproveitar o IV', async () => {
    const cipher = new FrameCipher(await keyFor('senha-forte-123'));
    (cipher as unknown as { counter: number }).counter = 2 ** 48;
    expect(() => cipher.nextIv()).toThrow('esgotado');
  });
});

describe('createFrameTransform', () => {
  async function setup() {
    const key = (await deriveE2eeKeys('senha-forte-123', 'ABC234', FAST)).mediaKey;
    const wrong = (await deriveE2eeKeys('outra-senha-456', 'ABC234', FAST)).mediaKey;
    return { key, wrong };
  }

  it('cifra no remetente e decifra no receptor, preservando o quadro', async () => {
    const { key } = await setup();
    const out: { data: ArrayBuffer }[] = [];
    const controller = { enqueue: (f: { data: ArrayBuffer }) => out.push(f) };

    const encrypt = createFrameTransform(new FrameCipher(key), 'encrypt');
    const decrypt = createFrameTransform(new FrameCipher(key), 'decrypt');
    const frame = { data: bytes(7, 8, 9) };
    await encrypt(frame, controller);
    expect(out).toHaveLength(1);
    expect(out[0].data.byteLength).toBe(12 + 3 + 16);

    await decrypt(out[0], controller);
    expect(out).toHaveLength(2);
    expect(toArray(out[1].data)).toEqual([7, 8, 9]);
  });

  it('chave errada: o quadro é descartado e onDrop é chamado (nunca repassado)', async () => {
    const { key, wrong } = await setup();
    const enqueue = vi.fn();
    const onDrop = vi.fn();
    const sealed = { data: await new FrameCipher(key).encrypt(bytes(1, 2, 3)) };

    await createFrameTransform(new FrameCipher(wrong), 'decrypt', onDrop)(sealed, { enqueue });
    expect(enqueue).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('quadro em claro chegando a um receptor E2EE é descartado', async () => {
    const { key } = await setup();
    const enqueue = vi.fn();
    const onDrop = vi.fn();
    await createFrameTransform(new FrameCipher(key), 'decrypt', onDrop)({ data: bytes(1, 2, 3, 4) }, { enqueue });
    expect(enqueue).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
