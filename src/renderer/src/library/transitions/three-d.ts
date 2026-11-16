import type { ParamDef, TransitionDef } from '../types';

const background: ParamDef = { key: 'background', label: 'Background', type: 'color', default: '#000000' };

/**
 * A tiny perspective renderer. The frame is the z = 0 plane (x in ±ratio/2, y in ±0.5, +z away
 * from the viewer) and the eye sits CAM frame-heights in front of it, so a quad lying exactly on
 * the frame projects onto the whole picture — which is what makes the end points exact.
 */
const SCENE_LIB = `
const float CAM = 2.4;
float easeIO(float t) {
  return t * t * (3.0 - 2.0 * t);
}
// Ray / rectangle intersection. The rectangle is o + a*u + b*v with u perpendicular to v.
// Returns (a, b, t); t < 0 means the ray misses the plane.
vec3 hitQuad(vec3 ro, vec3 rd, vec3 o, vec3 u, vec3 v) {
  vec3 n = cross(u, v);
  float den = dot(rd, n);
  if (abs(den) < 1e-6) return vec3(-1.0);
  float t = dot(o - ro, n) / den;
  vec3 h = ro + rd * t - o;
  return vec3(dot(h, u) / dot(u, u), dot(h, v) / dot(v, v), t);
}
// Anti-aliased coverage of the rectangle for a hit, from the screen-space derivatives of (a, b).
float quadCov(vec3 hit) {
  vec2 fw = max(fwidth(hit.xy), vec2(1e-6));
  vec2 lo = clamp(hit.xy / fw + 0.5, 0.0, 1.0);
  vec2 hi = clamp((1.0 - hit.xy) / fw + 0.5, 0.0, 1.0);
  return lo.x * lo.y * hi.x * hi.y * step(0.0, hit.z);
}`;

const direction = (def = 0): ParamDef => ({
  key: 'direction',
  label: 'Direction',
  type: 'select',
  default: def,
  options: [
    { label: 'Left', value: 0 },
    { label: 'Right', value: 1 },
    { label: 'Up', value: 2 },
    { label: 'Down', value: 3 },
  ],
});

const transitions: TransitionDef[] = [
  {
    id: 'cube',
    name: 'Cube',
    category: '3d',
    duration: 0.9,
    params: [direction(), { key: 'depth', label: 'Pull Back', type: 'float', default: 0.45, min: 0, max: 1.5, step: 0.01 }, background],
    glsl: `${SCENE_LIB}
vec4 transition(vec2 uv) {
  // Work in a frame where the cube always turns to the left; other directions mirror / swap axes.
  bool vert = direction > 1.5;
  bool flip = direction > 0.5 && direction < 2.5;
  vec2 pc = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  vec2 pr = vert ? pc.yx : pc;
  if (flip) pr.x = -pr.x;
  float S = vert ? 1.0 : ratio;
  float H = vert ? ratio : 1.0;
  float th = easeIO(progress) * PI * 0.5;
  float c = cos(th);
  float s = sin(th);
  vec3 ro = vec3(0.0, 0.0, -CAM);
  vec3 rd = vec3(pr, CAM);
  // The cube turns about its own centre and is pulled back mid-turn so its near edge stays in frame.
  vec3 ctr = vec3(0.0, 0.0, 0.5 * S + sin(2.0 * th) * depth * S);
  vec3 vv = vec3(0.0, H, 0.0);
  vec3 uF = vec3(S * c, 0.0, -S * s);
  vec3 oF = ctr + vec3(-0.5 * S * (c + s), -0.5 * H, 0.5 * S * (s - c));
  vec3 uT = vec3(S * s, 0.0, S * c);
  vec3 oT = ctr + vec3(0.5 * S * (c - s), -0.5 * H, -0.5 * S * (s + c));
  vec3 hF = hitQuad(ro, rd, oF, uF, vv);
  vec3 hT = hitQuad(ro, rd, oT, uT, vv);
  // Only faces that point at the eye are drawn.
  float covF = quadCov(hF) * step(dot(rd, vec3(-s, 0.0, -c)), 0.0);
  float covT = quadCov(hT) * step(dot(rd, vec3(c, 0.0, -s)), 0.0);
  vec2 ta = hF.xy;
  vec2 tb = hT.xy;
  if (flip) { ta.x = 1.0 - ta.x; tb.x = 1.0 - tb.x; }
  if (vert) { ta = ta.yx; tb = tb.yx; }
  vec4 a = getFromColor(ta);
  vec4 b = getToColor(tb);
  a.rgb *= 0.35 + 0.65 * c;
  b.rgb *= 0.35 + 0.65 * s;
  float rest = max(1.0 - covF - covT, 0.0);
  return a * covF + b * covT + vec4(background, 1.0) * rest;
}`,
  },
  {
    id: 'flip',
    name: 'Flip',
    category: '3d',
    duration: 0.8,
    params: [
      {
        key: 'axis',
        label: 'Flip',
        type: 'select',
        default: 0,
        options: [
          { label: 'Horizontal', value: 0 },
          { label: 'Vertical', value: 1 },
        ],
      },
      { key: 'depth', label: 'Pull Back', type: 'float', default: 1, min: 0, max: 2, step: 0.01 },
      background,
    ],
    glsl: `${SCENE_LIB}
vec4 transition(vec2 uv) {
  bool vert = axis > 0.5;
  vec2 pc = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  vec2 pr = vert ? pc.yx : pc;
  float S = vert ? 1.0 : ratio;
  float H = vert ? ratio : 1.0;
  float th = easeIO(progress) * PI;
  float c = cos(th);
  float s = sin(th);
  vec3 ro = vec3(0.0, 0.0, -CAM);
  vec3 rd = vec3(pr, CAM);
  // A card turning about its centre line: the outgoing picture on the front, the incoming on the back.
  vec3 u = vec3(S * c, 0.0, S * s);
  vec3 vv = vec3(0.0, H, 0.0);
  vec3 o = vec3(0.0, 0.0, 0.5 * S * s * depth) - 0.5 * u - 0.5 * vv;
  vec3 h = hitQuad(ro, rd, o, u, vv);
  float cov = quadCov(h);
  bool back = th > PI * 0.5;
  vec2 t = h.xy;
  if (back) t.x = 1.0 - t.x;
  if (vert) t = t.yx;
  vec4 col;
  if (back) col = getToColor(t);
  else col = getFromColor(t);
  col.rgb *= 0.3 + 0.7 * abs(c);
  return mix(vec4(background, 1.0), col, cov);
}`,
  },
  {
    id: 'doors',
    name: 'Doors',
    category: '3d',
    duration: 0.9,
    params: [
      {
        key: 'orientation',
        label: 'Doors',
        type: 'select',
        default: 0,
        options: [
          { label: 'Left / Right', value: 0 },
          { label: 'Top / Bottom', value: 1 },
        ],
      },
      { key: 'depth', label: 'Depth', type: 'float', default: 0.6, min: 0, max: 2, step: 0.01 },
      background,
    ],
    glsl: `${SCENE_LIB}
vec4 transition(vec2 uv) {
  bool vert = orientation > 0.5;
  vec2 pc = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  vec2 pr = vert ? pc.yx : pc;
  float S = vert ? 1.0 : ratio;
  float H = vert ? ratio : 1.0;
  float e = easeIO(progress);
  // Each leaf is hinged on its outer edge and swings towards the viewer until it is edge-on to the eye.
  float th = e * atan(CAM, 0.5 * S);
  float c = cos(th);
  float s = sin(th);
  vec3 ro = vec3(0.0, 0.0, -CAM);
  vec3 rd = vec3(pr, CAM);
  vec3 vv = vec3(0.0, H, 0.0);
  vec3 hL = hitQuad(ro, rd, vec3(-0.5 * S, -0.5 * H, 0.0), 0.5 * S * vec3(c, 0.0, -s), vv);
  vec3 hR = hitQuad(ro, rd, vec3(0.5 * S, -0.5 * H, 0.0), 0.5 * S * vec3(-c, 0.0, -s), vv);
  // The incoming picture waits behind the doorway and moves up to the frame.
  vec3 hB = hitQuad(ro, rd, vec3(-0.5 * S, -0.5 * H, (1.0 - e) * depth), vec3(S, 0.0, 0.0), vv);
  float covL = quadCov(hL);
  float covR = quadCov(hR);
  float covB = quadCov(hB);
  vec2 tl = vec2(0.5 * hL.x, hL.y);
  vec2 tr = vec2(1.0 - 0.5 * hR.x, hR.y);
  vec2 tb = hB.xy;
  if (vert) { tl = tl.yx; tr = tr.yx; tb = tb.yx; }
  vec4 room = getToColor(tb);
  room.rgb *= 0.5 + 0.5 * e;
  room = mix(vec4(background, 1.0), room, covB);
  float shade = 1.0 - 0.45 * e;
  vec4 dl = getFromColor(tl);
  vec4 dr = getFromColor(tr);
  dl.rgb *= shade;
  dr.rgb *= shade;
  float rest = max(1.0 - covL - covR, 0.0);
  return dl * covL + dr * covR + room * rest;
}`,
  },
  {
    id: 'swing',
    name: 'Swing',
    category: '3d',
    duration: 0.8,
    params: [
      {
        key: 'hinge',
        label: 'Hinge',
        type: 'select',
        default: 0,
        options: [
          { label: 'Left', value: 0 },
          { label: 'Right', value: 1 },
          { label: 'Top', value: 2 },
          { label: 'Bottom', value: 3 },
        ],
      },
      {
        key: 'swing',
        label: 'Swing',
        type: 'select',
        default: 0,
        options: [
          { label: 'Away', value: 0 },
          { label: 'Towards Viewer', value: 1 },
        ],
      },
    ],
    glsl: `${SCENE_LIB}
vec4 transition(vec2 uv) {
  bool vert = hinge > 1.5;
  // Mirror so the hinge always sits on the low edge (uv is y-up, so 'Top' needs the flip).
  bool flip = hinge > 0.5 && hinge < 2.5;
  vec2 pc = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  vec2 pr = vert ? pc.yx : pc;
  if (flip) pr.x = -pr.x;
  float S = vert ? 1.0 : ratio;
  float H = vert ? ratio : 1.0;
  float e = easeIO(progress);
  // The panel turns about its hinge until it is exactly edge-on to the eye, where it vanishes.
  float base = atan(CAM, 0.5 * S);
  float th = e * (swing < 0.5 ? PI - base : base);
  float sg = swing < 0.5 ? 1.0 : -1.0;
  vec3 ro = vec3(0.0, 0.0, -CAM);
  vec3 rd = vec3(pr, CAM);
  vec3 h = hitQuad(ro, rd, vec3(-0.5 * S, -0.5 * H, 0.0), S * vec3(cos(th), 0.0, sg * sin(th)), vec3(0.0, H, 0.0));
  float cov = quadCov(h);
  vec2 t = h.xy;
  if (flip) t.x = 1.0 - t.x;
  if (vert) t = t.yx;
  vec4 door = getFromColor(t);
  door.rgb *= 1.0 - 0.55 * e;
  vec4 under = getToColor(uv);
  under.rgb *= 0.55 + 0.45 * e;
  return mix(under, door, cov);
}`,
  },
  {
    id: 'page-curl',
    name: 'Page Curl',
    category: '3d',
    duration: 1.1,
    params: [
      {
        key: 'corner',
        label: 'Start Corner',
        type: 'select',
        default: 0,
        options: [
          { label: 'Bottom Right', value: 0 },
          { label: 'Bottom Left', value: 1 },
          { label: 'Top Right', value: 2 },
          { label: 'Top Left', value: 3 },
        ],
      },
      { key: 'radius', label: 'Curl Radius', type: 'float', default: 0.12, min: 0.03, max: 0.4, step: 0.005 },
      { key: 'paper', label: 'Paper Back', type: 'color', default: '#f2efe8' },
    ],
    glsl: `
// Coverage of the page rectangle [0, ratio] x [0, 1] at q, with edge width w.
float pageCov(vec2 q, float w) {
  vec2 lo = clamp(q / w + 0.5, 0.0, 1.0);
  vec2 hi = clamp((vec2(ratio, 1.0) - q) / w + 0.5, 0.0, 1.0);
  return lo.x * lo.y * hi.x * hi.y;
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  vec2 asp = vec2(ratio, 1.0);
  vec2 p = uv * asp;
  // d points at the corner where the curl starts; s measures position along it.
  vec2 d = normalize(vec2(mod(corner, 2.0) < 0.5 ? 1.0 : -1.0, corner < 1.5 ? -0.45 : 0.45));
  float sa = dot(vec2(0.0, 0.0), d);
  float sb = dot(vec2(ratio, 0.0), d);
  float sc = dot(vec2(0.0, 1.0), d);
  float sd = dot(vec2(ratio, 1.0), d);
  float smax = max(max(sa, sb), max(sc, sd));
  float smin = min(min(sa, sb), min(sc, sd));
  float r = max(radius, 0.02);
  float e = progress * progress * (3.0 - 2.0 * progress);
  // The page lies flat up to the fold line s0, wraps half-way round a cylinder of radius r there
  // and continues back over itself. The view is straight down, so only s is remapped.
  float s0 = mix(smax + 2.0 * px, smin - r - 2.0 * px, e);
  float x = dot(p, d) - s0;
  float xc = clamp(x, 0.0, r);
  float th = asin(xc / r);
  float frontShift = x < 0.0 ? 0.0 : r * th - x;
  float backShift = x < 0.0 ? PI * r - 2.0 * x : r * (PI - th) - x;
  vec2 pf = p + d * frontShift;
  vec2 pb = p + d * backShift;
  float onRoll = 1.0 - smoothstep(-px, px, x - r);
  float fade = smoothstep(0.0, 0.08, progress) * (1.0 - smoothstep(0.92, 1.0, progress));
  // Incoming picture, shaded by the roll that hovers over it.
  vec4 col = getToColor(uv);
  col.rgb *= 1.0 - 0.45 * fade * exp(-max(x - r, 0.0) / (1.4 * r));
  // Printed side: flat part and the rising half of the roll.
  vec4 front = getFromColor(pf / asp);
  float k = xc / r;
  front.rgb *= 1.0 - 0.4 * k * k;
  front.rgb *= 1.0 - 0.3 * fade * pageCov(pb + d * 0.02, 0.07);
  col = mix(col, front, pageCov(pf, px) * onRoll);
  // Paper back: the far half of the roll and the flap lying on top of the page.
  vec4 back = getFromColor(pb / asp);
  back.rgb = mix(back.rgb, paper * back.a, 0.78);
  back.rgb *= 1.0 - 0.1 * exp(-max(-x, 0.0) / (2.0 * r)) - 0.22 * k * k;
  col = mix(col, back, pageCov(pb, px) * onRoll);
  return col;
}`,
  },
  {
    id: 'accordion',
    name: 'Accordion',
    category: '3d',
    duration: 1.0,
    params: [direction(), { key: 'panels', label: 'Panels', type: 'int', default: 6, min: 2, max: 12, step: 1 }],
    glsl: `${SCENE_LIB}
vec4 transition(vec2 uv) {
  bool vert = direction > 1.5;
  bool flip = direction > 0.5 && direction < 2.5;
  vec2 pc = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  vec2 pr = vert ? pc.yx : pc;
  if (flip) pr.x = -pr.x;
  float S = vert ? 1.0 : ratio;
  float H = vert ? ratio : 1.0;
  float n = clamp(floor(panels + 0.5), 2.0, 12.0);
  float e = easeIO(progress);
  float ph = e * PI * 0.5;
  float c = cos(ph);
  float s = sin(ph);
  float w = S / n;
  // The stack gathers at one edge; it also creeps just past that edge so that, seen in
  // perspective, nothing is left inside the frame when the panels stand edge-on.
  float x0 = -0.5 * S * (1.0 + 1.05 * w * s / CAM);
  vec3 ro = vec3(0.0, 0.0, -CAM);
  vec3 rd = vec3(pr, CAM);
  vec3 vv = vec3(0.0, H, 0.0);
  vec4 sum = vec4(0.0);
  float acc = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    if (fi >= n) break;
    // Even joints are ridges on the frame plane, odd joints are valleys pushed back.
    float odd = mod(fi, 2.0);
    vec3 o = vec3(x0 + fi * w * c, -0.5 * H, odd * w * s);
    vec3 u = vec3(w * c, 0.0, (1.0 - 2.0 * odd) * w * s);
    vec3 h = hitQuad(ro, rd, o, u, vv);
    float cov = quadCov(h);
    vec2 t = vec2((fi + clamp(h.x, 0.0, 1.0)) / n, h.y);
    if (flip) t.x = 1.0 - t.x;
    if (vert) t = t.yx;
    vec4 pcol = getFromColor(t);
    pcol.rgb *= 1.0 - s * (odd > 0.5 ? 0.55 : 0.15);
    sum += pcol * cov;
    acc += cov;
  }
  vec4 under = getToColor(uv);
  under.rgb *= 0.55 + 0.45 * e;
  return sum / max(acc, 1.0) + under * max(1.0 - acc, 0.0);
}`,
  },
  {
    id: 'louvers',
    name: 'Louvers',
    category: '3d',
    duration: 1.0,
    params: [
      { key: 'slats', label: 'Slats', type: 'int', default: 8, min: 2, max: 30, step: 1 },
      {
        key: 'orientation',
        label: 'Slats Run',
        type: 'select',
        default: 0,
        options: [
          { label: 'Horizontally', value: 0 },
          { label: 'Vertically', value: 1 },
        ],
      },
      { key: 'stagger', label: 'Stagger', type: 'float', default: 0.8, min: 0, max: 3, step: 0.05 },
      background,
    ],
    glsl: `${SCENE_LIB}
// Hit on slat i for a pixel at pr: xy = position on the slat, z = ray distance, w = turn angle.
vec4 slatHit(float i, float n, float S, float H, vec2 pr, float topFirst) {
  float w = S / n;
  float o = i / max(n - 1.0, 1.0);
  if (topFirst > 0.5) o = 1.0 - o;
  float th = easeIO(clamp(progress * (1.0 + stagger) - o * stagger, 0.0, 1.0)) * PI;
  vec3 u = vec3(w * cos(th), 0.0, w * sin(th));
  vec3 org = vec3(-0.5 * S + (i + 0.5) * w, -0.5 * H, 0.0) - 0.5 * u;
  return vec4(hitQuad(vec3(0.0, 0.0, -CAM), vec3(pr, CAM), org, u, vec3(0.0, H, 0.0)), th);
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  bool vert = orientation > 0.5;
  vec2 pc = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  // pr.x runs across the stack of slats, pr.y along a slat.
  vec2 pr = vert ? pc : pc.yx;
  float S = vert ? ratio : 1.0;
  float H = vert ? 1.0 : ratio;
  float n = clamp(floor(slats + 0.5), 2.0, 30.0);
  float w = S / n;
  float idx = clamp(floor((pr.x + 0.5 * S) / w), 0.0, n - 1.0);
  float topFirst = vert ? 0.0 : 1.0;
  // The pixel can be covered by its own slat or, when slats swing forward, by a neighbour.
  // Coverage uses finite differences per slat (screen derivatives would break at slat borders).
  vec4 cols[3];
  float covs[3];
  float dist[3];
  for (int k = 0; k < 3; k++) {
    float i = idx + float(k - 1);
    float valid = step(0.0, i) * step(i, n - 0.5);
    i = clamp(i, 0.0, n - 1.0);
    vec4 h = slatHit(i, n, S, H, pr, topFirst);
    vec2 fw = abs(slatHit(i, n, S, H, pr + vec2(px, 0.0), topFirst).xy - h.xy) + abs(slatHit(i, n, S, H, pr + vec2(0.0, px), topFirst).xy - h.xy);
    fw = max(fw, vec2(1e-6));
    vec2 lo = clamp(h.xy / fw + 0.5, 0.0, 1.0);
    vec2 hi = clamp((1.0 - h.xy) / fw + 0.5, 0.0, 1.0);
    covs[k] = lo.x * lo.y * hi.x * hi.y * step(0.0, h.z) * valid;
    dist[k] = h.z;
    bool back = h.w > PI * 0.5;
    float a = clamp(h.x, 0.0, 1.0);
    vec2 t = vec2((i + (back ? 1.0 - a : a)) / n, h.y);
    if (!vert) t = t.yx;
    vec4 col = mix(getFromColor(t), getToColor(t), back ? 1.0 : 0.0);
    col.rgb *= 0.3 + 0.7 * abs(cos(h.w));
    cols[k] = col;
  }
  // Nearest slat first; the other two only fill what it leaves uncovered.
  int best = 1;
  if (covs[0] > 0.001 && (covs[best] <= 0.001 || dist[0] < dist[best])) best = 0;
  if (covs[2] > 0.001 && (covs[best] <= 0.001 || dist[2] < dist[best])) best = 2;
  vec4 others = vec4(0.0);
  float accO = 0.0;
  for (int k = 0; k < 3; k++) {
    if (k == best) continue;
    others += cols[k] * covs[k];
    accO += covs[k];
  }
  float cb = covs[best];
  float co = min(accO, 1.0 - cb);
  vec4 result = cols[best] * cb + (accO > 0.0 ? others / accO : vec4(0.0)) * co;
  return result + vec4(background, 1.0) * max(1.0 - cb - co, 0.0);
}`,
  },
];

export default transitions;
