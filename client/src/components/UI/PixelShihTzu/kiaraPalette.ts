/**
 * kiaraPalette.ts — Paleta do shitzu aplicada em tempo de renderização.
 * Os arquivos originais do sprite (spriteData.ts, liveSceneData.ts) ficam intactos:
 * aqui só trocamos as cores azuis/índigo (coleira, medalha) por marrom/caramelo, o laço fica vermelho
 * e aquecemos levemente o branco/cinza da pelagem para o creme da interface.
 * As mesmas chaves de PALETTE são mantidas, então nenhum frame precisa mudar.
 */

import { PALETTE } from './spriteData';

export const KIARA_PALETTE: Readonly<Record<string, string>> = {
  ...PALETTE,
  w: '#FBF7F1', // pelagem branca (creme de destaque)
  s: '#D9CBB8', // sombra da pelagem (creme escuro)
  a: '#C98A52', // caramelo (orelhas/manchas/rabo)
  f: '#DDA06A', // caramelo claro
  m: '#6E4326', // marrom escuro das orelhas
  n: '#1A120C', // nariz/boca/olho (espresso)
  c: '#8A5A34', // coleira (era índigo) → caramelo profundo
  r: '#C23B34', // laço vermelho
  t: '#DDA06A', // medalha (era azul) → caramelo claro
  l: '#D9695A', // língua (quente)
};
