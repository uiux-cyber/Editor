/**
 * Video scope analysis of an RGBA8 frame (top row first): luma waveform, RGB parade,
 * vectorscope (Rec.709 Cb/Cr) and histograms. Pure and allocation-light so it can run at the
 * preview's scope refresh rate on the main thread.
 */

export interface ScopeData {
  /** Source frame size. */
  width: number;
  height: number;
  pixels: number;
  /** Waveform columns; each column has 256 luma bins (index = column * 256 + level). */
  columns: number;
  waveform: Uint32Array;
  /** RGB parade: three waveforms (R, G, B), each `columns` × 256. */
  parade: Uint32Array;
  /** Vectorscope bins (size × size, row 0 = +Cr at the top, column 0 = −Cb at the left). */
  vectorSize: number;
  vector: Uint32Array;
  histogram: { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array };
}

export interface ScopeOptions {
  /** Waveform / parade columns (default: min(width, 256)). */
  columns?: number;
  /** Vectorscope resolution (default 256). */
  vectorSize?: number;
  /** Chroma (Cb / Cr) shown from the centre to the edge of the vectorscope (default 0.6). */
  vectorRange?: number;
}

export const DEFAULT_VECTOR_RANGE = 0.6;

// Rec.709 luma and chroma, scaled for 8-bit input.
const KR = 0.2126;
const KG = 0.7152;
const KB = 0.0722;
const CB = 1 / (2 * (1 - KB));
const CR = 1 / (2 * (1 - KR));

export function computeScopes(px: Uint8Array | Uint8ClampedArray, width: number, height: number, opts: ScopeOptions = {}, reuse?: ScopeData): ScopeData {
  const columns = Math.max(1, Math.min(opts.columns ?? Math.min(width, 256), width));
  const vs = opts.vectorSize ?? 256;
  const fits = reuse && reuse.columns === columns && reuse.vectorSize === vs;
  const data: ScopeData = fits
    ? reuse
    : {
        width,
        height,
        pixels: 0,
        columns,
        waveform: new Uint32Array(columns * 256),
        parade: new Uint32Array(columns * 256 * 3),
        vectorSize: vs,
        vector: new Uint32Array(vs * vs),
        histogram: { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) },
      };
  if (fits) {
    data.waveform.fill(0);
    data.parade.fill(0);
    data.vector.fill(0);
    data.histogram.r.fill(0);
    data.histogram.g.fill(0);
    data.histogram.b.fill(0);
    data.histogram.l.fill(0);
  }
  data.width = width;
  data.height = height;
  data.pixels = width * height;

  const { waveform, parade, vector, histogram } = data;
  const plane = columns * 256;
  const vmax = vs - 1;
  const vk = 1 / (2 * (opts.vectorRange ?? DEFAULT_VECTOR_RANGE));
  const colOf = new Uint32Array(width);
  for (let x = 0; x < width; x++) colOf[x] = Math.min(columns - 1, Math.floor((x * columns) / width));

  for (let y = 0; y < height; y++) {
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const yf = KR * r + KG * g + KB * b;
      const l = Math.min(255, Math.round(yf));
      const col = colOf[x] * 256;
      waveform[col + l]++;
      parade[col + r]++;
      parade[plane + col + g]++;
      parade[2 * plane + col + b]++;
      histogram.r[r]++;
      histogram.g[g]++;
      histogram.b[b]++;
      histogram.l[l]++;
      // Cb / Cr (-0.5..0.5) → bins; +Cr is up.
      const cb = ((b - yf) * CB) / 255;
      const cr = ((r - yf) * CR) / 255;
      const vx = Math.min(vmax, Math.max(0, Math.floor((cb * vk + 0.5) * vmax + 0.5)));
      const vy = Math.min(vmax, Math.max(0, Math.floor((0.5 - cr * vk) * vmax + 0.5)));
      vector[vy * vs + vx]++;
    }
  }
  return data;
}

/** Vectorscope position (0..1, y down) of an RGB colour in 0..1. */
export function vectorPosition(r: number, g: number, b: number, range = DEFAULT_VECTOR_RANGE): [number, number] {
  const y = KR * r + KG * g + KB * b;
  const k = 1 / (2 * range);
  const cb = (b - y) * CB;
  const cr = (r - y) * CR;
  return [cb * k + 0.5, 0.5 - cr * k];
}
