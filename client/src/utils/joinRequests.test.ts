import { describe, it, expect } from 'vitest';
import { addJoinRequest, removeJoinRequest } from './joinRequests';

describe('joinRequests', () => {
  const a = { viewerId: 'a', name: 'Ana' };
  const b = { viewerId: 'b', name: 'Beto' };

  it('adiciona em ordem e ignora duplicado', () => {
    const l1 = addJoinRequest([], a);
    const l2 = addJoinRequest(l1, b);
    expect(l2).toEqual([a, b]);
    expect(addJoinRequest(l2, a)).toBe(l2);
  });

  it('remove por viewerId e mantém a referência se não existir', () => {
    expect(removeJoinRequest([a, b], 'a')).toEqual([b]);
    const l = [a];
    expect(removeJoinRequest(l, 'x')).toBe(l);
    expect(removeJoinRequest(l, undefined)).toBe(l);
  });
});
