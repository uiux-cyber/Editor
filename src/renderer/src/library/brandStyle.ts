/**
 * "Apply brand to selection": restyle existing text, shapes, stickers and animated backgrounds
 * with the brand colours and fonts.
 *
 * Colours are mapped by role rather than replaced wholesale:
 *  - neutral colours (greys, white, black) keep their lightness: light ones become the lighter of
 *    the brand text / background colours, dark ones the darker — so light-on-dark stays legible,
 *  - chromatic colours become the brand primary, secondary and accent, in the order distinct hues
 *    are met across the selection (the same source hue always maps to the same brand colour),
 *  - the alpha of every colour is preserved.
 * Large text gets the heading font, the rest the body font.
 *
 * Pure: mutates the clips it is given (call it inside `updateProject`).
 */

import type { Clip, Paint, ShapeClip, TextClip } from '@/core/types';
import { getGenerator } from './index';
import { luminance } from './templates/_lib/kit';
import type { FontPair, Palette } from './types';

function rgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hueChroma(hex: string): { hue: number; chroma: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  let hue = 0;
  if (c > 0) {
    if (max === r) hue = ((g - b) / c) % 6;
    else if (max === g) hue = (b - r) / c + 2;
    else hue = (r - g) / c + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, chroma: c };
}

const alphaSuffix = (hex: string): string => {
  const h = hex.replace('#', '');
  return h.length === 8 ? h.slice(6, 8) : h.length === 4 ? h[3] + h[3] : '';
};

/** Maps source colours to brand colours consistently for one restyle operation. */
export class BrandColorMapper {
  private hues: number[] = [];
  private readonly light: string;
  private readonly dark: string;
  constructor(private readonly palette: Palette) {
    const textL = luminance(palette.text);
    const bgL = luminance(palette.bg);
    this.light = textL >= bgL ? palette.text : palette.bg;
    this.dark = textL >= bgL ? palette.bg : palette.text;
  }

  map(color: string): string {
    if (typeof color !== 'string' || !color.startsWith('#')) return color;
    const a = alphaSuffix(color);
    const { hue, chroma } = hueChroma(color);
    let out: string;
    if (chroma < 0.16) {
      out = luminance(color) >= 0.18 ? this.light : this.dark;
    } else {
      let i = this.hues.findIndex((h) => Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue)) < 28);
      if (i < 0) {
        this.hues.push(hue);
        i = this.hues.length - 1;
      }
      out = [this.palette.primary, this.palette.secondary, this.palette.accent][i % 3];
    }
    return a ? `${out.slice(0, 7)}${a}` : out.slice(0, 7);
  }

  paint(p: Paint): Paint {
    if (p.type === 'solid') return { type: 'solid', color: this.map(p.color) };
    if (p.type === 'linear') return { type: 'linear', angle: p.angle, stops: p.stops.map((s) => ({ offset: s.offset, color: this.map(s.color) })) };
    return { type: 'radial', stops: p.stops.map((s) => ({ offset: s.offset, color: this.map(s.color) })) };
  }
}

export interface RestyleResult {
  /** Clips that changed. */
  changed: number;
}

/** True for clips the brand restyle touches. */
export const isBrandStylable = (c: Clip): boolean => c.type === 'text' || (c.type === 'shape' && !c.shape.slot) || c.type === 'sticker' || c.type === 'generator';

function restyleText(clip: TextClip, m: BrandColorMapper, fonts: FontPair, heading: boolean): void {
  const role = heading ? fonts.heading : fonts.body;
  const t = clip.text;
  t.fontFamily = role.family;
  t.fontWeight = role.weight;
  if (role.uppercase !== undefined) t.uppercase = role.uppercase;
  if (role.letterSpacing !== undefined) t.letterSpacing = role.letterSpacing;
  t.fill = m.paint(t.fill);
  if (t.stroke) t.stroke = { ...t.stroke, color: m.map(t.stroke.color) };
  if (t.glow) t.glow = { ...t.glow, color: m.map(t.glow.color) };
  if (t.background) t.background = { ...t.background, color: m.map(t.background.color) };
}

function restyleShape(clip: ShapeClip, m: BrandColorMapper): void {
  clip.shape.fill = m.paint(clip.shape.fill);
  if (clip.shape.stroke) clip.shape.stroke = { ...clip.shape.stroke, color: m.map(clip.shape.stroke.color) };
}

/**
 * Restyle clips with the brand palette and fonts (in place). Text at least 70 % of the largest
 * font size in the selection (and 44 px or more) is treated as a heading.
 */
export function applyBrandStyle(clips: Clip[], palette: Palette, fonts: FontPair): RestyleResult {
  const m = new BrandColorMapper(palette);
  const texts = clips.filter((c): c is TextClip => c.type === 'text');
  const maxSize = Math.max(0, ...texts.map((t) => t.text.fontSize * Math.abs(t.transform.scaleY)));
  let changed = 0;
  for (const clip of clips) {
    if (!isBrandStylable(clip)) continue;
    const before = JSON.stringify(clip);
    if (clip.type === 'text') {
      const size = clip.text.fontSize * Math.abs(clip.transform.scaleY);
      restyleText(clip, m, fonts, texts.length === 1 ? size >= 64 : size >= maxSize * 0.7 && size >= 44);
    } else if (clip.type === 'shape') restyleShape(clip, m);
    else if (clip.type === 'sticker') {
      if (clip.colors?.length) clip.colors = clip.colors.map((c) => m.map(c));
    } else if (clip.type === 'generator') {
      const def = getGenerator(clip.generatorId);
      for (const p of def?.params ?? []) {
        if (p.type !== 'color') continue;
        const current = (clip.params[p.key] ?? p.default) as string;
        // Background-colour params take the brand background; the rest map by role.
        clip.params[p.key] = /bg|background/i.test(p.key) ? palette.bg : m.map(current);
      }
    }
    if (JSON.stringify(clip) !== before) changed++;
  }
  return { changed };
}
