import { solid } from '@/core/factory';
import type { TextPresetDef } from '../types';

/**
 * Subtitles: built to stay readable over any footage (outline, shadow or box behind every one)
 * and deliberately quiet, so only a few carry animation.
 */
const presets: TextPresetDef[] = [
  {
    id: 'subtitle-classic',
    name: 'Classic Subtitle',
    category: 'subtitle',
    sample: 'Subtitles that stay readable',
    style: {
      fontFamily: 'Inter',
      fontWeight: 600,
      fontSize: 58,
      stroke: { color: '#000000', width: 6 },
      shadow: { color: '#00000099', blur: 8, x: 0, y: 3 },
    },
  },
  {
    id: 'subtitle-soft-shadow',
    name: 'Soft Shadow',
    category: 'subtitle',
    sample: 'A softer subtitle style',
    // No outline: a dark halo plus a tight drop shadow keeps the letters off bright footage.
    style: {
      fontFamily: 'Inter',
      fontWeight: 600,
      fontSize: 58,
      glow: { color: '#000000b3', blur: 10 },
      shadow: { color: '#000000cc', blur: 3, x: 0, y: 3 },
    },
  },
  {
    id: 'subtitle-boxed',
    name: 'Boxed',
    category: 'subtitle',
    sample: 'Boxed for any background',
    style: {
      fontFamily: 'Inter',
      fontWeight: 500,
      fontSize: 54,
      background: { color: '#000000', opacity: 0.78, padX: 26, padY: 12, radius: 8 },
    },
  },
  {
    id: 'subtitle-yellow',
    name: 'Classic Yellow',
    category: 'subtitle',
    sample: 'The classic yellow look',
    style: {
      fontFamily: 'Montserrat',
      fontWeight: 700,
      fontSize: 60,
      fill: solid('#ffe34d'),
      stroke: { color: '#000000', width: 7 },
    },
  },
  {
    id: 'subtitle-cinema',
    name: 'Cinema',
    category: 'subtitle',
    sample: 'Somewhere, far from here…',
    style: {
      fontFamily: 'Raleway',
      fontWeight: 500,
      fontSize: 56,
      italic: true,
      letterSpacing: 0.02,
      fill: solid('#f7f4ec'),
      glow: { color: '#000000a6', blur: 9 },
      shadow: { color: '#000000cc', blur: 3, x: 0, y: 2 },
    },
    anim: { in: { id: 'fade-in', duration: 0.4 }, out: { id: 'fade-out', duration: 0.4 } },
  },
  {
    id: 'subtitle-typed',
    name: 'Typed',
    category: 'subtitle',
    sample: 'Typing it out as we go',
    style: {
      fontFamily: 'JetBrains Mono',
      fontWeight: 500,
      fontSize: 48,
      background: { color: '#0b0d12', opacity: 0.72, padX: 24, padY: 12, radius: 6 },
    },
    textAnim: { in: { id: 'typewriter', duration: 1.2 } },
  },
  {
    id: 'subtitle-light-box',
    name: 'Light Box',
    category: 'subtitle',
    sample: 'Dark text on a light box',
    style: {
      fontFamily: 'Inter',
      fontWeight: 600,
      fontSize: 54,
      fill: solid('#14161b'),
      background: { color: '#ffffff', opacity: 0.94, padX: 28, padY: 13, radius: 14 },
    },
  },
  {
    id: 'subtitle-documentary',
    name: 'Documentary',
    category: 'subtitle',
    sample: 'It began with a single idea',
    style: {
      fontFamily: 'Playfair Display',
      fontWeight: 500,
      fontSize: 60,
      fill: solid('#fff8e7'),
      glow: { color: '#000000b3', blur: 10 },
      shadow: { color: '#000000cc', blur: 3, x: 0, y: 3 },
    },
    textAnim: { in: { id: 'word-fade-in', duration: 1 } },
  },
  {
    id: 'subtitle-heavy-outline',
    name: 'Heavy Outline',
    category: 'subtitle',
    sample: 'Loud and clear subtitles',
    style: { fontFamily: 'Poppins', fontWeight: 800, fontSize: 64, stroke: { color: '#000000', width: 12 } },
  },
  {
    id: 'subtitle-friendly',
    name: 'Friendly',
    category: 'subtitle',
    sample: 'A rounder, friendlier voice',
    style: {
      fontFamily: 'Rubik',
      fontWeight: 600,
      fontSize: 56,
      background: { color: '#1f2937', opacity: 0.88, padX: 34, padY: 14, radius: 30 },
    },
  },
  {
    id: 'subtitle-condensed',
    name: 'Condensed',
    category: 'subtitle',
    sample: 'More words on every line',
    style: {
      fontFamily: 'Oswald',
      fontWeight: 500,
      fontSize: 64,
      uppercase: true,
      letterSpacing: 0.03,
      stroke: { color: '#000000', width: 6 },
      shadow: { color: '#00000080', blur: 6, x: 0, y: 3 },
    },
  },
];

export default presets;
