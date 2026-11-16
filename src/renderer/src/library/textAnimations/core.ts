import { Ease, lerp } from '@/core/easing';
import type { TextAnimDef } from '../types';

/** Core text animations the app relies on by id. Do not rename or remove. */
const textAnimations: TextAnimDef[] = [
  // ---- In ---------------------------------------------------------------------------------
  {
    id: 'typewriter',
    name: 'Typewriter',
    kind: 'in',
    unit: 'char',
    duration: 1.2,
    stagger: 1,
    apply: (p) => ({ opacity: p > 0 ? 1 : 0 }),
  },
  {
    id: 'char-fade-in',
    name: 'Letter Fade',
    kind: 'in',
    unit: 'char',
    duration: 0.9,
    stagger: 0.6,
    apply: (p) => ({ opacity: Ease.easeOut(p) }),
  },
  {
    id: 'char-rise-in',
    name: 'Letter Rise',
    kind: 'in',
    unit: 'char',
    duration: 0.9,
    stagger: 0.5,
    apply: (p) => ({ y: lerp(0.6, 0, Ease.easeOutCubic(p)), opacity: Ease.easeOut(Math.min(1, p * 2)) }),
  },
  {
    id: 'word-pop-in',
    name: 'Word Pop',
    kind: 'in',
    unit: 'word',
    duration: 0.9,
    stagger: 0.7,
    apply: (p) => ({ scale: lerp(0.3, 1, Ease.easeOutBack(p)), opacity: Math.min(1, p * 3) }),
  },
  {
    id: 'line-slide-in',
    name: 'Line Slide',
    kind: 'in',
    unit: 'line',
    duration: 0.8,
    stagger: 0.5,
    apply: (p) => ({ x: lerp(-1.2, 0, Ease.easeOutCubic(p)), opacity: Ease.easeOut(Math.min(1, p * 2)) }),
  },

  // ---- Out --------------------------------------------------------------------------------
  {
    id: 'char-fade-out',
    name: 'Letter Fade',
    kind: 'out',
    unit: 'char',
    duration: 0.7,
    stagger: 0.6,
    apply: (p) => ({ opacity: 1 - Ease.easeIn(p) }),
  },
  {
    id: 'char-fall-out',
    name: 'Letter Fall',
    kind: 'out',
    unit: 'char',
    duration: 0.8,
    stagger: 0.5,
    apply: (p) => ({ y: lerp(0, 0.8, Ease.easeInCubic(p)), rotation: lerp(0, 18, Ease.easeIn(p)), opacity: 1 - Ease.easeIn(p) }),
  },

  // ---- Loop -------------------------------------------------------------------------------
  {
    id: 'wave',
    name: 'Wave',
    kind: 'loop',
    unit: 'char',
    duration: 1.6,
    stagger: 0.12,
    apply: (p) => ({ y: -0.12 * Math.sin(p * Math.PI * 2) }),
  },
  {
    id: 'jitter',
    name: 'Wiggle',
    kind: 'loop',
    unit: 'char',
    duration: 0.8,
    stagger: 0.37,
    apply: (p) => ({ rotation: 5 * Math.sin(p * Math.PI * 2) }),
  },
];

export default textAnimations;
