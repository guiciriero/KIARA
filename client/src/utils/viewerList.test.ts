import { describe, it, expect } from 'vitest';
import { addViewer, removeViewer, renameViewer } from './viewerList';

describe('viewerList utils', () => {
  it('adiciona espectador novo com nome padrão quando omitido', () => {
    const list = addViewer([], { id: 'v1' });
    expect(list).toEqual([{ id: 'v1', name: 'Espectador' }]);
  });

  it('adiciona espectador novo com apelido fornecido', () => {
    const list = addViewer([], { id: 'v1', name: 'Alice' });
    expect(list).toEqual([{ id: 'v1', name: 'Alice' }]);
  });

  it('atualiza espectador existente sem duplicar na lista', () => {
    const initial = [{ id: 'v1', name: 'Alice' }];
    const updated = addViewer(initial, { id: 'v1', name: 'Alice Silva' });
    expect(updated).toEqual([{ id: 'v1', name: 'Alice Silva' }]);
  });

  it('remove espectador pelo id', () => {
    const initial = [
      { id: 'v1', name: 'Alice' },
      { id: 'v2', name: 'Bob' },
    ];
    const updated = removeViewer(initial, 'v1');
    expect(updated).toEqual([{ id: 'v2', name: 'Bob' }]);
  });

  it('ignora remoção com id indefinido', () => {
    const initial = [{ id: 'v1', name: 'Alice' }];
    expect(removeViewer(initial, undefined)).toBe(initial);
  });

  it('renomeia espectador existente', () => {
    const initial = [
      { id: 'v1', name: 'Alice' },
      { id: 'v2', name: 'Bob' },
    ];
    const updated = renameViewer(initial, 'v2', 'Roberto');
    expect(updated).toEqual([
      { id: 'v1', name: 'Alice' },
      { id: 'v2', name: 'Roberto' },
    ]);
  });
});
