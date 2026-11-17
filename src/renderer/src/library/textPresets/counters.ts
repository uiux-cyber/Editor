import { linear } from '@/core/factory';
import type { TextPresetDef } from '../types';

/**
 * Count-up numbers: the text counts from → to while the clip plays (TextClip.counter). `sample`
 * is the final value as the counter formats it, so the library tile and the timeline label read
 * correctly. Entrances are clip-level (not per-letter) so the digits stay locked in their cells.
 */
const presets: TextPresetDef[] = [
  {
    id: 'counter-big-stat',
    name: 'Big Stat',
    category: 'counter',
    sample: '12,500',
    style: {
      fontFamily: 'Oswald',
      fontWeight: 700,
      fontSize: 260,
      lineHeight: 1,
      letterSpacing: -0.01,
      fill: linear(90, '#ffffff', '#c7d2fe'),
      shadow: { color: '#00000059', blur: 28, x: 0, y: 10 },
    },
    counter: { from: 0, to: 12500, decimals: 0, prefix: '', suffix: '', separator: true, ease: 'easeOutCubic', duration: 2.5 },
    anim: { in: { id: 'pop-in', duration: 0.5 } },
  },
  {
    id: 'counter-percentage',
    name: 'Percentage',
    category: 'counter',
    sample: '87%',
    style: {
      fontFamily: 'Montserrat',
      fontWeight: 900,
      fontSize: 240,
      lineHeight: 1,
      letterSpacing: -0.02,
      fill: linear(20, '#34d399', '#22d3ee'),
      glow: { color: '#22d3ee', blur: 24 },
    },
    counter: { from: 0, to: 87, decimals: 0, prefix: '', suffix: '%', separator: false, ease: 'easeOutQuart', duration: 2 },
    anim: { in: { id: 'zoom-in', duration: 0.45 } },
  },
  {
    id: 'counter-money',
    name: 'Money',
    category: 'counter',
    sample: '$1,250,000',
    style: {
      fontFamily: 'Poppins',
      fontWeight: 800,
      fontSize: 170,
      lineHeight: 1,
      fill: linear(90, '#fde68a', '#f59e0b'),
      stroke: { color: '#3b2506', width: 6 },
      shadow: { color: '#0000008c', blur: 20, x: 0, y: 8 },
    },
    counter: { from: 0, to: 1250000, decimals: 0, prefix: '$', suffix: '', separator: true, ease: 'easeOutExpo', duration: 3 },
    anim: { in: { id: 'slide-up-in', duration: 0.5 } },
  },
  {
    id: 'counter-followers',
    name: 'Followers',
    category: 'counter',
    sample: '100,000 followers',
    style: {
      fontFamily: 'Inter',
      fontWeight: 800,
      fontSize: 96,
      lineHeight: 1,
      fill: { type: 'solid', color: '#ffffff' },
      background: { color: '#e1306c', opacity: 1, padX: 40, padY: 22, radius: 999 },
    },
    counter: { from: 0, to: 100000, decimals: 0, prefix: '', suffix: ' followers', separator: true, ease: 'easeInOutCubic', duration: 3 },
    anim: { in: { id: 'pop-in', duration: 0.45 } },
  },
];

export default presets;
