import { Ease, lerp } from '@/core/easing';
import type { AnimationDef } from '../types';

/** Core animations the app relies on by id. Do not rename or remove. */
const animations: AnimationDef[] = [
  // ---- In ---------------------------------------------------------------------------------
  { id: 'fade-in', name: 'Fade', kind: 'in', duration: 0.5, apply: (p) => ({ opacity: Ease.easeOut(p) }) },
  {
    id: 'zoom-in',
    name: 'Zoom In',
    kind: 'in',
    duration: 0.6,
    apply: (p) => ({ scale: lerp(0.6, 1, Ease.easeOutCubic(p)), opacity: Ease.easeOut(Math.min(1, p * 2)) }),
  },
  {
    id: 'slide-up-in',
    name: 'Slide Up',
    kind: 'in',
    duration: 0.6,
    apply: (p, env) => ({ y: lerp(env.h * 0.35 + 60, 0, Ease.easeOutCubic(p)), opacity: Ease.easeOut(Math.min(1, p * 2)) }),
  },
  {
    id: 'pop-in',
    name: 'Pop',
    kind: 'in',
    duration: 0.5,
    apply: (p) => ({ scale: lerp(0, 1, Ease.easeOutBack(p)), opacity: Math.min(1, p * 4) }),
  },
  {
    id: 'wipe-right-in',
    name: 'Wipe Right',
    kind: 'in',
    duration: 0.6,
    apply: (p) => ({ clipR: 1 - Ease.easeInOutCubic(p) }),
  },
  {
    id: 'blur-in',
    name: 'Blur In',
    kind: 'in',
    duration: 0.7,
    apply: (p) => ({ blur: lerp(60, 0, Ease.easeOutCubic(p)), opacity: Ease.easeOut(Math.min(1, p * 1.6)) }),
  },

  // ---- Out --------------------------------------------------------------------------------
  { id: 'fade-out', name: 'Fade', kind: 'out', duration: 0.5, apply: (p) => ({ opacity: 1 - Ease.easeIn(p) }) },
  {
    id: 'zoom-out',
    name: 'Zoom Out',
    kind: 'out',
    duration: 0.6,
    apply: (p) => ({ scale: lerp(1, 0.6, Ease.easeInCubic(p)), opacity: 1 - Ease.easeIn(Math.max(0, p * 2 - 1)) }),
  },
  {
    id: 'slide-down-out',
    name: 'Slide Down',
    kind: 'out',
    duration: 0.6,
    apply: (p, env) => ({ y: lerp(0, env.h * 0.35 + 60, Ease.easeInCubic(p)), opacity: 1 - Ease.easeIn(Math.max(0, p * 2 - 1)) }),
  },
  {
    id: 'pop-out',
    name: 'Pop',
    kind: 'out',
    duration: 0.4,
    apply: (p) => ({ scale: lerp(1, 0, Ease.easeInBack(p)), opacity: 1 - Math.max(0, p * 4 - 3) }),
  },

  // ---- Loop -------------------------------------------------------------------------------
  {
    id: 'pulse',
    name: 'Pulse',
    kind: 'loop',
    duration: 1.2,
    apply: (p) => ({ scale: 1 + 0.06 * (0.5 - 0.5 * Math.cos(p * Math.PI * 2)) }),
  },
  {
    id: 'float',
    name: 'Float',
    kind: 'loop',
    duration: 3,
    apply: (p) => ({ y: -18 * Math.sin(p * Math.PI * 2) }),
  },
  {
    id: 'spin',
    name: 'Spin',
    kind: 'loop',
    duration: 4,
    // 0° and 360° are the same pose, so report the rotation modulo a full turn.
    apply: (p) => ({ rotation: (p % 1) * 360 }),
  },
];

export default animations;
