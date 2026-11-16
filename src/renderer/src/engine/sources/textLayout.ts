/**
 * Text layout and measurement, free of any dependency on the content library so that template
 * code can measure text while the library is still loading.
 */

import type { TextStyle } from '@/core/types';
import { cssFamily, nearestWeight } from '@/library/fonts';
import { ctx2d, makeCanvas, type Ctx2D } from './raster';

export function fontString(style: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'italic'>, px: number): string {
  const weight = nearestWeight(style.fontFamily, style.fontWeight);
  return `${style.italic ? 'italic ' : ''}${weight} ${px}px ${cssFamily(style.fontFamily)}`;
}

export interface Line {
  text: string;
  /** Left edge inside the block. */
  x: number;
  /** Baseline inside the block. */
  y: number;
  width: number;
}

export interface Layout {
  fontPx: number;
  lines: Line[];
  blockW: number;
  blockH: number;
  ascent: number;
  descent: number;
  lineH: number;
  /** Horizontal extent actually covered by glyphs. */
  inkLeft: number;
  inkRight: number;
}

let measureCtx: Ctx2D | null = null;
export const getMeasureCtx = (): Ctx2D => (measureCtx ??= ctx2d(makeCanvas(8, 8)));

export function applyFont(ctx: Ctx2D, style: TextStyle, fontPx: number): void {
  ctx.font = fontString(style, fontPx);
  ctx.letterSpacing = `${style.letterSpacing * fontPx}px`;
  ctx.fontKerning = 'normal';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

const displayText = (style: TextStyle): string => (style.uppercase ? style.content.toUpperCase() : style.content);

export function layoutText(style: TextStyle, rs: number): Layout {
  const ctx = getMeasureCtx();
  const fontPx = Math.max(1, style.fontSize * rs);
  applyFont(ctx, style, fontPx);
  const ls = style.letterSpacing * fontPx;
  const widthOf = (s: string): number => (s.length === 0 ? 0 : Math.max(0, ctx.measureText(s).width - ls));
  const maxW = style.boxWidth && style.boxWidth > 0 ? style.boxWidth * rs : Infinity;

  const rawLines: string[] = [];
  for (const para of displayText(style).split('\n')) {
    if (!Number.isFinite(maxW) || widthOf(para) <= maxW) {
      rawLines.push(para);
      continue;
    }
    let current = '';
    for (const word of para.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && widthOf(candidate) > maxW) {
        rawLines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    rawLines.push(current);
  }

  const m = ctx.measureText('Hg');
  const ascent = m.fontBoundingBoxAscent || fontPx * 0.9;
  const descent = m.fontBoundingBoxDescent || fontPx * 0.25;
  const lineH = Math.max(1, style.lineHeight * fontPx);
  const widths = rawLines.map(widthOf);
  const maxLine = Math.max(1, ...widths);
  const blockW = Number.isFinite(maxW) ? Math.max(maxW, maxLine) : maxLine;
  const blockH = lineH * rawLines.length;
  let inkLeft = blockW;
  let inkRight = 0;
  const lines: Line[] = rawLines.map((text, i) => {
    const width = widths[i];
    const x = style.align === 'left' ? 0 : style.align === 'right' ? blockW - width : (blockW - width) / 2;
    inkLeft = Math.min(inkLeft, x);
    inkRight = Math.max(inkRight, x + width);
    return { text, x, y: i * lineH + (lineH - (ascent + descent)) / 2 + ascent, width };
  });
  if (inkRight <= inkLeft) {
    inkLeft = 0;
    inkRight = blockW;
  }
  return { fontPx, lines, blockW, blockH, ascent, descent, lineH, inkLeft, inkRight };
}

export interface TextMetrics {
  /** Width of the layout box (the wrap width when `boxWidth` is set). */
  width: number;
  /** Total height of all lines. */
  height: number;
  /** Width actually covered by glyphs (widest line). */
  inkWidth: number;
  lines: number;
}

/** Measure the natural size (design px) of a text style without rasterising it. */
export function measureTextBlock(style: TextStyle): TextMetrics {
  const layout = layoutText(style, 1);
  return { width: layout.blockW, height: layout.blockH, inkWidth: Math.max(0, layout.inkRight - layout.inkLeft), lines: layout.lines.length };
}
