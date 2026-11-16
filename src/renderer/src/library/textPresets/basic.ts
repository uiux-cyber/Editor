import { solid } from '@/core/factory';
import type { TextPresetDef } from '../types';

/** Neutral building blocks: no effects, just well-set type. They complete the core Heading / Subheading / Body. */
const presets: TextPresetDef[] = [
  {
    id: 'basic-display',
    name: 'Display',
    category: 'basic',
    sample: 'Big Display',
    style: { fontFamily: 'Inter', fontWeight: 900, fontSize: 190, letterSpacing: -0.035, lineHeight: 1 },
  },
  {
    id: 'basic-light-heading',
    name: 'Light Heading',
    category: 'basic',
    sample: 'Light heading',
    style: { fontFamily: 'Inter', fontWeight: 300, fontSize: 120, letterSpacing: -0.015 },
  },
  {
    id: 'basic-serif-heading',
    name: 'Serif Heading',
    category: 'basic',
    sample: 'Serif heading',
    style: { fontFamily: 'DM Serif Display', fontWeight: 400, fontSize: 128, letterSpacing: -0.005 },
  },
  {
    id: 'basic-eyebrow',
    name: 'Eyebrow',
    category: 'basic',
    sample: 'SECTION LABEL',
    style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 36, uppercase: true, letterSpacing: 0.24 },
  },
  {
    id: 'basic-paragraph',
    name: 'Paragraph',
    category: 'basic',
    sample: 'A longer paragraph runs over\nseveral lines and stays easy to read.',
    style: { fontFamily: 'Inter', fontWeight: 400, fontSize: 44, lineHeight: 1.45, align: 'left' },
  },
  {
    id: 'basic-quote',
    name: 'Quote',
    category: 'basic',
    sample: '“Words worth\nremembering.”',
    style: { fontFamily: 'Playfair Display', fontWeight: 500, fontSize: 76, italic: true, lineHeight: 1.25 },
  },
  {
    id: 'basic-mono',
    name: 'Mono',
    category: 'basic',
    sample: 'monospace_text',
    style: { fontFamily: 'JetBrains Mono', fontWeight: 500, fontSize: 48 },
  },
  {
    id: 'basic-big-number',
    name: 'Big Number',
    category: 'basic',
    sample: '100%',
    style: { fontFamily: 'Oswald', fontWeight: 700, fontSize: 280, letterSpacing: -0.01, lineHeight: 1 },
  },
  {
    id: 'basic-outline',
    name: 'Outline',
    category: 'basic',
    sample: 'Outline',
    // Hollow looks use static fonts: variable fonts keep overlapping contours, which a stroke exposes.
    style: {
      fontFamily: 'Poppins',
      fontWeight: 800,
      fontSize: 140,
      fill: solid('#ffffff00'),
      stroke: { color: '#ffffff', width: 4 },
    },
  },
  {
    id: 'basic-soft-shadow',
    name: 'Soft Shadow',
    category: 'basic',
    sample: 'Soft shadow',
    style: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 110, shadow: { color: '#00000080', blur: 24, x: 0, y: 10 } },
  },
  {
    id: 'basic-button',
    name: 'Button',
    category: 'basic',
    sample: 'Learn more',
    style: {
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSize: 46,
      fill: solid('#111318'),
      background: { color: '#ffffff', opacity: 1, padX: 48, padY: 24, radius: 999 },
    },
  },
];

export default presets;
