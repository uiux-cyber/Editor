import { linear, solid } from '@/core/factory';
import type { TextPresetDef } from '../types';

/** Refined serif and script styles with warm off-whites, soft metallics and unhurried motion. */
const presets: TextPresetDef[] = [
  {
    id: 'elegant-classic',
    name: 'Classic Serif',
    category: 'elegant',
    sample: 'Timeless',
    style: { fontFamily: 'Playfair Display', fontWeight: 400, fontSize: 130, letterSpacing: -0.005, fill: solid('#f7f2ea') },
    textAnim: { in: { id: 'char-blur-in', duration: 1.2 } },
    anim: { out: { id: 'fade-out', duration: 0.6 } },
  },
  {
    id: 'elegant-italic',
    name: 'Italic Grace',
    category: 'elegant',
    sample: 'With Love',
    style: { fontFamily: 'Playfair Display', fontWeight: 500, fontSize: 130, italic: true },
  },
  {
    id: 'elegant-wide-capitals',
    name: 'Wide Capitals',
    category: 'elegant',
    sample: 'THE ATELIER',
    style: { fontFamily: 'Raleway', fontWeight: 300, fontSize: 68, uppercase: true, letterSpacing: 0.5, fill: solid('#f3efe8') },
    textAnim: { in: { id: 'tracking-in', duration: 1.5 }, out: { id: 'tracking-out', duration: 0.9 } },
  },
  {
    id: 'elegant-champagne',
    name: 'Champagne',
    category: 'elegant',
    sample: 'Celebrate',
    style: { fontFamily: 'DM Serif Display', fontWeight: 400, fontSize: 140, fill: linear(90, '#fbefc5', '#cfa550') },
    anim: { in: { id: 'focus-in', duration: 0.9 }, out: { id: 'defocus-out', duration: 0.8 } },
  },
  {
    id: 'elegant-signature',
    name: 'Signature',
    category: 'elegant',
    sample: 'Sincerely Yours',
    style: { fontFamily: 'Dancing Script', fontWeight: 600, fontSize: 150 },
    // A slow wipe along the baseline reads like the line being written.
    anim: { in: { id: 'wipe-right-in', duration: 1 } },
  },
  {
    id: 'elegant-high-fashion',
    name: 'High Fashion',
    category: 'elegant',
    sample: 'EDITION',
    style: { fontFamily: 'Abril Fatface', fontWeight: 400, fontSize: 170, uppercase: true, letterSpacing: 0.02, lineHeight: 1 },
  },
  {
    id: 'elegant-save-the-date',
    name: 'Save The Date',
    category: 'elegant',
    sample: 'SAVE THE DATE\n14 · 06 · 2027',
    style: {
      fontFamily: 'Playfair Display',
      fontWeight: 400,
      fontSize: 58,
      uppercase: true,
      letterSpacing: 0.42,
      lineHeight: 1.7,
      fill: solid('#f3e9dc'),
    },
    textAnim: { in: { id: 'line-blur-in', duration: 1.2 } },
  },
  {
    id: 'elegant-rose-gold',
    name: 'Rose Gold',
    category: 'elegant',
    sample: 'La Vie',
    style: {
      fontFamily: 'Playfair Display',
      fontWeight: 600,
      fontSize: 130,
      italic: true,
      fill: linear(90, '#ffe1d9', '#e59aa6'),
    },
  },
  {
    id: 'elegant-whisper',
    name: 'Whisper',
    category: 'elegant',
    sample: 'softly',
    style: { fontFamily: 'Raleway', fontWeight: 100, fontSize: 150, letterSpacing: 0.06 },
    textAnim: { in: { id: 'random-fade-in', duration: 1.4 } },
  },
  {
    id: 'elegant-monogram',
    name: 'Monogram',
    category: 'elegant',
    sample: 'A & J',
    style: { fontFamily: 'DM Serif Display', fontWeight: 400, fontSize: 220, letterSpacing: 0.08, fill: solid('#eadfc8') },
  },
  {
    id: 'elegant-noir',
    name: 'Noir',
    category: 'elegant',
    sample: 'Noir',
    style: {
      fontFamily: 'Playfair Display',
      fontWeight: 900,
      fontSize: 140,
      fill: solid('#111111'),
      background: { color: '#f4efe6', opacity: 1, padX: 64, padY: 22, radius: 0 },
    },
    anim: { in: { id: 'unfold-in', duration: 0.6 }, out: { id: 'fold-out', duration: 0.6 } },
  },
  {
    id: 'elegant-gala',
    name: 'Gala',
    category: 'elegant',
    sample: 'GALA NIGHT',
    style: {
      fontFamily: 'Playfair Display',
      fontWeight: 400,
      fontSize: 110,
      uppercase: true,
      letterSpacing: 0.2,
      fill: linear(0, '#e8d5a3', '#fff6dc', '#d4b06a'),
    },
  },
];

export default presets;
