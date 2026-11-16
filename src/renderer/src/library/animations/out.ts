import { Ease, clamp01, lerp } from '@/core/easing';
import type { AnimEnv, AnimMod, AnimationDef } from '../types';

/**
 * Exit animations. `p` runs 0 → 1 and every `apply(0)` is exactly neutral.
 *
 * Direction words name the direction of travel: "Slide Left" leaves towards the left. Exits
 * accelerate (ease-in) and, where an entrance overshoots, wind up with a little anticipation.
 */

const RAD = Math.PI / 180;

/** Opacity ramp that only starts in the last `portion` of the move. */
const fadeOut = (p: number, portion = 0.5): number => 1 - Ease.easeIn(clamp01((p - (1 - portion)) / portion));

/** Distance that carries a layer fully outside the frame, with a little slack. */
const offX = (env: AnimEnv): number => (env.cw + env.w) / 2 + 80;
const offY = (env: AnimEnv): number => (env.ch + env.h) / 2 + 80;

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

/** Moves the layer `dist` px along the direction of travel. */
const ahead = (d: Dir, dist: number, mod: AnimMod): AnimMod => {
  if (d.dx !== 0) mod.x = d.dx * dist;
  else mod.y = d.dy * dist;
  return mod;
};

// ---- Directional families ------------------------------------------------------------------

const softSlide = (d: Dir): AnimationDef => ({
  id: `soft-slide-${d.key}-out`,
  name: `Soft Slide ${d.label}`,
  kind: 'out',
  duration: 0.5,
  apply: (p) => ahead(d, 96 * Ease.easeInCubic(p), { opacity: fadeOut(p, 0.6) }),
});

/** Medium move relative to the layer size; completes the core "Slide Down". */
const slide = (d: Dir): AnimationDef => ({
  id: `slide-${d.key}-out`,
  name: `Slide ${d.label}`,
  kind: 'out',
  duration: 0.6,
  apply: (p, env) =>
    ahead(d, ((d.dx !== 0 ? env.w : env.h) * 0.35 + 60) * Ease.easeInCubic(p), { opacity: 1 - Ease.easeIn(Math.max(0, p * 2 - 1)) }),
});

/** Accelerates away until the layer has left the frame. */
const fly = (d: Dir): AnimationDef => ({
  id: `fly-${d.key}-out`,
  name: `Fly ${d.label}`,
  kind: 'out',
  duration: 0.7,
  apply: (p, env) => ahead(d, (d.dx !== 0 ? offX(env) : offY(env)) * Ease.easeInQuart(p), { opacity: fadeOut(p, 0.12) }),
});

/** Long, silky departure. */
const glide = (d: Dir): AnimationDef => ({
  id: `glide-${d.key}-out`,
  name: `Glide ${d.label}`,
  kind: 'out',
  duration: 0.9,
  apply: (p) => ahead(d, 260 * Ease.easeInExpo(p), { opacity: fadeOut(p, 0.7), blur: 12 * Ease.easeInCubic(p) }),
});

/** Pulls back a touch before leaving. */
const spring = (d: Dir): AnimationDef => ({
  id: `spring-${d.key}-out`,
  name: `Spring ${d.label}`,
  kind: 'out',
  duration: 0.6,
  apply: (p, env) => ahead(d, ((d.dx !== 0 ? env.w : env.h) * 0.3 + 120) * Ease.easeInBack(p), { opacity: fadeOut(p, 0.4) }),
});

const elasticSlide = (d: Dir): AnimationDef => ({
  id: `elastic-${d.key}-out`,
  name: `Elastic ${d.label}`,
  kind: 'out',
  duration: 0.7,
  apply: (p) => ahead(d, 300 * Ease.easeInBack(p), { opacity: fadeOut(p, 0.3) }),
});

/**
 * The layer slides away behind a fixed edge: the inset on the leading side always equals the
 * offset, so the edge it disappears into stays put.
 */
const mask = (d: Dir): AnimationDef => ({
  id: `mask-${d.key}-out`,
  name: `Mask ${d.label}`,
  kind: 'out',
  duration: 0.7,
  apply: (p, env) => {
    const k = Ease.easeInQuart(p);
    if (d.key === 'left') return { x: -env.w * k, clipL: k };
    if (d.key === 'right') return { x: env.w * k, clipR: k };
    if (d.key === 'up') return { y: -env.h * k, clipT: k };
    return { y: env.h * k, clipB: k };
  },
});

/** Whip pan: a very fast move across half the frame, smeared with blur. */
const whip = (d: Dir): AnimationDef => ({
  id: `whip-${d.key}-out`,
  name: `Whip ${d.label}`,
  kind: 'out',
  duration: 0.45,
  apply: (p, env) =>
    ahead(d, (d.dx !== 0 ? env.cw : env.ch) * 0.55 * Ease.easeInExpo(p), {
      blur: 64 * Ease.easeInCubic(p),
      opacity: fadeOut(p, 0.25),
    }),
});

// ---- Keyframe data --------------------------------------------------------------------------

/** Squash Jump deformation: -1 = crouched, +1 = stretched at take-off. */
const SQUASH_JUMP = [0, 0, 0.3, -1, 0.44, 1, 1, 0.5];

const animations: AnimationDef[] = [
  // ---- Slides -------------------------------------------------------------------------------
  ...DIRS.map(softSlide),
  slide(LEFT),
  slide(RIGHT),
  slide(UP),
  ...DIRS.map(fly),
  glide(LEFT),
  glide(RIGHT),
  {
    id: 'sink-out',
    name: 'Sink',
    kind: 'out',
    duration: 0.7,
    apply: (p, env) => {
      const e = Ease.easeInCubic(p);
      return { y: lerp(0, env.h * 0.5 + 80, e), scale: lerp(1, 0.94, e), opacity: fadeOut(p, 0.45) };
    },
  },

  // ---- Anticipation and bounce ------------------------------------------------------------
  spring(UP),
  spring(DOWN),
  elasticSlide(LEFT),
  elasticSlide(RIGHT),
  {
    id: 'elastic-out',
    name: 'Elastic',
    kind: 'out',
    duration: 0.7,
    apply: (p) => ({ scale: lerp(1, 0.4, Ease.easeInBack(p)), opacity: fadeOut(p, 0.3) }),
  },
  {
    id: 'drop-out',
    name: 'Drop',
    kind: 'out',
    duration: 0.7,
    // A small hop (the back-ease dips negative) and then gravity takes over.
    apply: (p, env) => ({ y: offY(env) * Ease.easeInBack(p), opacity: fadeOut(p, 0.1) }),
  },
  {
    id: 'bounce-out',
    name: 'Bounce',
    kind: 'out',
    duration: 0.8,
    apply: (p, env) => {
      if (p < 0.4) {
        const u = p / 0.4;
        return { y: -56 * 4 * u * (1 - u) };
      }
      return { y: (env.h * 0.4 + 100) * Ease.easeInCubic((p - 0.4) / 0.6), opacity: fadeOut(p, 0.35) };
    },
  },
  {
    id: 'squash-jump-out',
    name: 'Squash Jump',
    kind: 'out',
    duration: 0.8,
    apply: (p, env) => {
      const d = track(SQUASH_JUMP, p);
      const sy = d >= 0 ? 1 + 0.14 * d : 1 + 0.24 * d;
      const sx = d >= 0 ? 1 - 0.08 * d : 1 - 0.16 * d;
      const lift = p > 0.36 ? offY(env) * Ease.easeInCubic((p - 0.36) / 0.64) : 0;
      // Keep the bottom edge planted while the layer crouches.
      return { y: (1 - sy) * env.h * 0.5 - lift, scaleX: sx, scaleY: sy, opacity: fadeOut(p, 0.1) };
    },
  },

  // ---- Zoom and focus -----------------------------------------------------------------------
  {
    id: 'scale-up-out',
    name: 'Scale Up',
    kind: 'out',
    duration: 0.6,
    apply: (p) => ({ scale: lerp(1, 1.35, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.5) }),
  },
  {
    id: 'zoom-soft-out',
    name: 'Soft Zoom',
    kind: 'out',
    duration: 0.5,
    apply: (p) => ({ scale: lerp(1, 0.9, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.7) }),
  },
  {
    id: 'zoom-blur-out',
    name: 'Zoom Blur',
    kind: 'out',
    duration: 0.6,
    apply: (p) => {
      const e = Ease.easeInExpo(p);
      return { scale: lerp(1, 1.7, e), blur: lerp(0, 48, e), opacity: fadeOut(p, 0.35) };
    },
  },
  {
    id: 'defocus-out',
    name: 'Defocus',
    kind: 'out',
    duration: 0.8,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { blur: lerp(0, 36, e), scale: lerp(1, 1.12, e), opacity: fadeOut(p, 0.5) };
    },
  },
  {
    id: 'blur-out',
    name: 'Blur Out',
    kind: 'out',
    duration: 0.7,
    apply: (p) => ({ blur: lerp(0, 60, Ease.easeInCubic(p)), opacity: fadeOut(p, 0.625) }),
  },

  // ---- Pops ---------------------------------------------------------------------------------
  {
    id: 'pop-soft-out',
    name: 'Soft Pop',
    kind: 'out',
    duration: 0.4,
    apply: (p) => ({ scale: lerp(1, 0.82, Ease.easeInBack(p)), opacity: fadeOut(p, 0.4) }),
  },
  {
    id: 'pop-down-out',
    name: 'Pop Down',
    kind: 'out',
    duration: 0.5,
    apply: (p) => ({ y: lerp(0, 90, Ease.easeInCubic(p)), scale: lerp(1, 0.5, Ease.easeInBack(p)), opacity: fadeOut(p, 0.35) }),
  },
  {
    id: 'twist-pop-out',
    name: 'Twist Pop',
    kind: 'out',
    duration: 0.5,
    apply: (p) => {
      const e = Ease.easeInBack(p);
      return { scale: lerp(1, 0, e), rotation: lerp(0, 30, e), opacity: fadeOut(p, 0.25) };
    },
  },
  {
    id: 'stomp-out',
    name: 'Stomp',
    kind: 'out',
    duration: 0.5,
    apply: (p) => {
      // Sinks back for a beat, then punches out past the lens.
      if (p < 0.3) return { scale: lerp(1, 0.92, Ease.easeOut(p / 0.3)) };
      const u = Ease.easeInCubic((p - 0.3) / 0.7);
      return { scale: lerp(0.92, 2.4, u), blur: lerp(0, 14, u), opacity: 1 - Ease.easeIn(clamp01((p - 0.6) / 0.4)) };
    },
  },

  // ---- Stretch ------------------------------------------------------------------------------
  {
    id: 'rubber-out',
    name: 'Rubber Band',
    kind: 'out',
    duration: 0.6,
    apply: (p) => {
      const e = Ease.easeInBack(p);
      return { scaleX: lerp(1, 1.45, e), scaleY: lerp(1, 0.55, e), opacity: fadeOut(p, 0.25) };
    },
  },
  {
    id: 'collapse-h-out',
    name: 'Collapse Wide',
    kind: 'out',
    duration: 0.6,
    apply: (p) => ({ scaleX: 1 - Ease.easeInExpo(p), opacity: fadeOut(p, 0.15) }),
  },
  {
    id: 'collapse-v-out',
    name: 'Collapse Tall',
    kind: 'out',
    duration: 0.6,
    apply: (p) => ({ scaleY: 1 - Ease.easeInExpo(p), opacity: fadeOut(p, 0.15) }),
  },

  // ---- Rotation -----------------------------------------------------------------------------
  {
    id: 'spin-out',
    name: 'Spin',
    kind: 'out',
    duration: 0.8,
    apply: (p) => {
      const e = Ease.easeInQuart(p);
      return { rotation: lerp(0, 270, e), scale: lerp(1, 0.2, e), opacity: fadeOut(p, 0.35) };
    },
  },
  {
    id: 'rotate-out',
    name: 'Rotate',
    kind: 'out',
    duration: 0.6,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { rotation: lerp(0, 30, e), scale: lerp(1, 0.85, e), opacity: fadeOut(p, 0.5) };
    },
  },
  {
    id: 'tilt-out',
    name: 'Tilt',
    kind: 'out',
    duration: 0.6,
    apply: (p) => {
      const e = Ease.easeInCubic(p);
      return { rotation: lerp(0, 10, e), y: lerp(0, 70, e), opacity: fadeOut(p, 0.5) };
    },
  },
  {
    id: 'roll-out',
    name: 'Roll',
    kind: 'out',
    duration: 0.8,
    apply: (p, env) => {
      const e = Ease.easeInCubic(p);
      return { x: lerp(0, env.w * 0.6 + 240, e), rotation: lerp(0, 140, e), opacity: fadeOut(p, 0.4) };
    },
  },
  {
    id: 'swing-out',
    name: 'Swing',
    kind: 'out',
    duration: 0.8,
    apply: (p, env) => {
      // A sign hanging from the middle of its top edge: leans back, then swings up and away.
      const deg = 65 * Ease.easeInBack(p);
      const a = deg * RAD;
      return { rotation: deg, x: -env.h * 0.5 * Math.sin(a), y: env.h * 0.5 * (Math.cos(a) - 1), opacity: fadeOut(p, 0.35) };
    },
  },

  // ---- Flips (the turn is faked with one axis collapsing through zero) ---------------------
  {
    id: 'flip-h-out',
    name: 'Flip Horizontal',
    kind: 'out',
    duration: 0.6,
    apply: (p) => ({ scaleX: Math.abs(Math.cos(90 * Ease.easeInCubic(p) * RAD)), opacity: fadeOut(p, 0.25) }),
  },
  {
    id: 'flip-v-out',
    name: 'Flip Vertical',
    kind: 'out',
    duration: 0.6,
    apply: (p) => ({ scaleY: Math.abs(Math.cos(90 * Ease.easeInCubic(p) * RAD)), opacity: fadeOut(p, 0.25) }),
  },
  {
    id: 'card-spin-out',
    name: 'Card Spin',
    kind: 'out',
    duration: 0.9,
    // One and a quarter turns, ending edge-on.
    apply: (p) => ({ scaleX: Math.abs(Math.cos(450 * Ease.easeInCubic(p) * RAD)), opacity: fadeOut(p, 0.3) }),
  },

  // ---- Wipes (conceal only, the layer does not move) ----------------------------------------
  { id: 'wipe-left-out', name: 'Wipe Left', kind: 'out', duration: 0.6, apply: (p) => ({ clipR: Ease.easeInOutCubic(p) }) },
  { id: 'wipe-right-out', name: 'Wipe Right', kind: 'out', duration: 0.6, apply: (p) => ({ clipL: Ease.easeInOutCubic(p) }) },
  { id: 'wipe-up-out', name: 'Wipe Up', kind: 'out', duration: 0.6, apply: (p) => ({ clipB: Ease.easeInOutCubic(p) }) },
  { id: 'wipe-down-out', name: 'Wipe Down', kind: 'out', duration: 0.6, apply: (p) => ({ clipT: Ease.easeInOutCubic(p) }) },
  {
    id: 'wipe-center-out',
    name: 'Center Wipe',
    kind: 'out',
    duration: 0.6,
    apply: (p) => {
      const k = 0.5 * Ease.easeInOutCubic(p);
      return { clipL: k, clipR: k };
    },
  },
  {
    id: 'fold-out',
    name: 'Fold',
    kind: 'out',
    duration: 0.6,
    apply: (p) => {
      const k = 0.5 * Ease.easeInOutCubic(p);
      return { clipT: k, clipB: k };
    },
  },
  {
    id: 'box-close-out',
    name: 'Box Close',
    kind: 'out',
    duration: 0.7,
    apply: (p) => {
      const k = 0.5 * Ease.easeInOutCubic(p);
      return { clipL: k, clipR: k, clipT: k, clipB: k };
    },
  },

  // ---- Masked slides and whip pans --------------------------------------------------------
  ...DIRS.map(mask),
  ...DIRS.map(whip),
];

export default animations;
