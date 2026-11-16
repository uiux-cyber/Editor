import { Ease, clamp01, lerp } from '@/core/easing';
import type { AnimEnv, AnimMod, AnimationDef } from '../types';

/**
 * Entrance animations. `p` runs 0 → 1 and every `apply(1)` is exactly neutral.
 *
 * Direction words name the direction of travel: "Slide Left" moves leftwards, so the layer comes
 * in from the right (the same convention as the core "Slide Up" / "Wipe Right").
 */

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

/** Opacity ramp that completes within the first `portion` of the move, so nothing pops in. */
const fade = (p: number, portion = 0.5): number => Ease.easeOut(clamp01(p / portion));

/** Distance that carries a layer fully outside the frame, with a little slack. */
const offX = (env: AnimEnv): number => (env.cw + env.w) / 2 + 80;
const offY = (env: AnimEnv): number => (env.ch + env.h) / 2 + 80;

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

/** ≈ 15 % overshoot followed by a 2 % settle: lively but controlled. */
const springBouncy = makeSpring(7.5, 2);
/** A pendulum coming to rest: 36 %, 13 %, 5 % … */
const springSwing = makeSpring(4.5, 2.2);

/**
 * Height of a dropped object: 1 at t = 0, first contact at t ≈ 0.5, then two small rebounds
 * (restitution 0.36, so the hops obey the same gravity as the fall).
 */
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

interface Dir {
  key: 'left' | 'right' | 'up' | 'down';
  label: string;
  /** Unit vector of the direction of travel (y grows downwards). */
  dx: number;
  dy: number;
}

const LEFT: Dir = { key: 'left', label: 'Left', dx: -1, dy: 0 };
const RIGHT: Dir = { key: 'right', label: 'Right', dx: 1, dy: 0 };
const UP: Dir = { key: 'up', label: 'Up', dx: 0, dy: -1 };
const DOWN: Dir = { key: 'down', label: 'Down', dx: 0, dy: 1 };
const DIRS: Dir[] = [LEFT, RIGHT, UP, DOWN];

/** Places the layer `dist` px behind its rest position, i.e. against the direction of travel. */
const behind = (d: Dir, dist: number, mod: AnimMod): AnimMod => {
  if (d.dx !== 0) mod.x = -d.dx * dist;
  else mod.y = -d.dy * dist;
  return mod;
};

// ---- Directional families ------------------------------------------------------------------

/** A short, quiet move with a fade: the default "tasteful" entrance. */
const softSlide = (d: Dir): AnimationDef => ({
  id: `soft-slide-${d.key}-in`,
  name: `Soft Slide ${d.label}`,
  kind: 'in',
  duration: 0.5,
  apply: (p) => behind(d, 96 * (1 - Ease.easeOutCubic(p)), { opacity: fade(p, 0.6) }),
});

/** Medium move relative to the layer size; completes the core "Slide Up". */
const slide = (d: Dir): AnimationDef => ({
  id: `slide-${d.key}-in`,
  name: `Slide ${d.label}`,
  kind: 'in',
  duration: 0.6,
  apply: (p, env) =>
    behind(d, ((d.dx !== 0 ? env.w : env.h) * 0.35 + 60) * (1 - Ease.easeOutCubic(p)), { opacity: Ease.easeOut(Math.min(1, p * 2)) }),
});

/** Starts outside the frame and decelerates into place. */
const fly = (d: Dir): AnimationDef => ({
  id: `fly-${d.key}-in`,
  name: `Fly ${d.label}`,
  kind: 'in',
  duration: 0.7,
  // The brief fade is invisible when the layer starts off-screen and hides the pop when an
  // off-centre layer does not quite clear the frame.
  apply: (p, env) => behind(d, (d.dx !== 0 ? offX(env) : offY(env)) * (1 - Ease.easeOutQuart(p)), { opacity: fade(p, 0.12) }),
});

/** Long, silky move that spends most of its time settling. */
const glide = (d: Dir): AnimationDef => ({
  id: `glide-${d.key}-in`,
  name: `Glide ${d.label}`,
  kind: 'in',
  duration: 0.9,
  apply: (p) => behind(d, 260 * (1 - Ease.easeOutExpo(p)), { opacity: fade(p, 0.7), blur: 12 * (1 - Ease.easeOutCubic(p)) }),
});

/** Short move that overshoots its mark and settles back. */
const spring = (d: Dir): AnimationDef => ({
  id: `spring-${d.key}-in`,
  name: `Spring ${d.label}`,
  kind: 'in',
  duration: 0.6,
  apply: (p, env) => behind(d, ((d.dx !== 0 ? env.w : env.h) * 0.3 + 120) * (1 - Ease.easeOutBack(p)), { opacity: fade(p, 0.4) }),
});

/** Sideways move on a spring: one clear overshoot and a small wobble. */
const elasticSlide = (d: Dir): AnimationDef => ({
  id: `elastic-${d.key}-in`,
  name: `Elastic ${d.label}`,
  kind: 'in',
  duration: 0.9,
  apply: (p) => behind(d, 300 * (1 - springBouncy(p)), { opacity: fade(p, 0.3) }),
});

/**
 * The layer slides out from behind a fixed edge: the reveal inset on the trailing side always
 * equals the offset, so the edge it emerges from stays put.
 */
const mask = (d: Dir): AnimationDef => ({
  id: `mask-${d.key}-in`,
  name: `Mask ${d.label}`,
  kind: 'in',
  duration: 0.7,
  apply: (p, env) => {
    const k = 1 - Ease.easeOutQuart(p);
    if (d.key === 'left') return { x: env.w * k, clipR: k };
    if (d.key === 'right') return { x: -env.w * k, clipL: k };
    if (d.key === 'up') return { y: env.h * k, clipB: k };
    return { y: -env.h * k, clipT: k };
  },
});

/** Whip pan: a very fast move across half the frame, smeared with blur. */
const whip = (d: Dir): AnimationDef => ({
  id: `whip-${d.key}-in`,
  name: `Whip ${d.label}`,
  kind: 'in',
  duration: 0.45,
  apply: (p, env) =>
    behind(d, (d.dx !== 0 ? env.cw : env.ch) * 0.55 * (1 - Ease.easeOutExpo(p)), {
      blur: 64 * (1 - Ease.easeOutCubic(p)),
      opacity: fade(p, 0.25),
    }),
});

// ---- Keyframe data --------------------------------------------------------------------------

/** Squash Drop deformation: +1 = stretched (falling), -1 = squashed (impact). */
const SQUASH_DROP = [0, 0, 0.4, 1, 0.47, -1, 0.6, 0.35, 0.8, -0.22, 1, 0];

const animations: AnimationDef[] = [
  // ---- Slides -------------------------------------------------------------------------------
  ...DIRS.map(softSlide),
  slide(LEFT),
  slide(RIGHT),
  slide(DOWN),
  ...DIRS.map(fly),
  glide(LEFT),
  glide(RIGHT),
  {
    id: 'rise-in',
    name: 'Rise',
    kind: 'in',
    duration: 0.8,
    apply: (p, env) => {
      const e = Ease.easeOutExpo(p);
      return { y: lerp(env.h * 0.5 + 80, 0, e), scale: lerp(0.94, 1, e), opacity: fade(p, 0.45) };
    },
  },

  // ---- Overshoot and bounce ---------------------------------------------------------------
  spring(UP),
  spring(DOWN),
  elasticSlide(LEFT),
  elasticSlide(RIGHT),
  {
    id: 'elastic-in',
    name: 'Elastic',
    kind: 'in',
    duration: 0.9,
    apply: (p) => ({ scale: lerp(0.4, 1, springBouncy(p)), opacity: fade(p, 0.3) }),
  },
  {
    id: 'drop-in',
    name: 'Drop',
    kind: 'in',
    duration: 0.9,
    apply: (p, env) => ({ y: -offY(env) * dropHeight(p), opacity: fade(p, 0.1) }),
  },
  {
    id: 'bounce-in',
    name: 'Bounce',
    kind: 'in',
    duration: 0.8,
    apply: (p, env) => ({ y: -(env.h * 0.4 + 100) * dropHeight(p), opacity: fade(p, 0.2) }),
  },
  {
    id: 'squash-drop-in',
    name: 'Squash Drop',
    kind: 'in',
    duration: 0.9,
    apply: (p, env) => {
      const dist = offY(env);
      let y = 0;
      if (p < 0.4) {
        const u = p / 0.4;
        y = -dist * (1 - u * u);
      } else if (p > 0.52 && p < 0.8) {
        const u = (p - 0.52) / 0.28;
        y = -Math.min(60, dist * 0.07) * 4 * u * (1 - u);
      }
      const d = track(SQUASH_DROP, p);
      const sy = d >= 0 ? 1 + 0.14 * d : 1 + 0.24 * d;
      const sx = d >= 0 ? 1 - 0.08 * d : 1 - 0.16 * d;
      // Keep the bottom edge planted while the layer is squashed.
      return { y: y + (1 - sy) * env.h * 0.5, scaleX: sx, scaleY: sy, opacity: fade(p, 0.08) };
    },
  },

  // ---- Zoom and focus -----------------------------------------------------------------------
  {
    id: 'scale-down-in',
    name: 'Scale Down',
    kind: 'in',
    duration: 0.6,
    apply: (p) => ({ scale: lerp(1.35, 1, Ease.easeOutCubic(p)), opacity: fade(p, 0.5) }),
  },
  {
    id: 'zoom-soft-in',
    name: 'Soft Zoom',
    kind: 'in',
    duration: 0.5,
    apply: (p) => ({ scale: lerp(0.9, 1, Ease.easeOutCubic(p)), opacity: fade(p, 0.7) }),
  },
  {
    id: 'zoom-blur-in',
    name: 'Zoom Blur',
    kind: 'in',
    duration: 0.6,
    apply: (p) => {
      const e = Ease.easeOutExpo(p);
      return { scale: lerp(1.7, 1, e), blur: lerp(48, 0, e), opacity: fade(p, 0.35) };
    },
  },
  {
    id: 'focus-in',
    name: 'Focus',
    kind: 'in',
    duration: 0.8,
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { blur: lerp(36, 0, e), scale: lerp(1.12, 1, e), opacity: fade(p, 0.5) };
    },
  },

  // ---- Pops ---------------------------------------------------------------------------------
  {
    id: 'pop-soft-in',
    name: 'Soft Pop',
    kind: 'in',
    duration: 0.45,
    apply: (p) => ({ scale: lerp(0.82, 1, Ease.easeOutBack(p)), opacity: fade(p, 0.4) }),
  },
  {
    id: 'pop-up-in',
    name: 'Pop Up',
    kind: 'in',
    duration: 0.55,
    apply: (p) => ({ y: lerp(90, 0, Ease.easeOutCubic(p)), scale: lerp(0.5, 1, Ease.easeOutBack(p)), opacity: fade(p, 0.35) }),
  },
  {
    id: 'twist-pop-in',
    name: 'Twist Pop',
    kind: 'in',
    duration: 0.55,
    apply: (p) => {
      const e = Ease.easeOutBack(p);
      return { scale: lerp(0, 1, e), rotation: lerp(-30, 0, e), opacity: fade(p, 0.25) };
    },
  },
  {
    id: 'stomp-in',
    name: 'Stomp',
    kind: 'in',
    duration: 0.5,
    apply: (p) => {
      // Slams in from in front of the lens, dips slightly past its size and recovers.
      if (p < 0.5) {
        const u = Ease.easeInCubic(p / 0.5);
        return { scale: lerp(2.4, 0.92, u), blur: lerp(14, 0, u), opacity: Ease.easeOut(clamp01(p / 0.25)) };
      }
      return { scale: lerp(0.92, 1, Ease.easeOutCubic((p - 0.5) / 0.5)) };
    },
  },

  // ---- Stretch ------------------------------------------------------------------------------
  {
    id: 'rubber-in',
    name: 'Rubber Band',
    kind: 'in',
    duration: 0.8,
    apply: (p) => {
      const s = springBouncy(p);
      return { scaleX: lerp(1.45, 1, s), scaleY: lerp(0.55, 1, s), opacity: fade(p, 0.25) };
    },
  },
  {
    id: 'stretch-h-in',
    name: 'Stretch Wide',
    kind: 'in',
    duration: 0.6,
    apply: (p) => ({ scaleX: Ease.easeOutExpo(p), opacity: fade(p, 0.15) }),
  },
  {
    id: 'stretch-v-in',
    name: 'Stretch Tall',
    kind: 'in',
    duration: 0.6,
    apply: (p) => ({ scaleY: Ease.easeOutExpo(p), opacity: fade(p, 0.15) }),
  },

  // ---- Rotation -----------------------------------------------------------------------------
  {
    id: 'spin-in',
    name: 'Spin',
    kind: 'in',
    duration: 0.8,
    apply: (p) => {
      const e = Ease.easeOutQuart(p);
      return { rotation: lerp(-270, 0, e), scale: lerp(0.2, 1, e), opacity: fade(p, 0.35) };
    },
  },
  {
    id: 'rotate-in',
    name: 'Rotate',
    kind: 'in',
    duration: 0.6,
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { rotation: lerp(-30, 0, e), scale: lerp(0.85, 1, e), opacity: fade(p, 0.5) };
    },
  },
  {
    id: 'tilt-in',
    name: 'Tilt',
    kind: 'in',
    duration: 0.6,
    apply: (p) => {
      const e = Ease.easeOutCubic(p);
      return { rotation: lerp(-10, 0, e), y: lerp(70, 0, e), opacity: fade(p, 0.5) };
    },
  },
  {
    id: 'roll-in',
    name: 'Roll',
    kind: 'in',
    duration: 0.8,
    apply: (p, env) => {
      const e = Ease.easeOutCubic(p);
      return { x: lerp(-(env.w * 0.6 + 240), 0, e), rotation: lerp(-140, 0, e), opacity: fade(p, 0.4) };
    },
  },
  {
    id: 'swing-in',
    name: 'Swing',
    kind: 'in',
    duration: 1,
    apply: (p, env) => {
      // A sign hanging from the middle of its top edge, released at an angle.
      const deg = -42 * (1 - springSwing(p));
      const a = deg * RAD;
      return { rotation: deg, x: -env.h * 0.5 * Math.sin(a), y: env.h * 0.5 * (Math.cos(a) - 1), opacity: fade(p, 0.2) };
    },
  },

  // ---- Flips (the turn is faked with one axis collapsing through zero) ---------------------
  {
    id: 'flip-h-in',
    name: 'Flip Horizontal',
    kind: 'in',
    duration: 0.7,
    apply: (p) => ({ scaleX: Math.abs(Math.cos(90 * (1 - springBouncy(p)) * RAD)), opacity: fade(p, 0.25) }),
  },
  {
    id: 'flip-v-in',
    name: 'Flip Vertical',
    kind: 'in',
    duration: 0.7,
    apply: (p) => ({ scaleY: Math.abs(Math.cos(90 * (1 - springBouncy(p)) * RAD)), opacity: fade(p, 0.25) }),
  },
  {
    id: 'card-spin-in',
    name: 'Card Spin',
    kind: 'in',
    duration: 0.9,
    // One and a quarter turns: the card goes edge-on twice before facing the viewer.
    apply: (p) => ({ scaleX: Math.abs(Math.cos(450 * (1 - Ease.easeOutCubic(p)) * RAD)), opacity: fade(p, 0.3) }),
  },

  // ---- Wipes (reveal only, the layer does not move) -----------------------------------------
  { id: 'wipe-left-in', name: 'Wipe Left', kind: 'in', duration: 0.6, apply: (p) => ({ clipL: 1 - Ease.easeInOutCubic(p) }) },
  { id: 'wipe-up-in', name: 'Wipe Up', kind: 'in', duration: 0.6, apply: (p) => ({ clipT: 1 - Ease.easeInOutCubic(p) }) },
  { id: 'wipe-down-in', name: 'Wipe Down', kind: 'in', duration: 0.6, apply: (p) => ({ clipB: 1 - Ease.easeInOutCubic(p) }) },
  {
    id: 'wipe-center-in',
    name: 'Center Wipe',
    kind: 'in',
    duration: 0.6,
    apply: (p) => {
      const k = 0.5 * (1 - Ease.easeInOutCubic(p));
      return { clipL: k, clipR: k };
    },
  },
  {
    id: 'unfold-in',
    name: 'Unfold',
    kind: 'in',
    duration: 0.6,
    apply: (p) => {
      const k = 0.5 * (1 - Ease.easeInOutCubic(p));
      return { clipT: k, clipB: k };
    },
  },
  {
    id: 'box-open-in',
    name: 'Box Open',
    kind: 'in',
    duration: 0.7,
    apply: (p) => {
      const k = 0.5 * (1 - Ease.easeInOutCubic(p));
      return { clipL: k, clipR: k, clipT: k, clipB: k };
    },
  },

  // ---- Masked slides and whip pans --------------------------------------------------------
  ...DIRS.map(mask),
  ...DIRS.map(whip),
];

export default animations;
