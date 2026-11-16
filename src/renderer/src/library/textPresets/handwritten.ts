import { linear, solid } from '@/core/factory';
import type { TextPresetDef } from '../types';

/** Hand lettering: pen notes, markers, brush scripts and sticky notes. */
const presets: TextPresetDef[] = [
  {
    id: 'hand-quick-note',
    name: 'Quick Note',
    category: 'handwritten',
    sample: 'note to self',
    style: { fontFamily: 'Caveat', fontWeight: 600, fontSize: 110 },
    textAnim: { in: { id: 'type-soft-in', duration: 1.2 } },
  },
  {
    id: 'hand-marker',
    name: 'Marker',
    category: 'handwritten',
    sample: 'Do it today',
    style: { fontFamily: 'Permanent Marker', fontWeight: 400, fontSize: 120 },
    anim: { in: { id: 'wipe-right-in', duration: 0.7 } },
  },
  {
    id: 'hand-sticky-note',
    name: 'Sticky Note',
    category: 'handwritten',
    sample: 'don’t forget\nto smile',
    style: {
      fontFamily: 'Caveat',
      fontWeight: 700,
      fontSize: 84,
      lineHeight: 1.05,
      fill: solid('#3a2f00'),
      background: { color: '#ffe873', opacity: 1, padX: 44, padY: 28, radius: 6 },
    },
    // Dropped onto the screen like a note stuck up by its top edge.
    anim: { in: { id: 'swing-in', duration: 1 } },
  },
  {
    id: 'hand-flowing-script',
    name: 'Flowing Script',
    category: 'handwritten',
    sample: 'Hello Sunshine',
    style: { fontFamily: 'Dancing Script', fontWeight: 700, fontSize: 140 },
    textAnim: { in: { id: 'char-sweep-in', duration: 1.1 } },
  },
  {
    id: 'hand-chalkboard',
    name: 'Chalkboard',
    category: 'handwritten',
    sample: 'Today’s Special',
    style: { fontFamily: 'Caveat', fontWeight: 500, fontSize: 120, fill: solid('#f5f5ef'), glow: { color: '#ffffff66', blur: 8 } },
  },
  {
    id: 'hand-brush',
    name: 'Brush Lettering',
    category: 'handwritten',
    sample: 'Stay Wild',
    style: { fontFamily: 'Pacifico', fontWeight: 400, fontSize: 130, shadow: { color: '#00000073', blur: 18, x: 0, y: 8 } },
  },
  {
    id: 'hand-scribble-label',
    name: 'Scribble Label',
    category: 'handwritten',
    sample: 'look here!',
    style: { fontFamily: 'Caveat', fontWeight: 700, fontSize: 96, fill: solid('#ffe14d'), stroke: { color: '#000000', width: 6 } },
    textAnim: { loop: { id: 'char-wobble', duration: 1.2 } },
  },
  {
    id: 'hand-love-letter',
    name: 'Love Letter',
    category: 'handwritten',
    sample: 'xoxo, me',
    style: { fontFamily: 'Dancing Script', fontWeight: 500, fontSize: 110, fill: solid('#ffd9e3') },
  },
  {
    id: 'hand-red-pen',
    name: 'Red Pen',
    category: 'handwritten',
    sample: 'IMPORTANT',
    style: { fontFamily: 'Permanent Marker', fontWeight: 400, fontSize: 100, underline: true, fill: solid('#ff3b3b') },
  },
  {
    id: 'hand-sign-off',
    name: 'Sign Off',
    category: 'handwritten',
    sample: '— thanks for watching',
    style: { fontFamily: 'Caveat', fontWeight: 400, fontSize: 110 },
  },
  {
    id: 'hand-doodle-title',
    name: 'Doodle Title',
    category: 'handwritten',
    sample: 'Summer Diary',
    style: { fontFamily: 'Caveat', fontWeight: 700, fontSize: 170, fill: linear(0, '#ffd86b', '#ff8fa3') },
    textAnim: { in: { id: 'char-bounce-in', duration: 1.1 } },
  },
];

export default presets;
