import { Ease, clamp01, lerp } from '@/core/easing';
import type { GlyphEnv, TextAnimDef } from '../types';

/**
 * Text entrances. The engine staggers the units; `apply` receives the local 0 → 1 progress of
 * one unit and must be exactly neutral at 1. Offsets and blur are in em.
 *
 * Two things shape the numbers below:
 * - A unit only gets `duration / (1 + stagger · (count - 1))` seconds for its own move, so
 *   curves with detail (bounces, springs) use a small stagger and overlap heavily, while plain
 *   fades can afford to run almost one after another.
 * - Text is rasterised with about 2 em of headroom around the block, so no unit travels or
 *   grows further than that.
 */

const TAU = Math.PI * 2;

/** Opacity ramp that completes within the first `portion` of the move, so nothing pops in. */
const fade = (p: number, portion = 0.5): number => Ease.easeOut(clamp01(p / portion));

/**
 * Damped spring 0 → 1 that starts at rest. The first overshoot is exp(-damping / (2 · freq));
 * the curve is normalised so it lands on exactly 1.
 */
function makeSpring(damping: number, freq: number): (t: number) => number {
  const w = freq * TAU;
  const raw = (t: number): number => 1 - Math.exp(-damping * t) * (Math.cos(w * t) + (damping / w) * Math.sin(w * t));
  const norm = 1 / raw(1);
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : raw(t) * norm);
}

/** ≈ 15 % overshoot followed by a 2 % settle. */
const springBouncy = makeSpring(7.5, 2);
/** A pendulum coming to rest: 36 %, 13 %, 5 % … */
const springSwing = makeSpring(4.5, 2.2);

/** Height of a dropped object: 1 at t = 0, lands at t ≈ 0.5, then two small rebounds. */
const dropHeight = (t: number): number => {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  if (t < 0.505) {
    const u = t / 0.505;
    return 1 - u * u;
  }
  if (t < 0.869) {
    const u = (t - 0.505) / 0.364;
    return 0.52 * u * (1 - u);
  }
  const u = (t - 0.869) / 0.131;
  return 0.068 * u * (1 - u);
};

/** Slams down from `from`× size, dips slightly past 1 and recovers. */
const stompScale = (p: number, from: number): number =>
  p < 0.6 ? lerp(from, 0.94, Ease.easeInCubic(p / 0.6)) : lerp(0.94, 1, Ease.easeOut((p - 0.6) / 0.4));

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
    id: 'char-drop-in',
    name: 'Letter Drop',
    kind: 'in',
    unit: 'char',
    duration: 1.2,
    stagger: 0.14,
    apply: (p) => ({ y: -0.9 * dropHeight(p), opacity: fade(p, 0.2) }),
  },
  {
    id: 'char-spring-in',
    name: 'Letter Spring',
    kind: 'in',
    unit: 'char',
    duration: 0.9,
    stagger: 0.2,
    apply: (p) => ({ y: lerp(0.7, 0, Ease.easeOutBack(p)), opacity: fade(p, 0.4) }),
  },
  {
    id: 'char-elastic-in',
    name: 'Letter Elastic',
    kind: 'in',
    unit: 'char',
    duration: 1.3,
    stagger: 0.12,
    apply: (p) => ({ y: lerp(1, 0, springBouncy(p)), opacity: fade(p, 0.3) }),
  },
  {
    id: 'char-slide-in',
    name: 'Letter Slide',
    kind: 'in',
    unit: 'char',
    duration: 0.9,
    stagger: 0.22,
    apply: (p) => ({ x: lerp(0.6, 0, Ease.easeOutCubic(p)), opacity: fade(p, 0.5) }),
  },
  {
    id: 'char-sweep-in',
    name: 'Sweep',
    kind: 'in',
    unit: 'char',
    duration: 1,
    stagger: 0.4,
    // A tiny nudge and a touch of blur per letter: reads as a soft wipe across the line.
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { x: lerp(-0.25, 0, e), blur: lerp(0.1, 0, e), opacity: fade(p, 0.7) };
    },
  },
  {
    id: 'type-soft-in',
    name: 'Soft Type',
    kind: 'in',
    unit: 'char',
    duration: 1.4,
    stagger: 0.8,
    // The typewriter with the edges taken off: each letter fades and settles as it lands.
    apply: (p) => ({ y: lerp(0.12, 0, Ease.easeOutCubic(p)), opacity: fade(p, 0.6) }),
  },

  // ---- Letters: scale and rotation ----------------------------------------------------------
  {
    id: 'char-pop-in',
    name: 'Letter Pop',
    kind: 'in',
    unit: 'char',
    duration: 0.9,
    stagger: 0.2,
    apply: (p) => ({ scale: lerp(0, 1, Ease.easeOutBack(p)), opacity: fade(p, 0.3) }),
  },
  {
    id: 'char-bounce-in',
    name: 'Letter Bounce',
    kind: 'in',
    unit: 'char',
    duration: 1.2,
    stagger: 0.14,
    apply: (p) => ({ scale: lerp(0.3, 1, springBouncy(p)), opacity: fade(p, 0.3) }),
  },
  {
    id: 'char-stomp-in',
    name: 'Letter Stomp',
    kind: 'in',
    unit: 'char',
    duration: 0.9,
    stagger: 0.3,
    apply: (p) => ({ scale: stompScale(p, 2.6), opacity: fade(p, 0.3) }),
  },
  {
    id: 'char-zoom-in',
    name: 'Letter Zoom',
    kind: 'in',
    unit: 'char',
    duration: 0.9,
    stagger: 0.25,
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { scale: lerp(2.4, 1, e), blur: lerp(0.2, 0, e), opacity: fade(p, 0.5) };
    },
  },
  {
    id: 'char-rotate-in',
    name: 'Letter Rotate',
    kind: 'in',
    unit: 'char',
    duration: 0.9,
    stagger: 0.22,
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { rotation: lerp(-45, 0, e), y: lerp(0.35, 0, e), opacity: fade(p, 0.5) };
    },
  },
  {
    id: 'char-flip-in',
    name: 'Letter Flip',
    kind: 'in',
    unit: 'char',
    duration: 1,
    stagger: 0.22,
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { rotation: lerp(180, 0, e), scale: lerp(0.5, 1, e), opacity: fade(p, 0.4) };
    },
  },
  {
    id: 'char-swing-in',
    name: 'Letter Swing',
    kind: 'in',
    unit: 'char',
    duration: 1.4,
    stagger: 0.1,
    apply: (p) => ({ rotation: -40 * (1 - springSwing(p)), opacity: fade(p, 0.25) }),
  },
  {
    id: 'char-blur-in',
    name: 'Letter Blur',
    kind: 'in',
    unit: 'char',
    duration: 1.1,
    stagger: 0.2,
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { blur: lerp(0.35, 0, e), scale: lerp(1.2, 1, e), opacity: fade(p, 0.6) };
    },
  },

  // ---- Letters: whole-text choreography -----------------------------------------------------
  {
    id: 'tracking-in',
    name: 'Tracking In',
    kind: 'in',
    unit: 'char',
    duration: 1.1,
    stagger: 0,
    order: 'forward',
    // Wide letter-spacing that closes up around the middle of the text (best on a single line).
    apply: (p, env) => ({ x: fromCentre(env) * trackStep(env) * (1 - Ease.easeOutExpo(p)), opacity: fade(p, 0.5) }),
  },
  {
    id: 'tracking-expand-in',
    name: 'Expand',
    kind: 'in',
    unit: 'char',
    duration: 1.1,
    stagger: 0,
    order: 'forward',
    // Letters start bunched towards the middle and open out to their natural spacing.
    apply: (p, env) => ({ x: -fromCentre(env) * trackStep(env) * (1 - Ease.easeOutExpo(p)), opacity: fade(p, 0.5) }),
  },
  {
    id: 'scatter-in',
    name: 'Scatter',
    kind: 'in',
    unit: 'char',
    duration: 1.2,
    stagger: 0.1,
    order: 'random',
    apply: (p, env) => {
      const k = 1 - Ease.easeOutExpo(p);
      return {
        x: (rand(env.index, 1) - 0.5) * 3.2 * k,
        y: (rand(env.index, 2) - 0.5) * 2.4 * k,
        rotation: (rand(env.index, 3) - 0.5) * 240 * k,
        scale: 1 - 0.6 * k,
        opacity: fade(p, 0.4),
      };
    },
  },
  {
    id: 'glitch-in',
    name: 'Glitch',
    kind: 'in',
    unit: 'char',
    duration: 0.8,
    stagger: 0.15,
    order: 'random',
    apply: (p, env) => {
      if (p <= 0) return { opacity: 0 };
      if (p >= 1) return {};
      // Eight held frames of jitter that shrink to nothing as the letter locks in.
      const frame = env.index * 17 + Math.floor(p * 8);
      const k = (1 - p) * (1 - p);
      return {
        x: (rand(frame, 1) - 0.5) * 0.9 * k,
        y: (rand(frame, 2) - 0.5) * 0.3 * k,
        opacity: p > 0.7 || rand(frame, 3) > 0.3 ? 1 : 0.2,
      };
    },
  },
  {
    id: 'cascade-center-in',
    name: 'Center Cascade',
    kind: 'in',
    unit: 'char',
    duration: 1,
    stagger: 0.25,
    order: 'center',
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { y: lerp(0.5, 0, e), scale: lerp(0.8, 1, e), opacity: fade(p, 0.5) };
    },
  },
  {
    id: 'cascade-edges-in',
    name: 'Edge Cascade',
    kind: 'in',
    unit: 'char',
    duration: 1,
    stagger: 0.25,
    order: 'edges',
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { scale: lerp(1.6, 1, e), blur: lerp(0.15, 0, e), opacity: fade(p, 0.5) };
    },
  },
  {
    id: 'random-fade-in',
    name: 'Random Fade',
    kind: 'in',
    unit: 'char',
    duration: 1.2,
    stagger: 0.3,
    order: 'random',
    apply: (p) => ({ opacity: Ease.easeOut(p), blur: lerp(0.12, 0, Ease.easeOutCubic(p)) }),
  },
  {
    id: 'random-pop-in',
    name: 'Random Pop',
    kind: 'in',
    unit: 'char',
    duration: 1.1,
    stagger: 0.3,
    order: 'random',
    apply: (p) => ({ scale: lerp(0, 1, Ease.easeOutBack(p)), opacity: fade(p, 0.3) }),
  },

  // ---- Words --------------------------------------------------------------------------------
  {
    id: 'word-fade-in',
    name: 'Word Fade',
    kind: 'in',
    unit: 'word',
    duration: 1,
    stagger: 0.6,
    apply: (p) => ({ opacity: Ease.easeOut(p) }),
  },
  {
    id: 'word-rise-in',
    name: 'Word Rise',
    kind: 'in',
    unit: 'word',
    duration: 0.9,
    stagger: 0.6,
    apply: (p) => ({ y: lerp(0.5, 0, Ease.easeOutCubic(p)), opacity: fade(p, 0.5) }),
  },
  {
    id: 'word-slide-in',
    name: 'Word Slide',
    kind: 'in',
    unit: 'word',
    duration: 0.9,
    stagger: 0.6,
    apply: (p) => ({ x: lerp(-0.6, 0, Ease.easeOutCubic(p)), opacity: fade(p, 0.5) }),
  },
  {
    id: 'word-drop-in',
    name: 'Word Drop',
    kind: 'in',
    unit: 'word',
    duration: 1.2,
    stagger: 0.4,
    apply: (p) => ({ y: -0.7 * dropHeight(p), opacity: fade(p, 0.2) }),
  },
  {
    id: 'word-blur-in',
    name: 'Word Blur',
    kind: 'in',
    unit: 'word',
    duration: 1.1,
    stagger: 0.6,
    apply: (p) => ({ blur: lerp(0.3, 0, Ease.easeOutCubic(p)), opacity: fade(p, 0.6) }),
  },
  {
    id: 'word-spring-in',
    name: 'Word Spring',
    kind: 'in',
    unit: 'word',
    duration: 1.2,
    stagger: 0.4,
    apply: (p) => ({ scale: lerp(0.5, 1, springBouncy(p)), opacity: fade(p, 0.3) }),
  },
  {
    id: 'word-spin-in',
    name: 'Word Spin',
    kind: 'in',
    unit: 'word',
    duration: 1,
    stagger: 0.5,
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { rotation: lerp(-180, 0, e), scale: lerp(0.3, 1, e), opacity: fade(p, 0.4) };
    },
  },
  {
    id: 'word-stomp-in',
    name: 'Word Stomp',
    kind: 'in',
    unit: 'word',
    duration: 1,
    stagger: 0.9,
    apply: (p) => ({ scale: stompScale(p, 1.6), opacity: fade(p, 0.25) }),
  },
  {
    id: 'word-punch-in',
    name: 'Word Punch',
    kind: 'in',
    unit: 'word',
    duration: 1.2,
    stagger: 1,
    // One word at a time, the way spoken captions are cut: appears big and snaps to size.
    apply: (p) => ({ scale: lerp(1.35, 1, Ease.easeOutBack(p)), opacity: fade(p, 0.15) }),
  },

  // ---- Lines --------------------------------------------------------------------------------
  {
    id: 'line-rise-in',
    name: 'Line Rise',
    kind: 'in',
    unit: 'line',
    duration: 0.9,
    stagger: 0.5,
    apply: (p) => ({ y: lerp(0.8, 0, Ease.easeOutQuart(p)), opacity: fade(p, 0.5) }),
  },
  {
    id: 'line-drop-in',
    name: 'Line Drop',
    kind: 'in',
    unit: 'line',
    duration: 0.9,
    stagger: 0.5,
    apply: (p) => ({ y: lerp(-0.8, 0, Ease.easeOutQuart(p)), opacity: fade(p, 0.5) }),
  },
  {
    id: 'line-glide-in',
    name: 'Line Glide',
    kind: 'in',
    unit: 'line',
    duration: 1,
    stagger: 0.45,
    apply: (p) => ({ x: lerp(1.6, 0, Ease.easeOutExpo(p)), blur: lerp(0.12, 0, Ease.easeOutCubic(p)), opacity: fade(p, 0.6) }),
  },
  {
    id: 'line-zoom-in',
    name: 'Line Zoom',
    kind: 'in',
    unit: 'line',
    duration: 0.9,
    stagger: 0.5,
    apply: (p) => ({ scale: lerp(0.8, 1, Ease.easeOutCubic(p)), opacity: fade(p, 0.6) }),
  },
  {
    id: 'line-blur-in',
    name: 'Line Blur',
    kind: 'in',
    unit: 'line',
    duration: 1.1,
    stagger: 0.5,
    apply: (p) => ({ blur: lerp(0.4, 0, Ease.easeOutCubic(p)), opacity: fade(p, 0.6) }),
  },
];

export default textAnimations;
