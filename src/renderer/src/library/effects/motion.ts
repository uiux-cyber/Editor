import type { EffectDef, ParamDef } from '../types';

const EDGES: ParamDef = {
  key: 'edges',
  label: 'Edges',
  type: 'select',
  default: 0,
  options: [
    { label: 'Mirror', value: 0 },
    { label: 'Stretch', value: 1 },
    { label: 'Transparent', value: 2 },
  ],
};

/**
 * Shared by the effects that move the whole picture:
 *  - texE: sampling with the edge treatment chosen by the `edges` param
 *  - wob:  smooth random motion in -1..1
 *  - moved: where to sample after shifting by offPx (real px), turning by ang and zooming
 */
const MOVE = `
vec4 texE(vec2 p) { return edges < 0.5 ? texM(p) : (edges < 1.5 ? tex(p) : texZ(p)); }
float wob(float t, float seed) { return vnoise(vec2(t, seed)) * 2.0 - 1.0; }
vec2 moved(vec2 uv, vec2 offPx, float ang, float zoomBy) {
  vec2 p = (uv - 0.5) * u_res;
  p = rot2(ang) * p / zoomBy + offPx;
  return p / u_res + 0.5;
}`;

const effects: EffectDef[] = [
  {
    id: 'camera-shake',
    name: 'Camera Shake',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 14, min: 0, max: 150, step: 0.5, unit: 'px' },
      { key: 'rotation', label: 'Rotation', type: 'float', default: 0.6, min: 0, max: 10, step: 0.05, unit: '°' },
      { key: 'speed', label: 'Speed', type: 'float', default: 6, min: 0.1, max: 30, step: 0.1 },
      EDGES,
    ],
    glsl: `${MOVE}
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float t = u_time * speed;
  // Two octaves of smooth noise per axis: a wander with a quicker tremble on top.
  vec2 o = vec2(wob(t, 1.3) + 0.5 * wob(t * 2.3, 7.1), wob(t, 4.7) + 0.5 * wob(t * 2.3, 9.9)) / 1.5 * amount * u_px;
  // The roll eases in with the amount, so 0 is a clean identity.
  float a = radians(rotation) * wob(t * 0.9, 12.5) * clamp(amount / 4.0, 0.0, 1.0);
  return texE(moved(uv, o, a, 1.0));
}`,
  },
  {
    id: 'earthquake',
    name: 'Earthquake',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 32, min: 0, max: 200, step: 1, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 14, min: 1, max: 40, step: 0.5 },
      { key: 'blur', label: 'Motion blur', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'rotation', label: 'Roll', type: 'float', default: 0.8, min: 0, max: 10, step: 0.05, unit: '°' },
      EDGES,
    ],
    glsl: `${MOVE}
// Violent, mostly vertical shaking.
vec2 quake(float t) {
  return vec2(0.35 * wob(t * 1.3, 2.0) + 0.2 * wob(t * 3.7, 5.0), wob(t, 8.0) + 0.5 * wob(t * 2.9, 11.0));
}
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float t = u_time * speed;
  vec2 now = quake(t) * amount * u_px;
  vec2 before = quake(t - 0.35 * blur) * amount * u_px;
  float a = radians(rotation) * wob(t * 0.8, 21.0) * clamp(amount / 8.0, 0.0, 1.0);
  // Smear from where the frame was a moment ago to where it is now; red leads and blue
  // trails a little, as on a sensor shaken mid-exposure.
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  float asum = 0.0;
  for (int i = 0; i < 8; i++) {
    float f = float(i) / 7.0;
    vec3 w = vec3(1.0 - 0.7 * f, 1.0, 0.3 + 0.7 * f);
    vec4 s = texE(moved(uv, mix(now, before, f), a, 1.0));
    acc += s.rgb * w;
    wsum += w;
    asum += s.a;
  }
  vec3 rgb = acc / wsum;
  return vec4(rgb, max(asum / 8.0, max(rgb.r, max(rgb.g, rgb.b))));
}`,
  },
  {
    id: 'wiggle',
    name: 'Wiggle',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 10, min: 0, max: 150, step: 0.5, unit: 'px' },
      { key: 'rotation', label: 'Rotation', type: 'float', default: 2, min: 0, max: 30, step: 0.1, unit: '°' },
      { key: 'speed', label: 'Speed', type: 'float', default: 1.5, min: 0.1, max: 10, step: 0.05, unit: 'Hz' },
      { key: 'stepRate', label: 'Step rate (0 = smooth)', type: 'int', default: 0, min: 0, max: 24, step: 1, unit: 'fps' },
      EDGES,
    ],
    glsl: `${MOVE}
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  // A step rate holds each pose for a moment, like animation shot on twos or threes.
  float t = stepRate > 0.5 ? floor(u_time * stepRate) / stepRate : u_time;
  vec2 o = vec2(sin(TAU * fract(t * speed)), cos(TAU * fract(t * speed * 0.83) + 1.0)) * amount * u_px;
  float a = radians(rotation) * sin(TAU * fract(t * speed * 0.71) + 2.0) * clamp(amount / 4.0, 0.0, 1.0);
  return texE(moved(uv, o, a, 1.0));
}`,
  },
  {
    id: 'jitter',
    name: 'Jitter',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 12, min: 0, max: 150, step: 0.5, unit: 'px' },
      { key: 'rate', label: 'Rate', type: 'float', default: 12, min: 1, max: 60, step: 1, unit: 'Hz' },
      { key: 'chance', label: 'Chance', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'zoomJitter', label: 'Zoom jitter', type: 'float', default: 0.04, min: 0, max: 0.3, step: 0.005 },
      EDGES,
    ],
    glsl: `${MOVE}
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  // Hard jumps on a clock: on each tick the frame either stays put or snaps somewhere new.
  float tick = mod(floor(u_time * rate), 2048.0);
  float on = step(1.0 - chance, hash11(tick + 80.0));
  vec2 r = hash22(vec2(tick, tick * 0.37 + 5.0)) * 2.0 - 1.0;
  float z = 1.0 + (hash11(tick + 19.0) - 0.3) * zoomJitter * on;
  return texE(moved(uv, r * amount * u_px * on, 0.0, z));
}`,
  },
  {
    id: 'rgb-shake',
    name: 'RGB Shake',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 12, min: 0, max: 120, step: 0.5, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 8, min: 0.1, max: 30, step: 0.1 },
    ],
    glsl: `
float wob(float t, float seed) { return vnoise(vec2(t, seed)) * 2.0 - 1.0; }
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float t = u_time * speed;
  vec2 k = amount * u_px / u_res;
  // Each colour channel shakes on its own path; green moves least so the picture stays readable.
  vec4 r = texM(uv + vec2(wob(t, 1.0), wob(t, 2.0)) * k);
  vec4 g = texM(uv + vec2(wob(t, 3.0), wob(t, 4.0)) * k * 0.3);
  vec4 b = texM(uv + vec2(wob(t, 5.0), wob(t, 6.0)) * k);
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,
  },
  {
    id: 'zoom-pulse',
    name: 'Zoom Pulse',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.12, min: 0, max: 1, step: 0.005 },
      { key: 'tempo', label: 'Tempo', type: 'float', default: 120, min: 30, max: 240, step: 1, unit: 'BPM' },
      { key: 'snap', label: 'Snap', type: 'float', default: 5, min: 0.5, max: 14, step: 0.1 },
      {
        key: 'pattern',
        label: 'Pattern',
        type: 'select',
        default: 0,
        options: [
          { label: 'Every beat', value: 0 },
          { label: 'Every other beat', value: 1 },
          { label: 'Double hit', value: 2 },
        ],
      },
      { key: 'blur', label: 'Zoom blur', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'offset', label: 'Beat offset', type: 'float', default: 0, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
// 1 on the hit, decaying until the next one.
float beatEnv(float beat) {
  if (pattern < 0.5) return exp(-fract(beat) * snap);
  float ph = fract(beat * 0.5) * 2.0;
  if (pattern < 1.5) return exp(-ph * snap);
  return max(exp(-ph * snap), ph > 0.5 ? 0.7 * exp(-(ph - 0.5) * snap) : 0.0);
}
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float env = beatEnv(u_time * tempo / 60.0 - offset);
  float z = 1.0 + amount * env;
  vec2 d = uv - 0.5;
  if (blur <= 0.0 || env < 0.01) return tex(0.5 + d / z);
  // A short radial smear on the hit sells the punch.
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    acc += tex(0.5 + d / (z + amount * env * blur * 0.6 * float(i) / 7.0));
  }
  return acc / 8.0;
}`,
  },
  {
    id: 'breathing-zoom',
    name: 'Breathing Zoom',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.08, min: 0, max: 0.6, step: 0.005 },
      { key: 'period', label: 'Period', type: 'float', default: 4, min: 0.5, max: 30, step: 0.1, unit: 's' },
      { key: 'rotation', label: 'Sway', type: 'float', default: 0, min: 0, max: 15, step: 0.1, unit: '°' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float ph = fract(u_time / max(period, 0.1)) * TAU;
  float a = radians(rotation) * sin(ph);
  // Slow in, slow out; a swaying frame zooms in a touch more so its corners stay covered.
  float cover = cos(abs(a)) + sin(abs(a)) * max(u_aspect, 1.0 / u_aspect);
  float z = (1.0 + amount * (0.5 - 0.5 * cos(ph))) * cover;
  vec2 p = rot2(a) * ((uv - 0.5) * u_res) / z;
  return tex(p / u_res + 0.5);
}`,
  },
  {
    id: 'slow-zoom',
    name: 'Slow Zoom',
    category: 'motion',
    animated: true,
    params: [
      { key: 'zoomStart', label: 'Start zoom', type: 'float', default: 1, min: 0.5, max: 4, step: 0.01 },
      { key: 'zoomEnd', label: 'End zoom', type: 'float', default: 1.25, min: 0.5, max: 4, step: 0.01 },
      { key: 'focusX', label: 'Focus X', type: 'float', default: 50, min: 0, max: 100, step: 0.5, unit: '%' },
      { key: 'focusY', label: 'Focus Y', type: 'float', default: 50, min: 0, max: 100, step: 0.5, unit: '%' },
      {
        key: 'easing',
        label: 'Easing',
        type: 'select',
        default: 0,
        options: [
          { label: 'Linear', value: 0 },
          { label: 'Ease in and out', value: 1 },
        ],
      },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  // Runs once over the length of the clip, whatever its duration.
  float k = easing > 0.5 ? u_progress * u_progress * (3.0 - 2.0 * u_progress) : u_progress;
  float z = max(mix(zoomStart, zoomEnd, k), 0.01);
  // Zooming about the focus point keeps the frame covered for any zoom of 1 or more.
  vec2 f = vec2(focusX, focusY) * 0.01;
  vec2 q = f + (uv - f) / z;
  return z >= 1.0 ? tex(q) : texM(q);
}`,
  },
  {
    id: 'rotate',
    name: 'Rotate',
    category: 'motion',
    animated: true,
    params: [
      { key: 'speed', label: 'Speed', type: 'float', default: 8, min: -360, max: 360, step: 0.5, unit: '°/s' },
      { key: 'startAngle', label: 'Start angle', type: 'float', default: 0, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'zoom', label: 'Zoom', type: 'float', default: 1, min: 0.25, max: 4, step: 0.01 },
      { key: 'fill', label: 'Zoom to fill frame', type: 'bool', default: true },
      EDGES,
    ],
    glsl: `${MOVE}
vec4 effect(vec2 uv) {
  float a = radians(startAngle + mod(u_time * speed, 360.0));
  float z = zoom;
  if (fill > 0.5) {
    // Scale up just enough for the turned picture to keep covering the frame.
    float cs = abs(cos(a));
    float sn = abs(sin(a));
    z *= max(cs + sn / u_aspect, cs + sn * u_aspect);
  }
  return texE(moved(uv, vec2(0.0), a, z));
}`,
  },
  {
    id: 'scroll',
    name: 'Scroll',
    category: 'motion',
    animated: true,
    params: [
      { key: 'speedX', label: 'Horizontal speed', type: 'float', default: 20, min: -200, max: 200, step: 1, unit: '%/s' },
      { key: 'speedY', label: 'Vertical speed', type: 'float', default: 0, min: -200, max: 200, step: 1, unit: '%/s' },
      { key: 'mirrored', label: 'Mirror alternate copies', type: 'bool', default: false },
    ],
    glsl: `
// Repeating lookup whose seam is filtered like the rest of the picture: within half a texel of
// the wrap, the last and first texels are blended instead of snapping from one to the other.
vec4 texWrap(vec2 q) {
  vec2 f = fract(q);
  vec2 h = 0.5 / u_res;
  vec2 d = (fract(f + 0.5) - 0.5) / (2.0 * h);
  vec2 w = clamp(d + 0.5, 0.0, 1.0);
  bvec2 seam = lessThan(abs(d), vec2(0.5));
  vec2 a = vec2(seam.x ? 1.0 - h.x : f.x, seam.y ? 1.0 - h.y : f.y);
  vec2 b = vec2(seam.x ? h.x : f.x, seam.y ? h.y : f.y);
  return mix(mix(tex(a), tex(vec2(b.x, a.y)), w.x), mix(tex(vec2(a.x, b.y)), tex(b), w.x), w.y);
}
vec4 effect(vec2 uv) {
  vec2 q = uv - vec2(speedX, speedY) * 0.01 * u_time;
  return mirrored > 0.5 ? texM(q) : texWrap(q);
}`,
  },
  {
    id: 'echo',
    name: 'Echo',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Spread', type: 'float', default: 0.25, min: 0, max: 1, step: 0.01 },
      { key: 'copies', label: 'Copies', type: 'int', default: 4, min: 1, max: 8, step: 1 },
      { key: 'fade', label: 'Fade', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'pulse', label: 'Pulse rate (0 = still)', type: 'float', default: 0.5, min: 0, max: 8, step: 0.05, unit: 'Hz' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 base = tex(uv);
  if (amount <= 0.0) return base;
  float k = pulse > 0.0 ? 0.5 - 0.5 * cos(TAU * fract(u_time * pulse)) : 1.0;
  float n = clamp(floor(copies + 0.5), 1.0, 8.0);
  vec2 d = uv - 0.5;
  // Ever larger, ever fainter ghosts of the picture are screened over it.
  vec4 res = base;
  for (int i = 1; i <= 8; i++) {
    float fi = float(i);
    if (fi > n) break;
    vec4 g = texZ(0.5 + d / (1.0 + amount * k * fi / n)) * pow(1.0 - fade * 0.8, fi) * 0.8;
    res.rgb += g.rgb * (1.0 - res.rgb);
    res.a += g.a * (1.0 - res.a);
  }
  return res;
}`,
  },
  {
    id: 'boil',
    name: 'Boil',
    category: 'motion',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 4, min: 0, max: 40, step: 0.5, unit: 'px' },
      { key: 'scale', label: 'Scale', type: 'float', default: 30, min: 4, max: 300, step: 1, unit: 'px' },
      { key: 'rate', label: 'Rate', type: 'float', default: 8, min: 1, max: 30, step: 1, unit: 'fps' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float amt = amount * u_px;
  if (amt < 0.01) return tex(uv);
  // A new wobble pattern a few times a second, like drawings redrawn for every frame.
  float tick = mod(floor(u_time * rate), 64.0);
  vec2 p = uv * u_res / (u_px * max(scale, 2.0)) + tick * vec2(17.13, 31.71);
  vec2 o = vec2(vnoise(p), vnoise(p + 57.3)) * 2.0 - 1.0;
  return texM(uv + o * amt / u_res);
}`,
  },
];

export default effects;
