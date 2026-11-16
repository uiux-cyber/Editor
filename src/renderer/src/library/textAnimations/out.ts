import { Ease, clamp01, lerp } from '@/core/easing';
import type { GlyphEnv, TextAnimDef } from '../types';

/**
 * Text exits. The engine staggers the units; `apply` receives the local 0 → 1 progress of one
 * unit and must be exactly neutral at 0. Offsets and blur are in em.
 *
 * As for the entrances: a unit only gets `duration / (1 + stagger · (count - 1))` seconds for
 * its own move, and text is rasterised with about 2 em of headroom, so nothing travels or grows
 * further than that.
 */

/** Opacity ramp that only starts in the last `portion` of the move. */
const fadeOut = (p: number, portion = 0.5): number => 1 - Ease.easeIn(clamp01((p - (1 - portion)) / portion));

/** Deterministic 0..1 pseudo-random value for a unit index and a salt. */
const rand = (index: number, salt: number): number => {
  let h = Math.imul((index | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/** Signed position of a unit relative to the middle of the text, counted in units. */
const fromCentre = (env: GlyphEnv): number => env.index - (Math.max(1, env.count) - 1) / 2;

/** Extra letter-spacing (em) for the tracking animations; the outermost letter moves at most 1.6 em. */
const trackStep = (env: GlyphEnv): number => Math.min(0.4, 1.6 / Math.max(1, (env.count - 1) / 2));

const textAnimations: TextAnimDef[] = [
  // ---- Letters: movement --------------------------------------------------------------------
  {
    id: 'char-rise-out',
    name: 'Letter Rise',
    kind: 'out',
    unit: 'char',
    duration: 0.8,
    stagger: 0.22,
    apply: (p) => ({ y: lerp(0, -0.6, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.5) }),
  },
  {
    id: 'char-spring-out',
    name: 'Letter Spring',
    kind: 'out',
    unit: 'char',
    duration: 0.8,
    stagger: 0.2,
    // Lifts a touch before dropping away.
    apply: (p) => ({ y: 0.7 * Ease.easeInBack(p), opacity: fadeOut(p, 0.4) }),
  },
  {
    id: 'char-slide-out',
    name: 'Letter Slide',
    kind: 'out',
    unit: 'char',
    duration: 0.8,
    stagger: 0.22,
    apply: (p) => ({ x: lerp(0, -0.6, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.5) }),
  },
  {
    id: 'char-sweep-out',
    name: 'Sweep',
    kind: 'out',
    unit: 'char',
    duration: 0.9,
    stagger: 0.4,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { x: lerp(0, 0.25, e), blur: lerp(0, 0.1, e), opacity: fadeOut(p, 0.7) };
    },
  },
  {
    id: 'backspace',
    name: 'Backspace',
    kind: 'out',
    unit: 'char',
    duration: 1,
    stagger: 1,
    order: 'reverse',
    // The typewriter in reverse: letters vanish one by one from the end.
    apply: (p) => ({ opacity: p > 0 ? 0 : 1 }),
  },

  // ---- Letters: scale and rotation ----------------------------------------------------------
  {
    id: 'char-pop-out',
    name: 'Letter Pop',
    kind: 'out',
    unit: 'char',
    duration: 0.8,
    stagger: 0.2,
    apply: (p) => ({ scale: lerp(1, 0, Ease.easeInBack(p)), opacity: fadeOut(p, 0.3) }),
  },
  {
    id: 'char-zoom-out',
    name: 'Letter Zoom',
    kind: 'out',
    unit: 'char',
    duration: 0.8,
    stagger: 0.25,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { scale: lerp(1, 2.4, e), blur: lerp(0, 0.2, e), opacity: fadeOut(p, 0.5) };
    },
  },
  {
    id: 'char-rotate-out',
    name: 'Letter Rotate',
    kind: 'out',
    unit: 'char',
    duration: 0.8,
    stagger: 0.22,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { rotation: lerp(0, 45, e), y: lerp(0, 0.35, e), opacity: fadeOut(p, 0.5) };
    },
  },
  {
    id: 'char-flip-out',
    name: 'Letter Flip',
    kind: 'out',
    unit: 'char',
    duration: 0.9,
    stagger: 0.22,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { rotation: lerp(0, -180, e), scale: lerp(1, 0.5, e), opacity: fadeOut(p, 0.4) };
    },
  },
  {
    id: 'char-blur-out',
    name: 'Letter Blur',
    kind: 'out',
    unit: 'char',
    duration: 0.9,
    stagger: 0.2,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { blur: lerp(0, 0.35, e), scale: lerp(1, 1.2, e), opacity: fadeOut(p, 0.6) };
    },
  },

  // ---- Letters: whole-text choreography -----------------------------------------------------
  {
    id: 'tracking-out',
    name: 'Tracking Out',
    kind: 'out',
    unit: 'char',
    duration: 0.9,
    stagger: 0,
    order: 'forward',
    // Letter-spacing opens up around the middle of the text as it fades (best on a single line).
    apply: (p, env) => ({ x: fromCentre(env) * trackStep(env) * Ease.easeInCubic(p), opacity: fadeOut(p, 0.6) }),
  },
  {
    id: 'tracking-collapse-out',
    name: 'Collapse',
    kind: 'out',
    unit: 'char',
    duration: 0.9,
    stagger: 0,
    order: 'forward',
    apply: (p, env) => ({ x: -fromCentre(env) * trackStep(env) * Ease.easeInCubic(p), opacity: fadeOut(p, 0.6) }),
  },
  {
    id: 'scatter-out',
    name: 'Scatter',
    kind: 'out',
    unit: 'char',
    duration: 1,
    stagger: 0.1,
    order: 'random',
    apply: (p, env) => {
      const k = Ease.easeInCubic(p);
      return {
        x: (rand(env.index, 1) - 0.5) * 3.2 * k,
        y: (rand(env.index, 2) - 0.5) * 2.4 * k,
        rotation: (rand(env.index, 3) - 0.5) * 240 * k,
        scale: 1 - 0.6 * k,
        opacity: fadeOut(p, 0.4),
      };
    },
  },
  {
    id: 'glitch-out',
    name: 'Glitch',
    kind: 'out',
    unit: 'char',
    duration: 0.7,
    stagger: 0.15,
    order: 'random',
    apply: (p, env) => {
      if (p <= 0) return {};
      if (p >= 1) return { opacity: 0 };
      // Eight held frames of jitter that grow as the letter breaks up.
      const frame = env.index * 17 + Math.floor(p * 8);
      const k = p * p;
      return {
        x: (rand(frame, 1) - 0.5) * 0.9 * k,
        y: (rand(frame, 2) - 0.5) * 0.3 * k,
        opacity: (p < 0.3 || rand(frame, 3) > 0.3 ? 1 : 0.2) * fadeOut(p, 0.25),
      };
    },
  },
  {
    id: 'cascade-center-out',
    name: 'Center Cascade',
    kind: 'out',
    unit: 'char',
    duration: 0.9,
    stagger: 0.25,
    order: 'center',
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { y: lerp(0, 0.5, e), scale: lerp(1, 0.8, e), opacity: fadeOut(p, 0.5) };
    },
  },
  {
    id: 'cascade-edges-out',
    name: 'Edge Cascade',
    kind: 'out',
    unit: 'char',
    duration: 0.9,
    stagger: 0.25,
    order: 'edges',
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { scale: lerp(1, 1.6, e), blur: lerp(0, 0.15, e), opacity: fadeOut(p, 0.5) };
    },
  },
  {
    id: 'random-fade-out',
    name: 'Random Fade',
    kind: 'out',
    unit: 'char',
    duration: 1,
    stagger: 0.3,
    order: 'random',
    apply: (p) => ({ opacity: 1 - Ease.easeIn(p), blur: lerp(0, 0.12, Ease.easeInCubic(p)) }),
  },
  {
    id: 'random-pop-out',
    name: 'Random Pop',
    kind: 'out',
    unit: 'char',
    duration: 0.9,
    stagger: 0.3,
    order: 'random',
    apply: (p) => ({ scale: lerp(1, 0, Ease.easeInBack(p)), opacity: fadeOut(p, 0.3) }),
  },

  // ---- Words --------------------------------------------------------------------------------
  {
    id: 'word-fade-out',
    name: 'Word Fade',
    kind: 'out',
    unit: 'word',
    duration: 0.8,
    stagger: 0.6,
    apply: (p) => ({ opacity: 1 - Ease.easeIn(p) }),
  },
  {
    id: 'word-rise-out',
    name: 'Word Rise',
    kind: 'out',
    unit: 'word',
    duration: 0.8,
    stagger: 0.6,
    apply: (p) => ({ y: lerp(0, -0.5, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.5) }),
  },
  {
    id: 'word-slide-out',
    name: 'Word Slide',
    kind: 'out',
    unit: 'word',
    duration: 0.8,
    stagger: 0.6,
    apply: (p) => ({ x: lerp(0, 0.6, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.5) }),
  },
  {
    id: 'word-drop-out',
    name: 'Word Drop',
    kind: 'out',
    unit: 'word',
    duration: 0.9,
    stagger: 0.4,
    // A small hop (the back-ease dips negative) before the word falls away.
    apply: (p) => ({ y: 0.9 * Ease.easeInBack(p), opacity: fadeOut(p, 0.4) }),
  },
  {
    id: 'word-blur-out',
    name: 'Word Blur',
    kind: 'out',
    unit: 'word',
    duration: 0.9,
    stagger: 0.6,
    apply: (p) => ({ blur: lerp(0, 0.3, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.6) }),
  },
  {
    id: 'word-pop-out',
    name: 'Word Pop',
    kind: 'out',
    unit: 'word',
    duration: 0.8,
    stagger: 0.6,
    apply: (p) => ({ scale: lerp(1, 0.3, Ease.easeInBack(p)), opacity: fadeOut(p, 0.35) }),
  },
  {
    id: 'word-punch-out',
    name: 'Word Punch',
    kind: 'out',
    unit: 'word',
    duration: 0.9,
    stagger: 0.8,
    apply: (p) => ({ scale: lerp(1, 1.35, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.6) }),
  },
  {
    id: 'word-spin-out',
    name: 'Word Spin',
    kind: 'out',
    unit: 'word',
    duration: 0.9,
    stagger: 0.5,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { rotation: lerp(0, 180, e), scale: lerp(1, 0.3, e), opacity: fadeOut(p, 0.4) };
    },
  },

  // ---- Lines --------------------------------------------------------------------------------
  {
    id: 'line-rise-out',
    name: 'Line Rise',
    kind: 'out',
    unit: 'line',
    duration: 0.8,
    stagger: 0.5,
    apply: (p) => ({ y: lerp(0, -0.8, Ease.easeInQuart(p)), opacity: fadeOut(p, 0.5) }),
  },
  {
    id: 'line-drop-out',
    name: 'Line Drop',
    kind: 'out',
    unit: 'line',
    duration: 0.8,
    stagger: 0.5,
    apply: (p) => ({ y: lerp(0, 0.8, Ease.easeInQuart(p)), opacity: fadeOut(p, 0.5) }),
  },
  {
    id: 'line-slide-out',
    name: 'Line Slide',
    kind: 'out',
    unit: 'line',
    duration: 0.8,
    stagger: 0.5,
    apply: (p) => ({ x: lerp(0, 1.2, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.5) }),
  },
  {
    id: 'line-glide-out',
    name: 'Line Glide',
    kind: 'out',
    unit: 'line',
    duration: 0.9,
    stagger: 0.45,
    apply: (p) => ({ x: lerp(0, -1.6, Ease.easeInExpo(p)), blur: lerp(0, 0.12, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.6) }),
  },
  {
    id: 'line-zoom-out',
    name: 'Line Zoom',
    kind: 'out',
    unit: 'line',
    duration: 0.8,
    stagger: 0.5,
    apply: (p) => ({ scale: lerp(1, 0.8, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.6) }),
  },
  {
    id: 'line-blur-out',
    name: 'Line Blur',
    kind: 'out',
    unit: 'line',
    duration: 0.9,
    stagger: 0.5,
    apply: (p) => ({ blur: lerp(0, 0.4, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.6) }),
  },
];

export default textAnimations;
