import { describe, expect, it } from 'vitest';
import { createLimiter, RoomManager, SCRYPT_MAX_CONCURRENCY } from './roomManager';

/** Tarefa controlável: só termina quando resolve()/reject() é chamado */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('createLimiter', () => {
  it('nunca executa mais que `max` tarefas ao mesmo tempo e respeita a ordem FIFO', async () => {
    const limit = createLimiter(4);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const gates = Array.from({ length: 10 }, () => deferred());

    const results = gates.map((gate, i) =>
      limit(async () => {
        running += 1;
        peak = Math.max(peak, running);
        started.push(i);
        await gate.promise;
        running -= 1;
        return i;
      }),
    );

    await tick();
    expect(running).toBe(4);
    expect(started).toEqual([0, 1, 2, 3]);

    // Libera uma por vez: a próxima da fila entra, sem passar de 4
    for (let i = 0; i < 10; i++) {
      gates[i].resolve();
      await tick();
      expect(running).toBeLessThanOrEqual(4);
    }

    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(4);
    expect(running).toBe(0);
  });

  it('libera o slot mesmo quando a tarefa falha', async () => {
    const limit = createLimiter(1);
    const gate = deferred();
    const first = limit(async () => {
      await gate.promise;
      throw new Error('falhou');
    });
    const second = limit(async () => 'ok');

    await tick();
    gate.resolve();
    await expect(first).rejects.toThrow('falhou');
    await expect(second).resolves.toBe('ok');

    // Depois do erro, o limitador segue utilizável
    await expect(limit(async () => 'de novo')).resolves.toBe('de novo');
  });

  it('o limite padrão do scrypt é 4', () => {
    expect(SCRYPT_MAX_CONCURRENCY).toBe(4);
  });
});

describe('RoomManager (scrypt)', () => {
  it('cria sala com senha, valida a correta e recusa a errada, inclusive em paralelo', async () => {
    const rm = new RoomManager();
    try {
      const rooms = await Promise.all(
        Array.from({ length: 6 }, (_, i) => rm.createRoom(`host-${i}`, { password: 'senha-123' })),
      );
      const { room } = rooms[0];
      const checks = await Promise.all([
        rm.verifyPassword(room, 'senha-123'),
        rm.verifyPassword(room, 'errada'),
        rm.verifyPassword(room, undefined),
        rm.verifyPassword(rooms[5].room, 'senha-123'),
      ]);
      expect(checks).toEqual([true, false, false, true]);
    } finally {
      rm.clear();
    }
  });
});
