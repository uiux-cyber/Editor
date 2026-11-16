/**
 * Count-up numbers in the text rasteriser. The counter's value replaces the clip's content, and
 * the digits are laid out in fixed-width cells (tabular figures, emulated because canvas text has
 * no `font-variant-numeric`) inside a block as wide as the widest value the counter can show —
 * so the layer never jitters or resizes while it counts. Used by text.ts (preview and export).
 */

import { counterProgress, counterTemplate, counterTextAt } from '@/core/counter';
import type { TextClip, TextStyle } from '@/core/types';
import { applyFont, getMeasureCtx, type Layout, type Line } from './textLayout';

export interface CounterFrame {
  /** The clip's style with the value at this time as its content. */
  style: TextStyle;
  /** Widest string the counter can show (see counterTemplate). */
  template: string;
  /** True while the value is still changing (the raster changes every frame). */
  moving: boolean;
}

/** The counter state of a text clip at clip-local time `t`, or null when it has no counter. */
export function counterFrame(clip: TextClip, t: number): CounterFrame | null {
  const c = clip.counter;
  if (!c) return null;
  return {
    style: { ...clip.text, content: counterTextAt(clip, t) ?? '' },
    template: counterTemplate(c),
    moving: counterProgress(c, clip.duration, t) < 1,
  };
}

interface Tabular {
  /** Draw runs: maximal non-digit strings and single digits, with their x inside the line. */
  runs: { text: string; x: number }[];
  /** x at which each UTF-16 index of the line is drawn (length + 1 entries; the last is the end). */
  pos: number[];
  width: number;
}

const tabularByLine = new WeakMap<Line, Tabular>();
const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

/**
 * Re-lay `layout` (from layoutText, same style and scale) with tabular digits and the stable
 * block width of the counter's template. Returns the same layout; a no-op without a counter.
 */
export function fitCounterLayout(layout: Layout, style: TextStyle, frame: CounterFrame | null): Layout {
  if (!frame) return layout;
  const ctx = getMeasureCtx();
  applyFont(ctx, style, layout.fontPx);
  const ls = style.letterSpacing * layout.fontPx;
  let cell = 0;
  for (let d = 0; d <= 9; d++) cell = Math.max(cell, ctx.measureText(String(d)).width);

  const measure = (text: string): Tabular => {
    const runs: Tabular['runs'] = [];
    const pos: number[] = [];
    let x = 0;
    let buf = '';
    let bufStart = 0;
    const flush = (): void => {
      if (!buf) return;
      runs.push({ text: buf, x });
      for (let i = 0; i < buf.length; i++) pos[bufStart + i] = x + (i === 0 ? 0 : ctx.measureText(buf.slice(0, i)).width);
      x += ctx.measureText(buf).width;
      buf = '';
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (isDigit(ch)) {
        flush();
        const dx = x + (cell - ctx.measureText(ch).width) / 2;
        runs.push({ text: ch, x: dx });
        pos[i] = dx;
        x += cell;
      } else {
        if (!buf) bufStart = i;
        buf += ch;
      }
    }
    flush();
    pos[text.length] = x;
    return { runs, pos, width: Math.max(0, x - ls) };
  };

  const displayTemplate = style.uppercase ? frame.template.toUpperCase() : frame.template;
  const stable = measure(displayTemplate).width;
  const tabs = layout.lines.map((l) => measure(l.text));
  const rs = layout.fontPx / Math.max(1e-6, style.fontSize);
  const wrapW = style.boxWidth && style.boxWidth > 0 ? style.boxWidth * rs : 0;
  const blockW = Math.max(1, wrapW, stable, ...tabs.map((t) => t.width));
  // The ink span covers the widest value too, so a background box or a gradient fill keeps its
  // size while the digits change.
  const templateX = style.align === 'left' ? 0 : style.align === 'right' ? blockW - stable : (blockW - stable) / 2;
  let inkLeft = Math.min(blockW, templateX);
  let inkRight = templateX + stable;
  layout.lines.forEach((line, i) => {
    const tab = tabs[i];
    line.width = tab.width;
    line.x = style.align === 'left' ? 0 : style.align === 'right' ? blockW - tab.width : (blockW - tab.width) / 2;
    tabularByLine.set(line, tab);
    inkLeft = Math.min(inkLeft, line.x);
    inkRight = Math.max(inkRight, line.x + tab.width);
  });
  if (inkRight <= inkLeft) {
    inkLeft = 0;
    inkRight = blockW;
  }
  layout.blockW = blockW;
  layout.inkLeft = inkLeft;
  layout.inkRight = inkRight;
  return layout;
}

/** Draw runs of a counter line (relative to the line's x), or null for ordinary text. */
export function tabularRuns(line: Line): { text: string; x: number }[] | null {
  return tabularByLine.get(line)?.runs ?? null;
}

/** x of UTF-16 index `index` inside a counter line, or null for ordinary text. */
export function tabularOffset(line: Line, index: number): number | null {
  const tab = tabularByLine.get(line);
  if (!tab) return null;
  return tab.pos[Math.max(0, Math.min(index, tab.pos.length - 1))] ?? 0;
}
