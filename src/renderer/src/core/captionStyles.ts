/**
 * Caption look presets (applied to every caption at once from the Captions tab) and the
 * aspect-aware defaults for size, line length and placement.
 */

import { designSize } from './project';
import type { CaptionHighlight, ProjectSettings, TextStyle } from './types';

export type CaptionPosition = 'top' | 'middle' | 'lower' | 'bottom';

export interface CaptionPreset {
  id: string;
  name: string;
  /** One line describing the look. */
  description: string;
  style: Partial<TextStyle>;
  /** Multiplier on the format's base caption size. */
  sizeScale: number;
  highlight: CaptionHighlight;
  highlightColor: string;
  position: CaptionPosition;
}

const SHADOW = { color: '#000000b3', blur: 10, x: 0, y: 4 };

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'clean-box',
    name: 'Clean box',
    description: 'White text on a soft dark box',
    style: { fontFamily: 'Inter', fontWeight: 600, fill: { type: 'solid', color: '#ffffff' }, background: { color: '#000000', opacity: 0.62, padX: 22, padY: 10, radius: 14 }, lineHeight: 1.22 },
    sizeScale: 0.86,
    highlight: 'none',
    highlightColor: '#ffd84d',
    position: 'lower',
  },
  {
    id: 'bold-outline',
    name: 'Bold outline',
    description: 'Heavy caps with a thick outline',
    style: { fontFamily: 'Montserrat', fontWeight: 900, uppercase: true, fill: { type: 'solid', color: '#ffffff' }, stroke: { color: '#000000', width: 12 }, shadow: { color: '#000000cc', blur: 0, x: 0, y: 6 }, lineHeight: 1.08, letterSpacing: 0.01 },
    sizeScale: 1,
    highlight: 'color',
    highlightColor: '#ffe14d',
    position: 'lower',
  },
  {
    id: 'karaoke',
    name: 'Karaoke fill',
    description: 'Words fill with colour as they are spoken',
    style: { fontFamily: 'Poppins', fontWeight: 800, fill: { type: 'solid', color: '#ffffff' }, stroke: { color: '#000000', width: 8 }, shadow: SHADOW, lineHeight: 1.12 },
    sizeScale: 0.95,
    highlight: 'karaoke',
    highlightColor: '#ffc93c',
    position: 'lower',
  },
  {
    id: 'pop-word',
    name: 'Pop word',
    description: 'The current word pops and changes colour',
    style: { fontFamily: 'Anton', fontWeight: 400, uppercase: true, fill: { type: 'solid', color: '#ffffff' }, stroke: { color: '#000000', width: 10 }, shadow: { color: '#000000d9', blur: 2, x: 0, y: 7 }, lineHeight: 1.1, letterSpacing: 0.02 },
    sizeScale: 1.12,
    highlight: 'pop',
    highlightColor: '#9dff3c',
    position: 'lower',
  },
  {
    id: 'word-box',
    name: 'Highlight box',
    description: 'A coloured box slides behind the current word',
    style: { fontFamily: 'Montserrat', fontWeight: 800, uppercase: true, fill: { type: 'solid', color: '#ffffff' }, stroke: { color: '#000000', width: 6 }, shadow: SHADOW, lineHeight: 1.18 },
    sizeScale: 0.92,
    highlight: 'box',
    highlightColor: '#7c5cff',
    position: 'lower',
  },
  {
    id: 'underline',
    name: 'Underline',
    description: 'A bright bar underlines the current word',
    style: { fontFamily: 'Inter', fontWeight: 800, fill: { type: 'solid', color: '#ffffff' }, shadow: { color: '#000000d0', blur: 14, x: 0, y: 3 }, lineHeight: 1.25 },
    sizeScale: 0.9,
    highlight: 'underline',
    highlightColor: '#ff5fa2',
    position: 'lower',
  },
  {
    id: 'minimal-lower',
    name: 'Minimal lower',
    description: 'Small, quiet subtitles near the bottom',
    style: { fontFamily: 'Inter', fontWeight: 500, fill: { type: 'solid', color: '#ffffff' }, shadow: { color: '#000000c0', blur: 8, x: 0, y: 2 }, lineHeight: 1.25 },
    sizeScale: 0.66,
    highlight: 'none',
    highlightColor: '#ffd84d',
    position: 'bottom',
  },
  {
    id: 'neon',
    name: 'Neon glow',
    description: 'Glowing text with a hot-pink active word',
    style: { fontFamily: 'Rubik', fontWeight: 700, fill: { type: 'solid', color: '#f4fbff' }, glow: { color: '#22d3ee', blur: 16 }, shadow: { color: '#00000099', blur: 6, x: 0, y: 3 }, lineHeight: 1.15 },
    sizeScale: 0.95,
    highlight: 'color',
    highlightColor: '#ff4fd8',
    position: 'lower',
  },
];

export const DEFAULT_CAPTION_PRESET = 'bold-outline';

export const getCaptionPreset = (id: string): CaptionPreset | undefined => CAPTION_PRESETS.find((p) => p.id === id);

/** Style properties a preset controls (everything else on a caption is left alone). */
export const PRESET_KEYS: (keyof TextStyle)[] = ['fontFamily', 'fontWeight', 'italic', 'underline', 'uppercase', 'lineHeight', 'letterSpacing', 'fill', 'stroke', 'shadow', 'glow', 'background'];

export type FormatClass = 'portrait' | 'square' | 'landscape';

export function formatClass(settings: Pick<ProjectSettings, 'width' | 'height'>): FormatClass {
  const r = settings.width / settings.height;
  return r < 0.9 ? 'portrait' : r > 1.15 ? 'landscape' : 'square';
}

/** Base caption font size (design px) and line length for a format. */
export function captionMetrics(settings: Pick<ProjectSettings, 'width' | 'height'>): { fontSize: number; maxChars: number; boxWidth: number } {
  const { cw } = designSize(settings);
  const cls = formatClass(settings);
  if (cls === 'portrait') return { fontSize: 76, maxChars: 18, boxWidth: Math.round(cw * 0.9) };
  if (cls === 'square') return { fontSize: 68, maxChars: 24, boxWidth: Math.round(cw * 0.9) };
  return { fontSize: 60, maxChars: 38, boxWidth: Math.round(cw * 0.86) };
}

/** Vertical centre offset (design px from the frame centre) for a caption position. */
export function captionY(settings: Pick<ProjectSettings, 'width' | 'height'>, position: CaptionPosition): number {
  const { ch } = designSize(settings);
  const portrait = formatClass(settings) === 'portrait';
  const frac = position === 'top' ? (portrait ? -0.3 : -0.34) : position === 'middle' ? 0 : position === 'lower' ? (portrait ? 0.17 : 0.3) : portrait ? 0.3 : 0.39;
  return Math.round(ch * frac);
}

/** Full text style for a preset in a given format (content left empty). */
export function presetTextStyle(preset: CaptionPreset, settings: Pick<ProjectSettings, 'width' | 'height'>, base: TextStyle): TextStyle {
  const m = captionMetrics(settings);
  const style: TextStyle = { ...base, ...JSON.parse(JSON.stringify(preset.style)) };
  for (const key of PRESET_KEYS) if (!(key in preset.style) && key !== 'italic' && key !== 'underline' && key !== 'uppercase') delete (style as unknown as Record<string, unknown>)[key];
  style.italic = preset.style.italic ?? false;
  style.underline = preset.style.underline ?? false;
  style.uppercase = preset.style.uppercase ?? false;
  style.fontFamily = preset.style.fontFamily ?? base.fontFamily;
  style.fontWeight = preset.style.fontWeight ?? 700;
  style.lineHeight = preset.style.lineHeight ?? 1.15;
  style.letterSpacing = preset.style.letterSpacing ?? 0;
  style.fill = preset.style.fill ?? { type: 'solid', color: '#ffffff' };
  style.fontSize = Math.round(m.fontSize * preset.sizeScale);
  // Outlines and boxes scale with the text.
  const k = style.fontSize / 76;
  if (style.stroke) style.stroke = { ...style.stroke, width: Math.max(1, Math.round(style.stroke.width * k)) };
  if (style.background) style.background = { ...style.background, padX: Math.round(style.background.padX * k), padY: Math.round(style.background.padY * k), radius: Math.round(style.background.radius * k) };
  style.align = 'center';
  style.boxWidth = m.boxWidth;
  return style;
}
