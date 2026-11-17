/**
 * Text rasteriser: lays out a TextClip and paints it to a 2D canvas that the compositor uploads
 * as a texture. Static text is painted line by line (full shaping); while a per-character /
 * per-word animation is running it switches to painting individual units with their own
 * transform.
 */

import { hashString, seededRandom } from '@/core/easing';
import { animWindows } from '@/core/scene';
import type { ID, TextClip, TextStyle } from '@/core/types';
import { getTextAnimation } from '@/library';
import { BUNDLED_FONTS } from '@/library/fonts';
import type { GlyphMod, TextAnimDef } from '@/library/types';
import { counterFrame, fitCounterLayout, tabularOffset, tabularRuns } from './counterText';
import { captionHighlightState, highlightPad, karaokeFraction, paintUnderline, paintWordBox, wordFill, wordScale, type CaptionHighlightState, type WordBox } from './captionHighlight';
import { MAX_RASTER, ctx2d, hashKey, makeCanvas, nextVersion, paintStyle, roundRectPath, type AnyCanvas, type Ctx2D, type Raster } from './raster';
import { applyFont, fontString, getMeasureCtx, layoutText, type Layout } from './textLayout';

export { fontString, measureTextBlock, type TextMetrics } from './textLayout';

// ---------------------------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------------------------

let fontsEpoch = 0;
const fontListeners = new Set<() => void>();
const requested = new Set<string>();

/** Subscribe to "a font finished loading" (text needs to be re-rasterised). */
export function onFontsChanged(cb: () => void): () => void {
  fontListeners.add(cb);
  return () => fontListeners.delete(cb);
}

/** Make sure a font is loaded; resolves immediately when it already is. */
export function ensureFont(style: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'italic'>): Promise<void> {
  const spec = fontString(style, 48);
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  if (document.fonts.check(spec)) return Promise.resolve();
  return document.fonts
    .load(spec)
    .then(() => undefined)
    .catch(() => undefined);
}

/**
 * Load every bundled typeface (all weights). Call once at startup so text measurement used by
 * template layouts is exact from the first frame.
 */
export function preloadBundledFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const loads: Promise<unknown>[] = [];
  for (const font of BUNDLED_FONTS) {
    for (const weight of font.weights) {
      const spec = `${weight} 48px "${font.css}"`;
      loads.push(document.fonts.load(spec).catch(() => undefined));
    }
  }
  return Promise.all(loads).then(() => {
    fontsEpoch++;
    fontListeners.forEach((cb) => cb());
  });
}

function requestFont(style: TextStyle): void {
  const spec = fontString(style, 48);
  if (requested.has(spec)) return;
  requested.add(spec);
  if (typeof document === 'undefined' || !document.fonts || document.fonts.check(spec)) return;
  void document.fonts
    .load(spec)
    .catch(() => undefined)
    .then(() => {
      fontsEpoch++;
      fontListeners.forEach((cb) => cb());
    });
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

interface Unit {
  text: string;
  /** Left edge relative to the line start, and advance width. */
  x: number;
  w: number;
  line: number;
  /** Indices of this unit at each granularity (-1 for whitespace). */
  char: number;
  word: number;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function splitUnits(layout: Layout, style: TextStyle, byChar: boolean): { units: Unit[]; chars: number; words: number } {
  const ctx = getMeasureCtx();
  applyFont(ctx, style, layout.fontPx);
  const ls = style.letterSpacing * layout.fontPx;
  const units: Unit[] = [];
  let charIndex = 0;
  let wordIndex = 0;
  layout.lines.forEach((line, li) => {
    const text = line.text;
    // Count-up numbers place their digits in fixed cells (counterText.ts).
    const prefix = (end: number): number => tabularOffset(line, end) ?? (end <= 0 ? 0 : ctx.measureText(text.slice(0, end)).width);
    const wordRe = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = wordRe.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      if (byChar) {
        const graphemes = segmenter ? Array.from(segmenter.segment(match[0]), (s) => ({ text: s.segment, index: s.index })) : Array.from(match[0], (ch, i) => ({ text: ch, index: i }));
        for (const g of graphemes) {
          const gs = start + g.index;
          const ge = gs + g.text.length;
          const x0 = prefix(gs);
          const x1 = prefix(ge) - ls;
          units.push({ text: g.text, x: x0, w: Math.max(0, x1 - x0), line: li, char: charIndex++, word: wordIndex });
        }
      } else {
        const x0 = prefix(start);
        const x1 = prefix(end) - ls;
        units.push({ text: match[0], x: x0, w: Math.max(0, x1 - x0), line: li, char: charIndex, word: wordIndex });
        charIndex += match[0].length;
      }
      wordIndex++;
    }
  });
  return { units, chars: charIndex, words: wordIndex };
}

// ---------------------------------------------------------------------------------------------
// Per-unit animation
// ---------------------------------------------------------------------------------------------

type Level = 'char' | 'word' | 'line' | 'block';
const LEVEL_RANK: Record<Level, number> = { char: 0, word: 1, line: 2, block: 3 };

interface ActiveAnim {
  def: TextAnimDef;
  /** Global 0..1 progress for in/out; elapsed periods for loop. */
  p: number;
}

function orderIndex(order: TextAnimDef['order'], i: number, n: number, seed: number): number {
  if (n <= 1) return 0;
  switch (order) {
    case 'reverse':
      return n - 1 - i;
    case 'center': {
      // Units closest to the middle go first.
      return Math.round(Math.abs(i - (n - 1) / 2) * 2);
    }
    case 'edges':
      return Math.round(((n - 1) / 2 - Math.abs(i - (n - 1) / 2)) * 2);
    case 'random': {
      const rnd = seededRandom(seed + n * 131);
      const perm = Array.from({ length: n }, (_, k) => k);
      for (let k = n - 1; k > 0; k--) {
        const j = Math.floor(rnd() * (k + 1));
        [perm[k], perm[j]] = [perm[j], perm[k]];
      }
      return perm[i];
    }
    default:
      return i;
  }
}

function unitMod(anim: ActiveAnim, index: number, count: number, time: number, seed: number): GlyphMod {
  const { def } = anim;
  const n = Math.max(1, count);
  const i = orderIndex(def.order, Math.min(index, n - 1), n, seed);
  // 'center' / 'edges' produce at most n distinct ranks; normalise against the largest rank.
  const maxRank = def.order === 'center' || def.order === 'edges' ? Math.max(1, n - 1) : Math.max(1, n - 1);
  let local: number;
  if (def.kind === 'loop') {
    local = (((anim.p - i * def.stagger) % 1) + 1) % 1;
  } else {
    const s = Math.min(1, Math.max(0, def.stagger));
    const span = 1 + s * maxRank;
    local = Math.min(1, Math.max(0, anim.p * span - s * i));
  }
  return def.apply(local, { index: i, count: n, time });
}

// ---------------------------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------------------------

interface CacheEntry {
  key: string;
  raster: Raster;
  scratch?: AnyCanvas;
}

const BIG = 20000;

export class TextRenderer {
  private cache = new Map<ID, CacheEntry>();

  /** Rasterise `clip` as it looks at `localTime`. `rasterScale` = real pixels per design pixel. */
  render(clip: TextClip, localTime: number, rasterScale: number): Raster {
    const t = Math.min(Math.max(localTime, 0), clip.duration);
    // Count-up numbers (counterText.ts): the content is the counter's value at this time.
    const counter = counterFrame(clip, t);
    const style = counter ? counter.style : clip.text;
    requestFont(style);

    // Which per-unit animations are running right now?
    const active: ActiveAnim[] = [];
    const ta = clip.textAnim;
    if (ta) {
      const { inDur, outDur } = animWindows(ta, clip.duration);
      if (ta.loop) {
        const def = getTextAnimation(ta.loop.id);
        if (def && def.kind === 'loop') active.push({ def, p: t / Math.max(0.05, ta.loop.duration) });
      }
      if (ta.in && inDur > 0 && t < inDur) {
        const def = getTextAnimation(ta.in.id);
        if (def && def.kind === 'in') active.push({ def, p: t / inDur });
      }
      if (ta.out && outDur > 0 && t > clip.duration - outDur) {
        const def = getTextAnimation(ta.out.id);
        if (def && def.kind === 'out') active.push({ def, p: (t - (clip.duration - outDur)) / outDur });
      }
    }
    const animating = active.length > 0;
    // Caption clips: word-by-word highlight (speech feature). Not combined with per-unit animation.
    const hl = !animating && clip.caption ? captionHighlightState(clip, t) : null;

    // Padding around the text block (design px) so strokes, shadows and motion are not clipped.
    const strokePad = style.stroke ? style.stroke.width / 2 : 0;
    const glowPad = style.glow ? style.glow.blur * 1.6 : 0;
    const shadowPad = style.shadow ? Math.max(Math.abs(style.shadow.x), Math.abs(style.shadow.y)) + style.shadow.blur * 1.2 : 0;
    const fxPad = Math.max(strokePad, glowPad, shadowPad) + 4;
    const bg = style.background && style.background.opacity > 0 ? style.background : null;
    const animPad = animating ? style.fontSize * 2 : highlightPad(hl, style.fontSize);
    const padXd = Math.max(fxPad, bg ? bg.padX + 2 : 0) + animPad;
    const padYd = Math.max(fxPad, bg ? bg.padY + 2 : 0) + animPad;

    // Keep the canvas within limits by lowering the raster scale for huge text.
    let rs = Math.max(0.05, rasterScale);
    let layout = fitCounterLayout(layoutText(style, rs), style, counter);
    const fullW = layout.blockW + padXd * 2 * rs;
    const fullH = layout.blockH + padYd * 2 * rs;
    const over = Math.max(fullW, fullH) / MAX_RASTER;
    if (over > 1) {
      rs /= over;
      layout = fitCounterLayout(layoutText(style, rs), style, counter);
    }

    const key = hashKey(`${JSON.stringify(style)}|${JSON.stringify(ta ?? null)}|${rs.toFixed(4)}|${fontsEpoch}|${animating ? `t${Math.round(t * 240)}` : 's'}|${hl?.key ?? ''}`);
    let entry = this.cache.get(clip.id);
    if (entry && entry.key === key) return entry.raster;

    const padX = Math.ceil(padXd * rs);
    const padY = Math.ceil(padYd * rs);
    const W = Math.ceil(layout.blockW) + padX * 2;
    const H = Math.ceil(layout.blockH) + padY * 2;
    let canvas: AnyCanvas;
    if (entry && entry.raster.canvas.width === W && entry.raster.canvas.height === H) {
      canvas = entry.raster.canvas;
    } else {
      canvas = makeCanvas(W, H);
    }
    const ctx = ctx2d(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    this.paint(ctx, clip, style, layout, rs, padX, padY, W, H, active, t, entry, hl);

    const bgW = bg ? layout.inkRight - layout.inkLeft + bg.padX * 2 * rs : 0;
    const raster: Raster = {
      canvas,
      width: W / rs,
      height: H / rs,
      contentW: Math.max(layout.blockW, bgW) / rs,
      contentH: (layout.blockH + (bg ? bg.padY * 2 * rs : 0)) / rs,
      version: nextVersion(),
      static: !animating && !counter?.moving && !hl,
    };
    entry = { key, raster, scratch: entry?.scratch };
    this.cache.set(clip.id, entry);
    return raster;
  }

  private paint(
    ctx: Ctx2D,
    clip: TextClip,
    style: TextStyle,
    layout: Layout,
    rs: number,
    padX: number,
    padY: number,
    W: number,
    H: number,
    active: ActiveAnim[],
    time: number,
    entry: CacheEntry | undefined,
    hl: CaptionHighlightState | null = null,
  ): void {
    const em = layout.fontPx;
    const seed = hashString(clip.id);
    const animating = active.length > 0;

    // Decide the drawing granularity: the finest unit among the running animations.
    let level: Level = 'block';
    for (const a of active) if (LEVEL_RANK[a.def.unit] < LEVEL_RANK[level]) level = a.def.unit;
    const split = animating && (level === 'char' || level === 'word') ? splitUnits(layout, style, level === 'char') : null;
    const counts = split ? { char: split.chars, word: split.words } : { char: 1, word: 1 };
    const lineCount = layout.lines.length;
    const blockCx = padX + layout.blockW / 2;
    const blockCy = padY + layout.blockH / 2;

    // Caption highlight: static text drawn word by word so each word can be styled on its own.
    const capWords = hl && !animating ? splitUnits(layout, style, false).units : null;
    const wordBoxes = new Map<number, WordBox>();
    for (const u of capWords ?? []) {
      const line = layout.lines[u.line];
      wordBoxes.set(u.word, { x: padX + line.x + u.x, y: padY + line.y - layout.ascent, w: u.w, h: layout.ascent + layout.descent, line: u.line });
    }

    /** Run `draw` once per drawable unit with that unit's animated transform applied. */
    const forEachUnit = (target: Ctx2D, draw: (text: string, x: number, y: number, word?: number) => void): void => {
      if (!animating && capWords) {
        for (const u of capWords) {
          const line = layout.lines[u.line];
          const x = padX + line.x + u.x;
          const y = padY + line.y;
          const s = wordScale(hl, u.word);
          if (s === 1) {
            draw(u.text, x, y, u.word);
            continue;
          }
          const cx = x + u.w / 2;
          const cy = y - (layout.ascent - layout.descent) / 2;
          target.save();
          target.translate(cx, cy);
          target.scale(s, s);
          target.translate(-cx, -cy);
          draw(u.text, x, y, u.word);
          target.restore();
        }
        return;
      }
      if (!animating) {
        for (const line of layout.lines) {
          if (!line.text) continue;
          const runs = tabularRuns(line);
          if (runs) for (const r of runs) draw(r.text, padX + line.x + r.x, padY + line.y);
          else draw(line.text, padX + line.x, padY + line.y);
        }
        return;
      }
      const drawOne = (text: string, x: number, y: number, w: number, lineIdx: number, charIdx: number, wordIdx: number, wordCenterX: number): void => {
        const line = layout.lines[lineIdx];
        const lineCx = padX + line.x + line.width / 2;
        const midY = y - (layout.ascent - layout.descent) / 2;
        target.save();
        let alpha = 1;
        let blur = 0;
        for (const a of active) {
          let idx = 0;
          let n = 1;
          let cx = blockCx;
          let cy = blockCy;
          if (a.def.unit === 'char') {
            idx = charIdx;
            n = counts.char;
            cx = x + w / 2;
            cy = midY;
          } else if (a.def.unit === 'word') {
            idx = wordIdx;
            n = counts.word;
            cx = wordCenterX;
            cy = midY;
          } else if (a.def.unit === 'line') {
            idx = lineIdx;
            n = lineCount;
            cx = lineCx;
            cy = midY;
          }
          const mod = unitMod(a, idx, n, time, seed);
          const s = mod.scale ?? 1;
          target.translate(cx + (mod.x ?? 0) * em, cy + (mod.y ?? 0) * em);
          if (mod.rotation) target.rotate((mod.rotation * Math.PI) / 180);
          if (s !== 1) target.scale(s, s);
          target.translate(-cx, -cy);
          alpha *= Math.min(1, Math.max(0, mod.opacity ?? 1));
          blur = Math.max(blur, (mod.blur ?? 0) * em);
        }
        if (alpha > 0.002) {
          target.globalAlpha *= alpha;
          if (blur > 0.3) target.filter = `blur(${blur.toFixed(2)}px)`;
          draw(text, x, y);
        }
        target.restore();
      };
      if (split) {
        // Pre-compute word centres so word-level motion pivots on the whole word.
        const wordBounds = new Map<number, { l: number; r: number; line: number }>();
        for (const u of split.units) {
          const lineX = padX + layout.lines[u.line].x;
          const b = wordBounds.get(u.word);
          if (!b) wordBounds.set(u.word, { l: lineX + u.x, r: lineX + u.x + u.w, line: u.line });
          else {
            b.l = Math.min(b.l, lineX + u.x);
            b.r = Math.max(b.r, lineX + u.x + u.w);
          }
        }
        for (const u of split.units) {
          const line = layout.lines[u.line];
          const wb = wordBounds.get(u.word)!;
          drawOne(u.text, padX + line.x + u.x, padY + line.y, u.w, u.line, u.char, u.word, (wb.l + wb.r) / 2);
        }
      } else {
        layout.lines.forEach((line, li) => {
          if (line.text) drawOne(line.text, padX + line.x, padY + line.y, line.width, li, 0, 0, padX + line.x + line.width / 2);
        });
      }
    };

    // 1. Background box
    const bg = style.background && style.background.opacity > 0 ? style.background : null;
    if (bg) {
      const bx = padX + layout.inkLeft - bg.padX * rs;
      const by = padY - bg.padY * rs;
      const bw = layout.inkRight - layout.inkLeft + bg.padX * 2 * rs;
      const bh = layout.blockH + bg.padY * 2 * rs;
      ctx.save();
      // The box follows block-level motion but not per-letter motion.
      let alpha = bg.opacity;
      for (const a of active) {
        if (a.def.kind === 'loop') continue;
        // Fade the box together with the text entrance / exit.
        alpha *= a.def.kind === 'in' ? Math.min(1, a.p * 2.5) : Math.max(0, 1 - Math.max(0, a.p - 0.6) * 2.5);
      }
      ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
      ctx.fillStyle = bg.color;
      ctx.beginPath();
      roundRectPath(ctx, bx, by, bw, bh, bg.radius * rs);
      ctx.fill();
      ctx.restore();
    }

    // 1b. Caption highlight box behind the active word.
    if (hl && capWords) paintWordBox(ctx, hl, wordBoxes, em);

    applyFont(ctx, style, em);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    // 2. Glow and drop shadow are cast from an opaque silhouette so hollow / gradient text
    //    still produces a clean halo.
    if (style.glow || style.shadow) {
      let scratch = entry?.scratch;
      if (!scratch || scratch.width !== W || scratch.height !== H) {
        scratch = makeCanvas(W, H);
        if (entry) entry.scratch = scratch;
      }
      const sctx = ctx2d(scratch);
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, W, H);
      applyFont(sctx, style, em);
      sctx.lineJoin = 'round';
      sctx.fillStyle = '#000';
      sctx.strokeStyle = '#000';
      if (style.stroke && style.stroke.width > 0) sctx.lineWidth = style.stroke.width * rs;
      forEachUnit(sctx, (text, x, y) => {
        if (style.stroke && style.stroke.width > 0) sctx.strokeText(text, x, y);
        sctx.fillText(text, x, y);
      });
      ctx.save();
      if (style.glow && style.glow.blur > 0) {
        ctx.shadowColor = style.glow.color;
        ctx.shadowOffsetX = BIG;
        ctx.shadowOffsetY = 0;
        // Two passes: a wide halo and a tight, brighter core.
        ctx.shadowBlur = style.glow.blur * rs * 2;
        ctx.drawImage(scratch, -BIG, 0);
        ctx.shadowBlur = style.glow.blur * rs * 0.7;
        ctx.drawImage(scratch, -BIG, 0);
      }
      if (style.shadow) {
        ctx.shadowColor = style.shadow.color;
        ctx.shadowBlur = style.shadow.blur * rs * 2;
        ctx.shadowOffsetX = BIG + style.shadow.x * rs;
        ctx.shadowOffsetY = style.shadow.y * rs;
        ctx.drawImage(scratch, -BIG, 0);
      }
      ctx.restore();
    }

    // 3. Outline (behind the fill, so only its outer half shows)
    if (style.stroke && style.stroke.width > 0) {
      ctx.strokeStyle = style.stroke.color;
      ctx.lineWidth = style.stroke.width * rs;
      forEachUnit(ctx, (text, x, y) => ctx.strokeText(text, x, y));
    }

    // 4. Fill
    const baseFill = paintStyle(ctx, style.fill, padX + layout.inkLeft, padY, Math.max(1, layout.inkRight - layout.inkLeft), layout.blockH);
    ctx.fillStyle = baseFill;
    if (hl && capWords) {
      // Per-word colours (active / spoken words) and the karaoke sweep through the current word.
      forEachUnit(ctx, (text, x, y, word = -1) => {
        ctx.fillStyle = wordFill(hl, word) ?? baseFill;
        ctx.fillText(text, x, y);
        const k = karaokeFraction(hl, word);
        const box = wordBoxes.get(word);
        if (k > 0 && box) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - em, y - em * 2, em + box.w * k, em * 4);
          ctx.clip();
          ctx.fillStyle = hl.color;
          ctx.fillText(text, x, y);
          ctx.restore();
        }
      });
      ctx.fillStyle = baseFill;
    } else {
      forEachUnit(ctx, (text, x, y) => ctx.fillText(text, x, y));
    }

    // 4b. Caption underline under the active word.
    if (hl && capWords) paintUnderline(ctx, hl, wordBoxes, em, (line) => padY + layout.lines[line].y);

    // 5. Underline
    if (style.underline) {
      const thickness = Math.max(1, em * 0.065);
      for (const line of layout.lines) {
        if (!line.text) continue;
        ctx.fillRect(padX + line.x, padY + line.y + em * 0.12, line.width, thickness);
      }
    }
  }

  /** Drop cached rasters for clips that no longer exist. */
  prune(alive: ReadonlySet<ID>): void {
    for (const id of this.cache.keys()) if (!alive.has(id)) this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}
