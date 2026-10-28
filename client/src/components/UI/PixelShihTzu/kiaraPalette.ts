/**
 * kiaraPalette.ts — Paleta do shitzu aplicada em tempo de renderização.
 * Os frames de spriteData.ts usam as mesmas chaves de PALETTE; aqui definimos as cores finais:
 * corpo predominantemente marrom (a/f), com rosto e peito brancos/cremes (w/s), como o
 * shitzu real. Coleira e medalha ficam em tons de marrom/dourado.
 */

import { PALETTE } from './spriteData';

export const KIARA_PALETTE: Readonly<Record<string, string>> = {
  ...PALETTE,
};
