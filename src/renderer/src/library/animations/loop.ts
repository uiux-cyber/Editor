import { Ease, clamp01, lerp, smoothstep } from '@/core/easing';
import type { AnimationDef } from '../types';

/**
 * Looping animations. `p` is the phase 0 → 1 of one period; every `apply(0)` equals `apply(1)`,
 * so the loops repeat without a visible seam. Amplitudes are deliberately small: a loop plays
 * for the whole clip and should add life, not distract.
 */

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

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

/** Deterministic 0..1 pseudo-random value for an integer step and a salt. */
const rand = (step: number, salt: number): number => {
  let h = Math.imul((step | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

// ---- Keyframe data --------------------------------------------------------------------------

/** "Lub-dub": a strong beat, a softer echo, then a rest. */
const HEARTBEAT = [0, 0, 0.07, 1, 0.16, 0.12, 0.25, 0.7, 0.42, 0, 1, 0];
/** Tada: shrink to wind up (-1), swell (+1), hold while shaking, settle. */
const TADA = [0, 0, 0.12, -1, 0.3, 1, 0.74, 1, 1, 0];
/** Neon flicker dips as [centre, half-width, depth] triples. */
const FLICKER = [0.08, 0.016, 0.55, 0.115, 0.012, 0.9, 0.34, 0.02, 0.4, 0.615, 0.012, 0.85, 0.655, 0.022, 0.5, 0.9, 0.016, 0.35];

const animations: AnimationDef[] = [
  // ---- Scale --------------------------------------------------------------------------------
  {
    id: 'breathe',
    name: 'Breathe',
    kind: 'loop',
    duration: 4,
    apply: (p) => ({ scale: 1 + 0.035 * swell(p) }),
  },
  {
    id: 'slow-zoom',
    name: 'Slow Zoom',
    kind: 'loop',
    duration: 6,
    apply: (p) => ({ scale: 1 + 0.08 * swell(p) }),
  },
  {
    id: 'heartbeat',
    name: 'Heartbeat',
    kind: 'loop',
    duration: 1.2,
    apply: (p) => ({ scale: 1 + 0.09 * track(HEARTBEAT, wrap(p)) }),
  },
  {
    id: 'beat',
    name: 'Beat',
    kind: 'loop',
    duration: 0.5,
    apply: (p) => {
      // A kick on the downbeat: fast attack, long release.
      const t = wrap(p);
      const v = t < 0.12 ? Ease.easeOut(t / 0.12) : 1 - Ease.easeOutCubic((t - 0.12) / 0.88);
      return { scale: 1 + 0.07 * v };
    },
  },
  {
    id: 'squish',
    name: 'Squish',
    kind: 'loop',
    duration: 1.4,
    apply: (p) => {
      const s = 0.05 * Math.sin(p * TAU);
      return { scaleX: 1 + s, scaleY: 1 - s };
    },
  },
  {
    id: 'jello',
    name: 'Jello',
    kind: 'loop',
    duration: 1.4,
    apply: (p) => {
      // A flick that rings out and comes to rest before the next one.
      const t = wrap(p);
      const k = 1 - t;
      const s = 0.1 * Math.sin(t * TAU * 3) * k * k;
      return { scaleX: 1 + s, scaleY: 1 - s };
    },
  },
  {
    id: 'tada',
    name: 'Tada',
    kind: 'loop',
    duration: 1.4,
    apply: (p) => {
      const t = wrap(p);
      const v = track(TADA, t);
      const shake = smoothstep(0.2, 0.32, t) * (1 - smoothstep(0.7, 0.84, t));
      return { scale: 1 + (v < 0 ? 0.07 : 0.1) * v, rotation: 3.5 * Math.sin(t * TAU * 5) * shake };
    },
  },

  // ---- Position -----------------------------------------------------------------------------
  {
    id: 'bob',
    name: 'Bob',
    kind: 'loop',
    duration: 2,
    // Like a buoy: the tilt leads the rise by a quarter of a cycle.
    apply: (p) => ({ y: 10 * Math.sin(p * TAU), rotation: 1.5 * Math.cos(p * TAU) }),
  },
  {
    id: 'hover',
    name: 'Hover',
    kind: 'loop',
    duration: 5,
    // A lazy figure of eight.
    apply: (p) => ({ x: 10 * Math.sin(p * TAU), y: -8 * Math.sin(p * TAU * 2) }),
  },
  {
    id: 'drift',
    name: 'Drift',
    kind: 'loop',
    duration: 6,
    apply: (p) => ({ x: 30 * Math.sin(p * TAU), y: -14 * Math.sin(p * TAU) }),
  },
  {
    id: 'sway',
    name: 'Sway',
    kind: 'loop',
    duration: 3,
    apply: (p) => {
      const s = Math.sin(p * TAU);
      return { x: 22 * s, rotation: 2.5 * s };
    },
  },
  {
    id: 'orbit',
    name: 'Orbit',
    kind: 'loop',
    duration: 3,
    apply: (p) => ({ x: 14 * Math.cos(p * TAU), y: 14 * Math.sin(p * TAU) }),
  },
  {
    id: 'bounce',
    name: 'Bounce',
    kind: 'loop',
    duration: 0.9,
    apply: (p, env) => {
      const t = wrap(p);
      // Parabolic hop with a brief squash where it meets the ground.
      const g = Math.min(t, 1 - t) / 0.07;
      const impact = Math.exp(-g * g);
      const sy = 1 - 0.07 * impact;
      return { y: -34 * 4 * t * (1 - t) + (1 - sy) * env.h * 0.5, scaleX: 1 + 0.05 * impact, scaleY: sy };
    },
  },

  // ---- Rotation -----------------------------------------------------------------------------
  {
    id: 'rock',
    name: 'Rock',
    kind: 'loop',
    duration: 2,
    apply: (p) => ({ rotation: 6 * Math.sin(p * TAU) }),
  },
  {
    id: 'swing',
    name: 'Swing',
    kind: 'loop',
    duration: 2.4,
    apply: (p, env) => {
      // A pendulum hanging from the middle of the layer's top edge.
      const deg = 9 * Math.sin(p * TAU);
      const a = deg * RAD;
      return { rotation: deg, x: -env.h * 0.5 * Math.sin(a), y: env.h * 0.5 * (Math.cos(a) - 1) };
    },
  },
  {
    id: 'wobble',
    name: 'Wobble',
    kind: 'loop',
    duration: 1.2,
    apply: (p) => {
      const s = Math.sin(p * TAU);
      return { x: 18 * s, rotation: -4 * s };
    },
  },
  {
    id: 'wiggle',
    name: 'Wiggle',
    kind: 'loop',
    duration: 1,
    apply: (p) => ({ rotation: 3.5 * Math.sin(p * TAU * 2), x: 5 * Math.sin(p * TAU * 3) }),
  },
  {
    id: 'tick-tock',
    name: 'Tick Tock',
    kind: 'loop',
    duration: 1.6,
    apply: (p) => {
      // Snaps from side to side and holds, like a metronome.
      const t = wrap(p);
      const v = t < 0.5 ? lerp(-1, 1, Ease.easeOutBack(clamp01(t / 0.18))) : lerp(1, -1, Ease.easeOutBack(clamp01((t - 0.5) / 0.18)));
      return { rotation: 8 * v };
    },
  },
  {
    id: 'spin-reverse',
    name: 'Spin Reverse',
    kind: 'loop',
    duration: 4,
    // 0° and -360° are the same pose, so report the rotation modulo a full turn.
    apply: (p) => ({ rotation: -(p % 1) * 360 }),
  },
  {
    id: 'coin-flip',
    name: 'Coin Flip',
    kind: 'loop',
    duration: 2,
    apply: (p) => ({ scaleX: Math.abs(Math.cos(p * TAU)) }),
  },

  // ---- Shake --------------------------------------------------------------------------------
  {
    id: 'shake',
    name: 'Shake',
    kind: 'loop',
    duration: 0.6,
    apply: (p) => ({
      x: 7 * Math.sin(p * TAU * 4) + 3 * Math.sin(p * TAU * 7),
      y: 2.5 * Math.sin(p * TAU * 5),
      rotation: 0.6 * Math.sin(p * TAU * 6),
    }),
  },
  {
    id: 'tremble',
    name: 'Tremble',
    kind: 'loop',
    duration: 0.5,
    apply: (p) => {
      // Ten held positions per period from a fixed hash: nervous, but identical on every render.
      const step = Math.floor(wrap(p) * 10) % 10;
      return {
        x: (rand(step, 1) - 0.5) * 6,
        y: (rand(step, 2) - 0.5) * 6,
        rotation: (rand(step, 3) - 0.5) * 1.2,
      };
    },
  },

  // ---- Opacity ------------------------------------------------------------------------------
  {
    id: 'fade-pulse',
    name: 'Fade Pulse',
    kind: 'loop',
    duration: 2.4,
    apply: (p) => ({ opacity: 1 - 0.45 * swell(p) }),
  },
  {
    id: 'flash',
    name: 'Flash',
    kind: 'loop',
    duration: 1,
    apply: (p) => ({ opacity: 1 - 0.75 * swell(p) }),
  },
  {
    id: 'blink',
    name: 'Blink',
    kind: 'loop',
    duration: 1.2,
    apply: (p) => {
      const t = wrap(p);
      return { opacity: 1 - smoothstep(0.46, 0.5, t) + smoothstep(0.92, 0.96, t) };
    },
  },
  {
    id: 'flicker',
    name: 'Flicker',
    kind: 'loop',
    duration: 2.4,
    apply: (p) => {
      // A neon tube with a loose contact: mostly steady, with a few irregular dips.
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
];

export default animations;
