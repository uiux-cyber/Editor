/**
 * Canvas renderers for the video scopes. Scope densities are written into small ImageData
 * buffers (one texel per bin) and scaled into the plot with smoothing, then graticules and
 * labels are drawn on top at device resolution.
 */

import { vectorPosition, type ScopeData } from '@/engine/scopes/analyze';

const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d')!;

const GRID = 'rgba(255,255,255,0.075)';
const GRID_STRONG = 'rgba(255,255,255,0.16)';
const LABEL = 'rgba(200,206,220,0.55)';

function density(count: number, norm: number): number {
  if (count === 0) return 0;
  // Log response so faint detail stays visible next to dense areas.
  return Math.min(1, Math.log1p(count) / Math.log1p(norm));
}

function putBins(w: number, h: number, fill: (img: Uint8ClampedArray) => void): HTMLCanvasElement {
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const img = sctx.createImageData(w, h);
  fill(img.data);
  sctx.putImageData(img, 0, 0);
  return scratch;
}

export interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
}

function plotRect(cw: number, ch: number, dpr: number, leftPad: number): Plot {
  const pad = 6 * dpr;
  return { x: leftPad * dpr, y: pad, w: cw - leftPad * dpr - pad, h: ch - pad * 2 };
}

function levelGrid(ctx: CanvasRenderingContext2D, p: Plot, dpr: number): void {
  ctx.save();
  ctx.font = `${9 * dpr}px 'JetBrains Mono Variable', monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = Math.round(p.y + p.h - (pct / 100) * p.h) + 0.5;
    ctx.strokeStyle = pct === 0 || pct === 100 ? GRID_STRONG : GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, y);
    ctx.lineTo(p.x + p.w, y);
    ctx.stroke();
    ctx.fillStyle = LABEL;
    ctx.fillText(String(pct), p.x - 4 * dpr, y);
  }
  ctx.restore();
}

/** Luma waveform (mode 'luma') or RGB parade (mode 'parade'). */
export function drawWaveform(ctx: CanvasRenderingContext2D, cw: number, ch: number, dpr: number, d: ScopeData, mode: 'luma' | 'parade'): void {
  ctx.clearRect(0, 0, cw, ch);
  const p = plotRect(cw, ch, dpr, 26);
  const cols = d.columns;
  // Expected hits per bin for an even spread → normalisation.
  const norm = Math.max(4, d.height * 0.35);
  if (mode === 'luma') {
    const src = putBins(cols, 256, (img) => {
      for (let x = 0; x < cols; x++) {
        for (let l = 0; l < 256; l++) {
          const v = density(d.waveform[x * 256 + l], norm);
          if (!v) continue;
          const o = ((255 - l) * cols + x) * 4;
          img[o] = 150 + 105 * v;
          img[o + 1] = 230 + 25 * v;
          img[o + 2] = 210 + 45 * v;
          img[o + 3] = 255 * Math.min(1, v * 1.35);
        }
      }
    });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, p.x, p.y, p.w, p.h);
  } else {
    const gap = 2;
    const w = cols * 3 + gap * 2;
    const plane = cols * 256;
    const colors = [
      [255, 92, 92],
      [80, 230, 120],
      [90, 150, 255],
    ];
    const src = putBins(w, 256, (img) => {
      for (let c = 0; c < 3; c++) {
        const [r, g, b] = colors[c];
        const x0 = c * (cols + gap);
        for (let x = 0; x < cols; x++) {
          for (let l = 0; l < 256; l++) {
            const v = density(d.parade[c * plane + x * 256 + l], norm);
            if (!v) continue;
            const o = ((255 - l) * w + x0 + x) * 4;
            img[o] = r + (255 - r) * v * 0.45;
            img[o + 1] = g + (255 - g) * v * 0.45;
            img[o + 2] = b + (255 - b) * v * 0.45;
            img[o + 3] = 255 * Math.min(1, v * 1.35);
          }
        }
      }
    });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, p.x, p.y, p.w, p.h);
    // Separators between the three channels.
    ctx.strokeStyle = GRID_STRONG;
    for (let c = 1; c < 3; c++) {
      const x = Math.round(p.x + (p.w * (c * (cols + gap) - gap / 2)) / w) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, p.y);
      ctx.lineTo(x, p.y + p.h);
      ctx.stroke();
    }
  }
  levelGrid(ctx, p, dpr);
}

/** Colour of each vectorscope bin (its own chroma at mid luminance), cached per size / range. */
let binColors: { key: string; data: Uint8ClampedArray } | null = null;
function vectorColors(size: number, range: number): Uint8ClampedArray {
  const key = `${size}:${range}`;
  if (binColors?.key === key) return binColors.data;
  const data = new Uint8ClampedArray(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cb = ((x / (size - 1) - 0.5) * 2 * range) * 0.9;
      const cr = ((0.5 - y / (size - 1)) * 2 * range) * 0.9;
      const Y = 0.62;
      const r = Y + 1.5748 * cr;
      const b = Y + 1.8556 * cb;
      const g = Y - 0.187324 * cb - 0.468124 * cr;
      const o = (y * size + x) * 3;
      data[o] = Math.min(255, Math.max(60, r * 255));
      data[o + 1] = Math.min(255, Math.max(60, g * 255));
      data[o + 2] = Math.min(255, Math.max(60, b * 255));
    }
  }
  binColors = { key, data };
  return data;
}

const TARGETS: { label: string; rgb: [number, number, number] }[] = [
  { label: 'R', rgb: [0.75, 0, 0] },
  { label: 'Mg', rgb: [0.75, 0, 0.75] },
  { label: 'B', rgb: [0, 0, 0.75] },
  { label: 'Cy', rgb: [0, 0.75, 0.75] },
  { label: 'G', rgb: [0, 0.75, 0] },
  { label: 'Yl', rgb: [0.75, 0.75, 0] },
];

/** Skin-tone ("I") line angle on a vectorscope, degrees counter-clockwise from +Cb. */
export const SKIN_TONE_ANGLE = 123;

export function drawVectorscope(ctx: CanvasRenderingContext2D, cw: number, ch: number, dpr: number, d: ScopeData, range: number): void {
  ctx.clearRect(0, 0, cw, ch);
  const size = Math.min(cw, ch) - 12 * dpr;
  const x0 = (cw - size) / 2;
  const y0 = (ch - size) / 2;
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  const R = size / 2;

  // Graticule underneath.
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GRID_STRONG;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = GRID;
  for (const f of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.stroke();
  ctx.restore();

  // Trace.
  const vs = d.vectorSize;
  const colors = vectorColors(vs, range);
  const norm = Math.max(4, (d.pixels / (vs * vs)) * 40);
  const src = putBins(vs, vs, (img) => {
    for (let i = 0; i < vs * vs; i++) {
      const v = density(d.vector[i], norm);
      if (!v) continue;
      const o = i * 4;
      const c = i * 3;
      const k = 0.55 + 0.45 * v;
      img[o] = colors[c] * k + 255 * (1 - k) * v;
      img[o + 1] = colors[c + 1] * k + 255 * (1 - k) * v;
      img[o + 2] = colors[c + 2] * k + 255 * (1 - k) * v;
      img[o + 3] = 255 * Math.min(1, 0.25 + v);
    }
  });
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(src, x0, y0, size, size);
  ctx.restore();

  // Skin-tone line.
  const a = (SKIN_TONE_ANGLE * Math.PI) / 180;
  ctx.save();
  ctx.strokeStyle = 'rgba(251,191,36,0.55)';
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R);
  ctx.stroke();
  ctx.restore();

  // 75 % colour targets.
  ctx.save();
  ctx.font = `600 ${9 * dpr}px Inter Variable, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const box = 7 * dpr;
  for (const t of TARGETS) {
    const [px, py] = vectorPosition(t.rgb[0], t.rgb[1], t.rgb[2], range);
    if (px < 0 || px > 1 || py < 0 || py > 1) continue;
    const tx = x0 + px * size;
    const ty = y0 + py * size;
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.strokeRect(Math.round(tx - box / 2) + 0.5, Math.round(ty - box / 2) + 0.5, box, box);
    const dx = tx - cx;
    const dy = ty - cy;
    const len = Math.hypot(dx, dy) || 1;
    ctx.fillStyle = LABEL;
    ctx.fillText(t.label, tx + (dx / len) * 11 * dpr, ty + (dy / len) * 11 * dpr);
  }
  ctx.restore();
}

export function drawHistogram(ctx: CanvasRenderingContext2D, cw: number, ch: number, dpr: number, d: ScopeData): void {
  ctx.clearRect(0, 0, cw, ch);
  const p = plotRect(cw, ch, dpr, 8);
  const { r, g, b, l } = d.histogram;
  // Normalise to a high percentile so clipped spikes do not flatten everything else.
  const all: number[] = [];
  for (let i = 1; i < 255; i++) all.push(r[i], g[i], b[i]);
  all.sort((x, y) => x - y);
  const top = Math.max(1, all[Math.floor(all.length * 0.995)] * 1.1);

  ctx.save();
  ctx.strokeStyle = GRID;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const x = Math.round(p.x + f * p.w) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, p.y);
    ctx.lineTo(x, p.y + p.h);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  const area = (bins: Uint32Array, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + p.h);
    for (let i = 0; i < 256; i++) ctx.lineTo(p.x + (i / 255) * p.w, p.y + p.h - Math.min(1, bins[i] / top) * p.h);
    ctx.lineTo(p.x + p.w, p.y + p.h);
    ctx.closePath();
    ctx.fill();
  };
  area(r, 'rgba(255,70,80,0.55)');
  area(g, 'rgba(60,220,110,0.5)');
  area(b, 'rgba(70,130,255,0.6)');
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(240,244,250,0.8)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  for (let i = 0; i < 256; i++) {
    const x = p.x + (i / 255) * p.w;
    const y = p.y + p.h - Math.min(1, l[i] / top) * p.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Small histogram for the curves editor (one channel, or luma for the master curve). */
export function drawCurveHistogram(ctx: CanvasRenderingContext2D, cw: number, ch: number, bins: Uint32Array, color: string): void {
  ctx.clearRect(0, 0, cw, ch);
  let top = 1;
  const sorted = Array.from(bins.slice(1, 255)).sort((a, b) => a - b);
  top = Math.max(1, sorted[Math.floor(sorted.length * 0.99)] * 1.15);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, ch);
  for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * cw, ch - Math.min(1, bins[i] / top) * ch * 0.92);
  ctx.lineTo(cw, ch);
  ctx.closePath();
  ctx.fill();
}

