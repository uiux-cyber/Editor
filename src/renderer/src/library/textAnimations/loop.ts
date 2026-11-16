import { Ease, clamp01, lerp } from '@/core/easing';
import type { TextAnimDef } from '../types';

/**
 * Looping text animations. `p` is the phase 0 → 1 of one period, already offset per unit by
 * `stagger`, so each `apply` is a pure, seamless function of the phase (apply(0) ≡ apply(1)).
 * Offsets are in em.
 */

const TAU = Math.PI * 2;

/** Phase wrapped into [0, 1). */
const wrap = (p: number): number => p - Math.floor(p);

/** 0 → 1 → 0 over one period with zero slope at both ends. */
const swell = (p: number): number => 0.5 - 0.5 * Math.cos(p * TAU);

/** Smoothly interpolated keyframes; `keys` is a flat [t0, v0, t1, v1, …] list with ascending t. */
const track = (keys: readonly number[], t: number): number => {
  if (t <= keys[0]) return keys[1];
  for (let i = 2; i < keys.length; i += 2) {
    if (t <= keys[i]) {
      const u = (t - keys[i - 2]) / (keys[i] - keys[i - 2]);
      return lerp(keys[i - 1], keys[i + 1], u * u * (3 - 2 * u));
    }
  }
  return keys[keys.length - 1];
};

/** Deterministic 0..1 pseudo-random value for an integer and a salt. */
const rand = (n: number, salt: number): number => {
  let h = Math.imul((n | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/** "Lub-dub": a strong beat, a softer echo, then a rest. */
const HEARTBEAT = [0, 0, 0.07, 1, 0.16, 0.12, 0.25, 0.7, 0.42, 0, 1, 0];
/** Flicker dips as [centre, half-width, depth] triples. */
const FLICKER = [0.1, 0.018, 0.6, 0.14, 0.014, 0.9, 0.47, 0.02, 0.4, 0.71, 0.014, 0.8, 0.75, 0.024, 0.5];

const textAnimations: TextAnimDef[] = [
  // ---- Waves (a small stagger makes the motion travel along the text) -----------------------
  {
    id: 'wave-big',
    name: 'Big Wave',
    kind: 'loop',
    unit: 'char',
    duration: 1.8,
    stagger: 0.1,
    apply: (p) => ({ y: -0.28 * Math.sin(p * TAU) }),
  },
  {
    id: 'wave-roll',
    name: 'Rolling Wave',
    kind: 'loop',
    unit: 'char',
    duration: 2,
    stagger: 0.1,
    // Letters lean into the slope of the wave they ride.
    apply: (p) => ({ y: -0.14 * Math.sin(p * TAU), rotation: 8 * Math.cos(p * TAU) }),
  },
  {
    id: 'ripple',
    name: 'Ripple',
    kind: 'loop',
    unit: 'char',
    duration: 1.6,
    stagger: 0.1,
    apply: (p) => ({ scale: 1 + 0.16 * swell(p) }),
  },
  {
    id: 'fade-wave',
    name: 'Fade Wave',
    kind: 'loop',
    unit: 'char',
    duration: 1.8,
    stagger: 0.1,
    apply: (p) => ({ opacity: 1 - 0.6 * swell(p) }),
  },
  {
    id: 'char-bounce',
    name: 'Bounce',
    kind: 'loop',
    unit: 'char',
    duration: 1.4,
    stagger: 0.07,
    apply: (p) => {
      // A quick hop, then a rest while the hop runs through the other letters.
      const u = wrap(p) / 0.35;
      return u < 1 ? { y: -0.3 * 4 * u * (1 - u) } : {};
    },
  },
  {
    id: 'char-pulse',
    name: 'Letter Pulse',
    kind: 'loop',
    unit: 'char',
    duration: 1.6,
    stagger: 0.06,
    apply: (p) => {
      const u = wrap(p) / 0.3;
      return u < 1 ? { scale: 1 + 0.22 * (0.5 - 0.5 * Math.cos(u * TAU)) } : {};
    },
  },
  {
    id: 'roller',
    name: 'Roller',
    kind: 'loop',
    unit: 'char',
    duration: 2.4,
    stagger: 0.05,
    apply: (p) => {
      // Rolls out through the top and back in from below, like a split-flap display.
      const t = wrap(p);
      if (t < 0.14) {
        const u = Ease.easeIn(t / 0.14);
        return { y: -0.5 * u, opacity: 1 - u };
      }
      if (t < 0.28) {
        const u = Ease.easeOut((t - 0.14) / 0.14);
        return { y: 0.5 * (1 - u), opacity: u };
      }
      return {};
    },
  },
  {
    id: 'char-twirl',
    name: 'Twirl',
    kind: 'loop',
    unit: 'char',
    duration: 3,
    stagger: 0.05,
    // One full turn per period; 0° and 360° are the same pose, so report it modulo a turn.
    apply: (p) => ({ rotation: (360 * Ease.easeInOutCubic(clamp01(wrap(p) / 0.3))) % 360 }),
  },

  // ---- Per-letter character -----------------------------------------------------------------
  {
    id: 'char-swing',
    name: 'Swing',
    kind: 'loop',
    unit: 'char',
    duration: 1.6,
    stagger: 0.06,
    apply: (p) => {
      const s = Math.sin(p * TAU);
      return { rotation: 10 * s, x: 0.03 * s };
    },
  },
  {
    id: 'char-wobble',
    name: 'Wobble',
    kind: 'loop',
    unit: 'char',
    duration: 1.2,
    stagger: 0.15,
    apply: (p) => ({ x: 0.04 * Math.sin(p * TAU), rotation: 7 * Math.sin(p * TAU + 1.2) }),
  },
  {
    id: 'shiver',
    name: 'Shiver',
    kind: 'loop',
    unit: 'char',
    duration: 0.4,
    stagger: 0,
    apply: (p, env) => {
      // Eight held positions per period, different for every letter but fixed for all time.
      const frame = env.index * 31 + (Math.floor(wrap(p) * 8) % 8);
      return {
        x: (rand(frame, 1) - 0.5) * 0.05,
        y: (rand(frame, 2) - 0.5) * 0.05,
        rotation: (rand(frame, 3) - 0.5) * 3,
      };
    },
  },
  {
    id: 'char-flicker',
    name: 'Flicker',
    kind: 'loop',
    unit: 'char',
    duration: 2.2,
    stagger: 0.63,
    apply: (p) => {
      // A sign with tired tubes: the large stagger makes letters dip at unrelated moments.
      const t = wrap(p);
      let dip = 0;
      for (let i = 0; i < FLICKER.length; i += 3) {
        const u = (t - FLICKER[i]) / FLICKER[i + 1];
        if (u > -1 && u < 1) {
          const b = 1 - u * u;
          dip = Math.max(dip, FLICKER[i + 2] * b * b);
        }
      }
      return { opacity: 1 - dip };
    },
  },
  {
    id: 'glitch',
    name: 'Glitch',
    kind: 'loop',
    unit: 'char',
    duration: 2,
    stagger: 0,
    apply: (p, env) => {
      // Steady for most of the period, then a short burst of held, hashed offsets.
      const t = wrap(p);
      if (t < 0.42 || t >= 0.58) return {};
      const frame = env.index * 13 + Math.floor(t * 50);
      return {
        x: (rand(frame, 5) - 0.5) * 0.3,
        y: (rand(frame, 6) - 0.5) * 0.06,
        opacity: rand(frame, 7) > 0.25 ? 1 : 0.35,
      };
    },
  },

  // ---- Words --------------------------------------------------------------------------------
  {
    id: 'word-float',
    name: 'Word Float',
    kind: 'loop',
    unit: 'word',
    duration: 2.6,
    stagger: 0.35,
    apply: (p) => ({ y: -0.07 * Math.sin(p * TAU) }),
  },
  {
    id: 'word-bounce',
    name: 'Word Bounce',
    kind: 'loop',
    unit: 'word',
    duration: 1.6,
    stagger: 0.5,
    apply: (p) => {
      const u = wrap(p) / 0.4;
      if (u >= 1) return {};
      const hop = 4 * u * (1 - u);
      return { y: -0.2 * hop, scale: 1 + 0.05 * hop };
    },
  },
  {
    id: 'word-seesaw',
    name: 'Seesaw',
    kind: 'loop',
    unit: 'word',
    duration: 1.8,
    stagger: 0.5,
    apply: (p) => {
      const s = Math.sin(p * TAU);
      return { rotation: 4 * s, y: 0.03 * s };
    },
  },
  {
    id: 'word-shake',
    name: 'Shake',
    kind: 'loop',
    unit: 'word',
    duration: 0.5,
    stagger: 0.23,
    apply: (p) => ({
      x: 0.035 * Math.sin(p * TAU * 3) + 0.015 * Math.sin(p * TAU * 7),
      rotation: 1.2 * Math.sin(p * TAU * 4),
    }),
  },

  // ---- Whole block --------------------------------------------------------------------------
  {
    id: 'block-pulse',
    name: 'Pulse',
    kind: 'loop',
    unit: 'block',
    duration: 1.2,
    stagger: 0,
    apply: (p) => ({ scale: 1 + 0.05 * swell(p) }),
  },
  {
    id: 'block-breathe',
    name: 'Breathe',
    kind: 'loop',
    unit: 'block',
    duration: 3.6,
    stagger: 0,
    apply: (p) => {
      const s = swell(p);
      return { scale: 1 + 0.03 * s, opacity: 1 - 0.12 * s };
    },
  },
  {
    id: 'block-heartbeat',
    name: 'Heartbeat',
    kind: 'loop',
    unit: 'block',
    duration: 1.2,
    stagger: 0,
    apply: (p) => ({ scale: 1 + 0.08 * track(HEARTBEAT, wrap(p)) }),
  },
];

export default textAnimations;
