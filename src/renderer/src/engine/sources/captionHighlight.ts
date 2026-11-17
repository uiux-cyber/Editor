/**
 * Word-by-word caption highlighting for the text rasteriser. Given a caption clip and a time it
 * resolves which word is being spoken and how far into it we are, and paints the per-word
 * decorations (box behind the word, underline). The same code runs for the preview and the
 * exporter, so both always agree.
 */

import { activeWordAt, captionTokenTimes, type TimeRange } from '@/core/speech';
import type { CaptionHighlight, TextClip } from '@/core/types';
import { roundRectPath, type Ctx2D } from './raster';

export interface CaptionHighlightState {
  mode: Exclude<CaptionHighlight, 'none'>;
  color: string;
  /** Index of the active word (-1 before the first word). */
  index: number;
  /** 0..1 through the active word (karaoke). */
  progress: number;
  /** Seconds since the active word started. */
  since: number;
  /** Previous word (for the sliding box). */
  prev: number;
  times: TimeRange[];
  /** Cache key: changes exactly when the pixels change. */
  key: string;
}

const POP_IN = 0.14;
const SLIDE = 0.09;
const GROW = 0.12;

const easeOutBack = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);

export function captionHighlightState(clip: TextClip, t: number): CaptionHighlightState | null {
  const cap = clip.caption;
  if (!cap || cap.highlight === 'none') return null;
  const times = captionTokenTimes(clip.text.content, cap.words, clip.duration);
  if (times.length === 0) return null;
  const { index, progress } = activeWordAt(times, t);
  const since = index >= 0 ? Math.max(0, t - times[index].start) : 0;
  let phase = 0;
  if (index >= 0) {
    if (cap.highlight === 'karaoke') phase = Math.round(progress * 48);
    else if (cap.highlight === 'pop') phase = Math.round(Math.min(1, since / POP_IN) * 24);
    else if (cap.highlight === 'box') phase = Math.round(Math.min(1, since / SLIDE) * 16);
    else if (cap.highlight === 'underline') phase = Math.round(Math.min(1, since / GROW) * 16);
  }
  return {
    mode: cap.highlight,
    color: cap.highlightColor,
    index,
    progress,
    since,
    prev: index - 1,
    times,
    key: `${cap.highlight}|${cap.highlightColor}|${index}|${phase}`,
  };
}

/** Extra raster padding (design px) needed by a highlight mode. */
export function highlightPad(state: CaptionHighlightState | null, fontSize: number): number {
  if (!state) return 0;
  if (state.mode === 'pop') return fontSize * 0.35;
  if (state.mode === 'box') return fontSize * 0.3;
  if (state.mode === 'underline') return fontSize * 0.25;
  return 0;
}

/** Scale applied to a word (pop mode). */
export function wordScale(state: CaptionHighlightState | null, word: number): number {
  if (!state || state.mode !== 'pop' || word !== state.index) return 1;
  return 1 + 0.16 * easeOutBack(Math.min(1, state.since / POP_IN));
}

/** Fill colour of a word, or null to use the style's own fill. */
export function wordFill(state: CaptionHighlightState | null, word: number): string | null {
  if (!state || state.index < 0) return null;
  switch (state.mode) {
    case 'color':
    case 'pop':
      return word === state.index ? state.color : null;
    case 'karaoke':
      return word < state.index ? state.color : null;
    default:
      return null;
  }
}

/** Karaoke: fraction of the active word painted in the highlight colour. */
export function karaokeFraction(state: CaptionHighlightState | null, word: number): number {
  if (!state || state.mode !== 'karaoke' || word !== state.index) return 0;
  return state.progress;
}

export interface WordBox {
  x: number;
  y: number;
  w: number;
  h: number;
  line: number;
}

/** Rounded box behind the active word, sliding in from the previous word on the same line. */
export function paintWordBox(ctx: Ctx2D, state: CaptionHighlightState, boxes: Map<number, WordBox>, em: number): void {
  if (state.mode !== 'box' || state.index < 0) return;
  const cur = boxes.get(state.index);
  if (!cur) return;
  let { x, y, w, h } = cur;
  const prev = boxes.get(state.prev);
  const k = easeOut(Math.min(1, state.since / SLIDE));
  if (prev && prev.line === cur.line && k < 1) {
    x = prev.x + (cur.x - prev.x) * k;
    w = prev.w + (cur.w - prev.w) * k;
  } else if (k < 1) {
    // First word of a line: grow in place.
    const s = 0.85 + 0.15 * k;
    x += (w * (1 - s)) / 2;
    y += (h * (1 - s)) / 2;
    w *= s;
    h *= s;
  }
  const padX = em * 0.16;
  const padY = em * 0.06;
  ctx.save();
  ctx.fillStyle = state.color;
  ctx.beginPath();
  roundRectPath(ctx, x - padX, y - padY, w + padX * 2, h + padY * 2, em * 0.18);
  ctx.fill();
  ctx.restore();
}

/** Bar under the active word, growing from its left edge. */
export function paintUnderline(ctx: Ctx2D, state: CaptionHighlightState, boxes: Map<number, WordBox>, em: number, baselineOf: (line: number) => number): void {
  if (state.mode !== 'underline' || state.index < 0) return;
  const cur = boxes.get(state.index);
  if (!cur) return;
  const k = easeOut(Math.min(1, state.since / GROW));
  const thickness = Math.max(2, em * 0.09);
  const y = baselineOf(cur.line) + em * 0.13;
  ctx.save();
  ctx.fillStyle = state.color;
  ctx.beginPath();
  roundRectPath(ctx, cur.x, y, Math.max(thickness, cur.w * k), thickness, thickness / 2);
  ctx.fill();
  ctx.restore();
}
