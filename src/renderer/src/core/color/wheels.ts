/**
 * Lift / gamma / gain / offset colour wheels (`Grade.wheels`).
 *
 * Each wheel holds a hue (degrees, HSV convention: 0 = red, 120 = green, 240 = blue), an amount
 * (0..1, how far the puck is pushed towards that hue) and a luma offset (-1..1). The push is a
 * pure chroma vector (zero Rec.709 luma), so a wheel tints without changing brightness; the luma
 * slider changes brightness without tinting.
 *
 * Per channel (x = input, all neutral at the defaults):
 *   lift    x1 = x + L·(1 − x)          moves the blacks, white stays fixed
 *   gain    x2 = x1 · G                 moves the whites, black stays fixed
 *   gamma   x3 = x2^(2^−Γ)              bends the mids, both ends stay fixed
 *   offset  x4 = x3 + O                 shifts everything
 * The wheels are laid out like the vectorscope (blue right, red up-left), so pushing a puck
 * moves the trace on the scope in the same direction.
 */

import type { ColorWheels, WheelValue } from '../types';

export type WheelId = keyof ColorWheels;
export const WHEEL_IDS: WheelId[] = ['lift', 'gamma', 'gain', 'offset'];
export type Vec3 = [number, number, number];

export const neutralWheel = (): WheelValue => ({ hue: 0, amount: 0, luma: 0 });
export const neutralWheels = (): ColorWheels => ({ lift: neutralWheel(), gamma: neutralWheel(), gain: neutralWheel(), offset: neutralWheel() });

// Rec.709 luma coefficients and the YCbCr ↔ RGB factors derived from them.
export const KR = 0.2126;
export const KG = 0.7152;
export const KB = 0.0722;
const CR_R = 2 * (1 - KR); // 1.5748
const CB_B = 2 * (1 - KB); // 1.8556

export const luma709 = (r: number, g: number, b: number): number => KR * r + KG * g + KB * b;

/** Rec.709 chroma of an RGB colour, each in -0.5..0.5. */
export function rgbToCbCr(r: number, g: number, b: number): [number, number] {
  const y = luma709(r, g, b);
  return [(b - y) / CB_B, (r - y) / CR_R];
}

/** RGB offset for a pure chroma vector (its luma is exactly zero). */
export function cbcrToRgbOffset(cb: number, cr: number): Vec3 {
  const r = CR_R * cr;
  const b = CB_B * cb;
  const g = -(KR * r + KB * b) / KG;
  return [r, g, b];
}

function hsvHueToRgb(h: number): Vec3 {
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((hh % 2) - 1);
  if (hh < 1) return [1, x, 0];
  if (hh < 2) return [x, 1, 0];
  if (hh < 3) return [0, 1, x];
  if (hh < 4) return [0, x, 1];
  if (hh < 5) return [x, 0, 1];
  return [1, 0, x];
}

/** Angle (degrees, 0..360, counter-clockwise from +Cb) at which a hue appears on a vectorscope. */
export function hueToScopeAngle(hue: number): number {
  const [r, g, b] = hsvHueToRgb(hue);
  const [cb, cr] = rgbToCbCr(r, g, b);
  const a = (Math.atan2(cr, cb) * 180) / Math.PI;
  return (a + 360) % 360;
}

// The scope angle grows monotonically with the hue; a table inverts it.
const TABLE_STEP = 0.25;
let unwrapped: Float64Array | null = null;
function scopeTable(): Float64Array {
  if (unwrapped) return unwrapped;
  const n = Math.round(360 / TABLE_STEP) + 1;
  const t = new Float64Array(n);
  let prev = hueToScopeAngle(0);
  let offset = 0;
  t[0] = prev;
  for (let i = 1; i < n; i++) {
    const a = hueToScopeAngle(i * TABLE_STEP);
    if (a < prev - 180) offset += 360;
    t[i] = a + offset;
    prev = a;
  }
  unwrapped = t;
  return t;
}

/** Inverse of hueToScopeAngle. */
export function scopeAngleToHue(angle: number): number {
  const t = scopeTable();
  let a = ((angle % 360) + 360) % 360;
  if (a < t[0]) a += 360;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= a) lo = mid;
    else hi = mid;
  }
  const span = t[hi] - t[lo];
  const f = span > 0 ? (a - t[lo]) / span : 0;
  return (((lo + f) * TABLE_STEP) % 360 + 360) % 360;
}

/** Chroma push of a wheel as an RGB offset with zero luma. amount 1 = a fully saturated push. */
export function wheelChroma(hue: number, amount: number): Vec3 {
  const k = Math.min(1, Math.max(0, amount || 0));
  if (k === 0) return [0, 0, 0];
  const a = (hueToScopeAngle(hue || 0) * Math.PI) / 180;
  return cbcrToRgbOffset(0.5 * k * Math.cos(a), 0.5 * k * Math.sin(a));
}

export interface WheelUniforms {
  lift: Vec3;
  /** Exponent applied per channel (1 = neutral). */
  gamma: Vec3;
  gain: Vec3;
  offset: Vec3;
}

const sane = (w: Partial<WheelValue> | undefined): WheelValue => ({
  hue: Number.isFinite(w?.hue) ? (w!.hue as number) : 0,
  amount: Math.min(1, Math.max(0, Number.isFinite(w?.amount) ? (w!.amount as number) : 0)),
  luma: Math.min(1, Math.max(-1, Number.isFinite(w?.luma) ? (w!.luma as number) : 0)),
});

export function sanitizeWheels(w: unknown): ColorWheels {
  const src = (w && typeof w === 'object' ? w : {}) as Partial<Record<WheelId, Partial<WheelValue>>>;
  return { lift: sane(src.lift), gamma: sane(src.gamma), gain: sane(src.gain), offset: sane(src.offset) };
}

export function isNeutralWheel(w: Partial<WheelValue> | undefined): boolean {
  const s = sane(w);
  return s.amount < 1e-5 && Math.abs(s.luma) < 1e-5;
}

export function isNeutralWheels(w: ColorWheels | undefined | null): boolean {
  if (!w) return true;
  return WHEEL_IDS.every((id) => isNeutralWheel(w[id]));
}

/** Strength of each wheel's luma (L) and chroma (C) controls. */
export const WHEEL_RANGE = {
  lift: { luma: 0.4, chroma: 0.6 },
  gamma: { luma: 1.0, chroma: 1.0 },
  gain: { luma: 1.0, chroma: 1.0 },
  offset: { luma: 0.25, chroma: 0.25 },
} as const;

/** Convert the wheels into the per-channel parameters used by the shader. */
export function wheelUniforms(wheels: ColorWheels | undefined | null): WheelUniforms {
  const w = sanitizeWheels(wheels);
  const chan = (id: WheelId): Vec3 => {
    const c = wheelChroma(w[id].hue, w[id].amount);
    const R = WHEEL_RANGE[id];
    return [w[id].luma * R.luma + c[0] * R.chroma, w[id].luma * R.luma + c[1] * R.chroma, w[id].luma * R.luma + c[2] * R.chroma];
  };
  const lift = chan('lift');
  const g = chan('gamma');
  const k = chan('gain');
  const offset = chan('offset');
  return {
    lift,
    gamma: [Math.pow(2, -g[0]), Math.pow(2, -g[1]), Math.pow(2, -g[2])],
    gain: [Math.pow(2, k[0]), Math.pow(2, k[1]), Math.pow(2, k[2])],
    offset,
  };
}

/** CPU mirror of the shader (engine/gl/ext/wheels.ts) for tests and previews. */
export function applyWheels(rgb: Vec3, u: WheelUniforms): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let x = rgb[c];
    x = x + u.lift[c] * (1 - x);
    x = x * u.gain[c];
    x = x > 0 ? Math.pow(x, u.gamma[c]) : x;
    x = x + u.offset[c];
    out[c] = Math.min(1, Math.max(0, x));
  }
  return out;
}

/** GLSL implementation; keep in sync with applyWheels. */
export const WHEELS_GLSL = `
vec3 ext_wheels_apply(vec3 x, vec3 lift, vec3 gain, vec3 gammaExp, vec3 offset) {
  x = x + lift * (1.0 - x);
  x = x * gain;
  vec3 p = pow(max(x, vec3(0.0)), gammaExp);
  x = mix(x, p, vec3(greaterThan(x, vec3(0.0))));
  x = x + offset;
  return clamp(x, 0.0, 1.0);
}
`;
