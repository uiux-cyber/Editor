import type { TransitionDef } from '../types';

/** Mirrored sampling (hides the frame edge when a picture is scaled below 100 %), dither and easing. */
const ZOOM_LIB = `
vec2 mirrorUv(vec2 u) {
  return 1.0 - abs(1.0 - mod(u, 2.0));
}
float ign() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
float easeIO(float t) {
  return t * t * t * (t * (6.0 * t - 15.0) + 10.0);
}`;

const transitions: TransitionDef[] = [
  {
    id: 'cross-zoom',
    name: 'Cross Zoom',
    category: 'zoom',
    duration: 0.6,
    params: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 0,
        options: [
          { label: 'Zoom In', value: 0 },
          { label: 'Zoom Out', value: 1 },
        ],
      },
      { key: 'zoom', label: 'Zoom', type: 'float', default: 1.5, min: 0.2, max: 4, step: 0.05 },
      { key: 'blur', label: 'Blur', type: 'float', default: 0.35, min: 0, max: 0.8, step: 0.01 },
    ],
    glsl: `${ZOOM_LIB}
vec4 transition(vec2 uv) {
  float e = easeIO(progress);
  // Both pictures share one continuous exponential zoom, so the motion never reverses.
  float L = log(1.0 + zoom) * (direction < 0.5 ? 1.0 : -1.0);
  float sf = exp(L * e);
  float st = exp(-L * (1.0 - e));
  float k = sin(progress * PI);
  float m = smoothstep(0.35, 0.65, progress);
  float amt = blur * k;
  vec2 d = uv - 0.5;
  float j = ign();
  vec4 acc = vec4(0.0);
  const int N = 20;
  for (int i = 0; i < N; i++) {
    float f = 1.0 - amt * (float(i) + j) / float(N);
    if (m < 0.001) acc += getFromColor(mirrorUv(0.5 + d * f / sf));
    else if (m > 0.999) acc += getToColor(mirrorUv(0.5 + d * f / st));
    else acc += mix(getFromColor(mirrorUv(0.5 + d * f / sf)), getToColor(mirrorUv(0.5 + d * f / st)), m);
  }
  return acc / float(N);
}`,
  },
  {
    id: 'punch-zoom',
    name: 'Punch Zoom',
    category: 'zoom',
    duration: 0.45,
    params: [
      { key: 'zoom', label: 'Zoom', type: 'float', default: 0.45, min: 0.05, max: 1.5, step: 0.01 },
      { key: 'blur', label: 'Blur', type: 'float', default: 0.3, min: 0, max: 0.8, step: 0.01 },
      { key: 'flash', label: 'Flash', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${ZOOM_LIB}
vec4 transition(vec2 uv) {
  // First half: the outgoing picture lunges at the viewer. Second half: the incoming one lands.
  float pin = clamp(progress * 2.0, 0.0, 1.0);
  float pout = clamp(progress * 2.0 - 1.0, 0.0, 1.0);
  float zin = pin * pin * pin;
  float zout = pow(1.0 - pout, 4.0);
  float cut = smoothstep(0.47, 0.53, progress);
  float sf = 1.0 + zoom * zin;
  float st = 1.0 + zoom * zout;
  float bf = blur * zin;
  float bt = blur * zout;
  vec2 d = uv - 0.5;
  float j = ign();
  vec4 acc = vec4(0.0);
  const int N = 20;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + j) / float(N);
    if (cut < 0.001) acc += getFromColor(0.5 + d * (1.0 - bf * t) / sf);
    else if (cut > 0.999) acc += getToColor(0.5 + d * (1.0 - bt * t) / st);
    else acc += mix(getFromColor(0.5 + d * (1.0 - bf * t) / sf), getToColor(0.5 + d * (1.0 - bt * t) / st), cut);
  }
  vec4 c = acc / float(N);
  float fl = max(1.0 - abs(progress - 0.5) / 0.16, 0.0);
  fl = fl * fl * flash;
  c.rgb = min(c.rgb * (1.0 + 1.5 * fl) + 0.25 * fl * c.a, vec3(c.a));
  return c;
}`,
  },
  {
    id: 'dolly-zoom',
    name: 'Dolly Zoom',
    category: 'zoom',
    duration: 0.8,
    params: [{ key: 'amount', label: 'Amount', type: 'float', default: 0.7, min: 0.1, max: 1, step: 0.01 }],
    glsl: `${ZOOM_LIB}
vec4 transition(vec2 uv) {
  float e = easeIO(progress);
  vec2 d = uv - 0.5;
  // Smooth "superellipse" radius: 0 at the centre, 1 where it touches the frame edges.
  vec2 n = d * 2.0;
  float t = min(pow(n.x * n.x * n.x * n.x + n.y * n.y * n.y * n.y, 0.25), 1.0);
  float w = (1.0 - t * t) * (1.0 - t * t);
  // The centre rushes forward while the frame edges stay put (the classic vertigo move).
  float a = amount * 1.2 * e * e;
  float b = amount * 0.5 * (1.0 - e) * (1.0 - e);
  vec4 ca = getFromColor(0.5 + d / (1.0 + a * w));
  vec4 cb = getToColor(0.5 + d * (1.0 + b * w));
  vec4 c = mix(ca, cb, smoothstep(0.3, 0.7, progress));
  float k = sin(progress * PI);
  c.rgb *= 1.0 - 0.3 * k * t * t;
  return c;
}`,
  },
  {
    id: 'warp-zoom',
    name: 'Warp Zoom',
    category: 'zoom',
    duration: 0.7,
    params: [
      { key: 'warp', label: 'Warp', type: 'float', default: 1.2, min: 0.1, max: 3, step: 0.05 },
      { key: 'streak', label: 'Streaks', type: 'float', default: 0.4, min: 0, max: 0.9, step: 0.01 },
    ],
    glsl: `${ZOOM_LIB}
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  vec2 d = uv - 0.5;
  vec2 pa = d * asp;
  // 0 at the centre, 1 in the corners.
  float r2 = dot(pa, pa) / (0.25 * dot(asp, asp));
  float e = easeIO(progress);
  float k = max(sin(progress * PI), 0.0);
  // Outgoing: barrel distortion builds up and the centre rushes forward.
  // Incoming: starts pinched and relaxes, so the outward flow never reverses.
  float ca = warp * e * e;
  float cb = min(warp, 2.0) * 0.45 * (1.0 - e) * (1.0 - e);
  float ga = (1.0 + ca * r2) / (1.0 + ca);
  float gb = (1.0 + cb) / (1.0 + cb * r2);
  float m = smoothstep(0.35, 0.65, progress);
  float len = streak * k * (0.25 + 0.75 * r2);
  float j = ign();
  vec4 acc = vec4(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float s = 1.0 - len * (float(i) + j) / float(N);
    acc += mix(getFromColor(0.5 + d * ga * s), getToColor(mirrorUv(0.5 + d * gb * s)), m);
  }
  vec4 c = acc / float(N);
  c.rgb = min(c.rgb * (1.0 + 0.6 * k * (1.0 - r2) * (1.0 - r2)), vec3(c.a));
  return c;
}`,
  },
  {
    id: 'swirl-zoom',
    name: 'Swirl Zoom',
    category: 'zoom',
    duration: 0.8,
    params: [
      { key: 'swirl', label: 'Twist', type: 'float', default: 200, min: 0, max: 720, step: 5, unit: '°' },
      { key: 'zoom', label: 'Zoom', type: 'float', default: 0.8, min: 0, max: 3, step: 0.05 },
    ],
    glsl: `${ZOOM_LIB}
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  vec2 p = (uv - 0.5) * asp;
  float e = easeIO(progress);
  float R = 0.5 * length(asp);
  float fall = 1.0 - clamp(length(p) / R, 0.0, 1.0);
  fall *= fall;
  float tw = radians(swirl);
  float L = log(1.0 + zoom);
  // The outgoing picture winds up while the incoming one unwinds in the same direction.
  vec2 qa = rot2(tw * e * e * fall) * p / exp(L * e);
  vec2 qb = rot2(-tw * (1.0 - e) * (1.0 - e) * fall) * p / exp(-L * (1.0 - e));
  vec4 a = getFromColor(mirrorUv(qa / asp + 0.5));
  vec4 b = getToColor(mirrorUv(qb / asp + 0.5));
  return mix(a, b, smoothstep(0.3, 0.7, progress));
}`,
  },
  {
    id: 'scale-away',
    name: 'Scale Away',
    category: 'zoom',
    duration: 0.7,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 0,
        options: [
          { label: 'Shrink Out', value: 0 },
          { label: 'Grow In', value: 1 },
        ],
      },
      { key: 'spin', label: 'Spin', type: 'float', default: 0, min: -360, max: 360, step: 5, unit: '°' },
      { key: 'shadow', label: 'Shadow', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${ZOOM_LIB}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  vec2 asp = vec2(ratio, 1.0);
  vec2 p = (uv - 0.5) * asp;
  bool grow = mode > 0.5;
  float e = easeIO(progress);
  float sc = max(grow ? e : 1.0 - e, 1e-4);
  float ang = radians(spin) * (grow ? 1.0 - e : e);
  vec2 l = rot2(ang) * p / sc;
  // Signed distance to the scaled picture's border, in frame heights.
  float sd = max(abs(l.x) - 0.5 * ratio, abs(l.y) - 0.5) * sc;
  float cov = clamp(0.5 - sd / px, 0.0, 1.0);
  vec2 q = l / asp + 0.5;
  float op = grow ? smoothstep(0.0, 0.25, progress) : 1.0 - smoothstep(0.75, 1.0, progress);
  vec4 top = grow ? getToColor(q) : getFromColor(q);
  vec4 under = grow ? getFromColor(uv) : getToColor(uv);
  float sh = exp(-max(sd, 0.0) / 0.04) * 0.5 * shadow * op;
  under.rgb *= (1.0 - sh) * (1.0 - 0.35 * shadow * (grow ? e : 1.0 - e));
  return mix(under, top, cov * op);
}`,
  },
];

export default transitions;
