/**
 * kiaraPalette.ts — Paleta do shitzu aplicada em tempo de renderização.
 * Os frames de spriteData.ts usam as mesmas chaves de PALETTE; aqui definimos as cores finais:
 * corpo predominantemente marrom (a/f), com rosto e peito brancos/cremes (w/s), como o
 * shitzu real. Coleira e medalha ficam em tons de marrom/dourado.
 */

import { PALETTE } from './spriteData';

export const KIARA_PALETTE: Readonly<Record<string, string>> = {
  ...PALETTE,
  w: '#FBF7F1', // pelagem branca (rosto e peito)
  s: '#D9CBB8', // sombra da pelagem branca (creme escuro)
  a: '#B97A45', // marrom (corpo, rabo, patas e mancha do rosto)
  f: '#8F5A2E', // marrom escuro (sombra do corpo)
  m: '#4F3B30', // marrom bem escuro das orelhas
  n: '#1A120C', // nariz/boca (espresso)
  e: '#1A120C', // olho
  c: '#5B3A22', // coleira
  t: '#E2B04F', // medalha dourada
  l: '#D9695A', // língua (quente)
};
