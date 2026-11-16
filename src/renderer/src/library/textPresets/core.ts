import { linear } from '@/core/factory';
import type { TextPresetDef } from '../types';

/** Core text presets the app relies on by id. Do not rename or remove. */
const presets: TextPresetDef[] = [
  {
    id: 'basic-heading',
    name: 'Heading',
    category: 'basic',
    sample: 'Add a heading',
    style: { fontFamily: 'Inter', fontWeight: 800, fontSize: 120, letterSpacing: -0.02 },
  },
  {
    id: 'basic-subheading',
    name: 'Subheading',
    category: 'basic',
    sample: 'Add a subheading',
    style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 72 },
  },
  {
    id: 'basic-body',
    name: 'Body',
    category: 'basic',
    sample: 'Add a little bit of body text',
    style: { fontFamily: 'Inter', fontWeight: 400, fontSize: 48, lineHeight: 1.3 },
  },
  {
    id: 'caption-box',
    name: 'Caption Box',
    category: 'caption',
    sample: 'Caption goes here',
    style: {
      fontFamily: 'Inter',
      fontWeight: 600,
      fontSize: 54,
      background: { color: '#000000', opacity: 0.72, padX: 28, padY: 14, radius: 14 },
    },
  },
  {
    id: 'gradient-title',
    name: 'Gradient Title',
    category: 'title',
    sample: 'BIG IDEAS',
    style: {
      fontFamily: 'Montserrat',
      fontWeight: 900,
      fontSize: 150,
      uppercase: true,
      letterSpacing: 0.02,
      fill: linear(20, '#7c5cff', '#22d3ee'),
      shadow: { color: '#00000066', blur: 30, x: 0, y: 12 },
    },
    textAnim: { in: { id: 'char-rise-in', duration: 0.9 } },
  },
];

export default presets;
