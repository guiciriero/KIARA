/**
 * pixelRender.ts — Conversão de frames em pixel art (strings) para ImageData.
 * Cada caractere (exceto '.') mapeia para uma cor da paleta; '.' = transparente.
 */

const parseHex = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const rowsToImageData = (
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  w: number,
  h: number,
  palette: Readonly<Record<string, string>>,
): ImageData => {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = palette[rows[y][x]];
      if (!color) continue;
      const [r, g, b] = parseHex(color);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  return img;
};
