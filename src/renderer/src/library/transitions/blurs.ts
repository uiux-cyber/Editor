import type { TransitionDef } from '../types';

/** Dither, mirrored sampling and a golden-angle disc kernel shared by the blur transitions. */
const BLUR_LIB = `
vec2 mirrorUv(vec2 u) {
  return 1.0 - abs(1.0 - mod(u, 2.0));
}
float ign() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
// i-th of n points spread evenly over the unit disc (rotated per pixel to trade banding for grain).
vec2 discTap(int i, int n, float rot) {
  float r = sqrt((float(i) + 0.5) / float(n));
  float a = float(i) * 2.39996323 + rot;
  return r * vec2(cos(a), sin(a));
}`;

const transitions: TransitionDef[] = [
  {
    id: 'blur-dissolve',
    name: 'Blur Dissolve',
    category: 'blur',
    duration: 0.8,
    params: [{ key: 'blur', label: 'Blur', type: 'float', default: 0.035, min: 0.005, max: 0.12, step: 0.001 }],
    glsl: `${BLUR_LIB}
vec4 transition(vec2 uv) {
  float k = sin(progress * PI);
  float rad = blur * k;
  float m = smoothstep(0.25, 0.75, progress);
  float rot = ign() * TAU;
  vec4 acc = vec4(0.0);
  const int N = 20;
  for (int i = 0; i < N; i++) {
    vec2 o = discTap(i, N, rot) * rad;
    vec2 q = uv + vec2(o.x / ratio, o.y);
    acc += mix(getFromColor(q), getToColor(q), m);
  }
  return acc / float(N);
}`,
  },
  {
    id: 'defocus',
    name: 'Defocus',
    category: 'blur',
    duration: 0.9,
    params: [
      { key: 'blur', label: 'Blur', type: 'float', default: 0.045, min: 0.005, max: 0.12, step: 0.001 },
      { key: 'highlights', label: 'Bokeh Highlights', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${BLUR_LIB}
vec4 transition(vec2 uv) {
  float k = sin(progress * PI);
  k = k * k * (3.0 - 2.0 * k);
  float rad = blur * k;
  // The lens racks out of focus, the picture changes while it is soft, then focus returns.
  float m = smoothstep(0.42, 0.58, progress);
  vec2 c = 0.5 + (uv - 0.5) / (1.0 + 0.05 * k);
  float rot = ign() * TAU;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  const int N = 20;
  for (int i = 0; i < N; i++) {
    vec2 o = discTap(i, N, rot) * rad;
    vec2 q = c + vec2(o.x / ratio, o.y);
    vec4 s;
    if (m < 0.001) s = getFromColor(q);
    else if (m > 0.999) s = getToColor(q);
    else s = mix(getFromColor(q), getToColor(q), m);
    // Bright samples weigh more, which turns highlights into bokeh discs.
    float l = luma(s.rgb);
    float w = 1.0 + highlights * 8.0 * k * l * l * l * l;
    acc += s * w;
    wsum += w;
  }
  return acc / wsum;
}`,
  },
  {
    id: 'blur-wipe',
    name: 'Blur Wipe',
    category: 'blur',
    duration: 0.9,
    params: [
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
      { key: 'width', label: 'Band Width', type: 'float', default: 0.5, min: 0.1, max: 1.5, step: 0.01 },
      { key: 'blur', label: 'Blur', type: 'float', default: 0.18, min: 0, max: 0.5, step: 0.01 },
    ],
    glsl: `${BLUR_LIB}
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float extent = abs(dir.x) * ratio + abs(dir.y);
  float d = dot(p, dir) / extent + 0.5;
  float s = max(width, 0.05) * 0.5;
  float edge = mix(-s, 1.0 + s, progress);
  float keep = smoothstep(edge - s, edge + s, d);
  // Smear along the wipe direction, strongest in the middle of the travelling band.
  float len = blur * 4.0 * keep * (1.0 - keep);
  vec2 stepv = vec2(dir.x / ratio, dir.y) * len;
  float j = ign();
  vec4 acc = vec4(0.0);
  const int N = 18;
  for (int i = 0; i < N; i++) {
    vec2 q = uv + stepv * ((float(i) + j) / float(N) - 0.5);
    acc += mix(getToColor(q), getFromColor(q), keep);
  }
  return acc / float(N);
}`,
  },
  {
    id: 'directional-blur',
    name: 'Directional Blur',
    category: 'blur',
    duration: 0.7,
    params: [
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
      { key: 'blur', label: 'Blur', type: 'float', default: 0.3, min: 0.02, max: 1, step: 0.01 },
    ],
    glsl: `${BLUR_LIB}
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a) / ratio, sin(a));
  float k = sin(progress * PI);
  float e = progress * progress * (3.0 - 2.0 * progress);
  float m = smoothstep(0.3, 0.7, progress);
  float len = blur * k;
  // Both pictures drift along the blur direction so the streaks read as motion.
  vec2 driftA = dir * blur * 0.5 * e;
  vec2 driftB = -dir * blur * 0.5 * (1.0 - e);
  float j = ign();
  vec4 acc = vec4(0.0);
  const int N = 20;
  for (int i = 0; i < N; i++) {
    vec2 o = dir * len * ((float(i) + j) / float(N) - 0.5);
    acc += mix(getFromColor(mirrorUv(uv + driftA + o)), getToColor(mirrorUv(uv + driftB + o)), m);
  }
  return acc / float(N);
}`,
  },
  {
    id: 'spin-blur',
    name: 'Spin Blur',
    category: 'blur',
    duration: 0.8,
    params: [
      { key: 'spin', label: 'Spin', type: 'float', default: 70, min: -360, max: 360, step: 5, unit: '°' },
      { key: 'blur', label: 'Blur', type: 'float', default: 0.5, min: 0, max: 1.5, step: 0.01 },
    ],
    glsl: `${BLUR_LIB}
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  float k = sin(progress * PI);
  float e = progress * progress * progress * (progress * (6.0 * progress - 15.0) + 10.0);
  // A slight push-in keeps the rotated corners inside the picture.
  vec2 p = (uv - 0.5) * asp / (1.0 + 0.4 * k);
  float turn = radians(spin);
  float af = turn * e;
  float at = -turn * (1.0 - e);
  float spread = blur * k;
  float m = smoothstep(0.3, 0.7, progress);
  float j = ign();
  vec4 acc = vec4(0.0);
  const int N = 18;
  for (int i = 0; i < N; i++) {
    float o = ((float(i) + j) / float(N) - 0.5) * spread;
    vec2 qa = rot2(af + o) * p / asp + 0.5;
    vec2 qb = rot2(at + o) * p / asp + 0.5;
    acc += mix(getFromColor(mirrorUv(qa)), getToColor(mirrorUv(qb)), m);
  }
  return acc / float(N);
}`,
  },
  {
    id: 'double-vision',
    name: 'Double Vision',
    category: 'blur',
    duration: 0.8,
    params: [
      { key: 'separation', label: 'Separation', type: 'float', default: 0.08, min: 0.01, max: 0.4, step: 0.005 },
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
    ],
    glsl: `${BLUR_LIB}
vec4 transition(vec2 uv) {
  float a = radians(angle);
  float k = sin(progress * PI);
  vec2 off = vec2(cos(a) / ratio, sin(a)) * separation * k;
  float m = smoothstep(0.2, 0.8, progress);
  vec2 q1 = mirrorUv(uv + off);
  vec2 q2 = mirrorUv(uv - off);
  // Two ghosts drift apart and re-converge on the incoming picture.
  vec4 g1 = mix(getFromColor(q1), getToColor(q1), m);
  vec4 g2 = mix(getFromColor(q2), getToColor(q2), m);
  return (g1 + g2) * 0.5;
}`,
  },
  {
    id: 'frosted-glass',
    name: 'Frosted Glass',
    category: 'blur',
    duration: 0.9,
    params: [{ key: 'strength', label: 'Strength', type: 'float', default: 0.05, min: 0.005, max: 0.2, step: 0.001 }],
    glsl: `${BLUR_LIB}
vec4 transition(vec2 uv) {
  float k = sin(progress * PI);
  float amt = strength * k;
  float m = smoothstep(0.3, 0.7, progress);
  vec2 p = vec2(uv.x * ratio, uv.y);
  // A slow ripple in the pane plus fine per-pixel scatter from the frosted surface.
  vec2 wave = vec2(vnoise(p * 9.0 + 2.0), vnoise(p * 9.0 + 31.0)) - 0.5;
  vec4 acc = vec4(0.0);
  const int N = 8;
  for (int i = 0; i < N; i++) {
    vec2 r = hash22(gl_FragCoord.xy + float(i) * 19.19) - 0.5;
    vec2 o = (r * 1.4 + wave * 0.8) * amt;
    vec2 q = mirrorUv(uv + vec2(o.x / ratio, o.y));
    acc += mix(getFromColor(q), getToColor(q), m);
  }
  return acc / float(N);
}`,
  },
];

export default transitions;
