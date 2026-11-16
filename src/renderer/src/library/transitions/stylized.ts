import type { TransitionDef } from '../types';

/** Picture lookup that only taps the second picture while the two are actually being blended. */
const PICTURE_AT = `
vec4 pictureAt(vec2 t, float m) {
  if (m < 0.001) return getFromColor(t);
  if (m > 0.999) return getToColor(t);
  return mix(getFromColor(t), getToColor(t), m);
}
// Brightness edges of the picture (for inked contours), sampled about 1.5 design px apart.
float edgeAt(vec2 uv, float m, float px) {
  float o = max(1.5 / 1080.0, px);
  float l1 = luma(pictureAt(uv + vec2(o / ratio, 0.0), m).rgb);
  float l2 = luma(pictureAt(uv - vec2(o / ratio, 0.0), m).rgb);
  float l3 = luma(pictureAt(uv + vec2(0.0, o), m).rgb);
  float l4 = luma(pictureAt(uv - vec2(0.0, o), m).rgb);
  return length(vec2(l1 - l2, l3 - l4));
}`;

const transitions: TransitionDef[] = [
  {
    id: 'ink-bleed',
    name: 'Ink Bleed',
    category: 'stylized',
    duration: 1.2,
    params: [
      { key: 'inkColor', label: 'Ink Color', type: 'color', default: '#16131f' },
      { key: 'drops', label: 'Drops', type: 'int', default: 3, min: 1, max: 6, step: 1 },
      { key: 'roughness', label: 'Roughness', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
      { key: 'detail', label: 'Detail', type: 'float', default: 3, min: 0.5, max: 10, step: 0.1 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  vec2 p = (uv - 0.5) * asp;
  float R = 0.5 * length(asp);
  // Distance to the nearest drop in half-diagonals; the first drop lands in the centre, later ones
  // land elsewhere a little later.
  float v = length(p) / R;
  float n = max(floor(drops + 0.5), 1.0);
  for (int i = 1; i < 6; i++) {
    float fi = float(i);
    if (fi >= n) break;
    vec2 c = (hash22(vec2(fi * 7.1, 3.3)) - 0.5) * asp * 0.8;
    v = min(v, length(p - c) / R + 0.12 + 0.25 * hash11(fi * 3.7));
  }
  // The ink creeps along the paper fibres: coarse and fine noise roughen the front.
  v += (fbm(p * detail + 3.0) - 0.5) * roughness + (vnoise(p * detail * 9.0 + 11.0) - 0.5) * roughness * 0.25;
  float spread = 0.625 * roughness;
  float aa = max(fwidth(v), 1e-4);
  float e = 1.0 - (1.0 - progress) * (1.0 - progress);
  float edge = mix(-spread - aa, 1.0 + spread + aa, e);
  float d = v - edge;
  float reveal = 1.0 - smoothstep(-aa, aa, d);
  float env = smoothstep(0.0, 0.1, progress) * (1.0 - smoothstep(0.8, 1.0, progress));
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  // A damp halo stains the paper just ahead of the front...
  float halo = exp(-max(d, 0.0) / 0.05);
  a.rgb = mix(a.rgb, inkColor * a.a, 0.4 * halo * env);
  // ...and behind it the ink is still wet, clearing slowly to the new picture.
  float wet = exp(min(d, 0.0) / 0.16);
  b.rgb = mix(b.rgb, inkColor * b.a, 0.94 * wet * env);
  return mix(a, b, reveal);
}`,
  },
  {
    id: 'brush-strokes',
    name: 'Brush Strokes',
    category: 'stylized',
    duration: 1.2,
    params: [
      { key: 'count', label: 'Strokes', type: 'int', default: 5, min: 1, max: 16, step: 1 },
      {
        key: 'orientation',
        label: 'Strokes Run',
        type: 'select',
        default: 0,
        options: [
          { label: 'Horizontally', value: 0 },
          { label: 'Vertically', value: 1 },
        ],
      },
      { key: 'texture', label: 'Bristle Texture', type: 'float', default: 1, min: 0, max: 2, step: 0.05 },
    ],
    glsl: `
float easeIO(float t) {
  return t * t * (3.0 - 2.0 * t);
}
// Stroke i at this pixel: x = painted amount, y = bristle noise, z = signed distance to its border.
// a: across the strokes (stroke 0 at a = 0), b: along them; la = frame-height length of the b axis.
vec3 brushStroke(float i, float n, float a, float b, float la, vec2 pxab) {
  float valid = step(0.0, i) * step(i, n - 1.0);
  i = clamp(i, 0.0, n - 1.0);
  const float lag = 0.6;
  float D = 1.0 / (1.0 + (n - 1.0) * lag);
  float lp = easeIO(clamp((progress - i * lag * D) / D, 0.0, 1.0));
  float xb = b * la;
  // Fine streaks parallel to the stroke: about 25 bristles across each stroke.
  float bristle = vnoise(vec2(xb * 2.0 + i * 5.0, a * n * 25.0 + i * 11.0));
  float wob = (vnoise(vec2(xb * 2.5 + i * 17.0, i * 3.0)) - 0.5) * 0.25 / n;
  float dy = abs(a - (i + 0.5) / n - wob) - 0.78 / n + bristle * 0.12 / n;
  float across = 1.0 - smoothstep(-pxab.x, pxab.x, dy);
  // Strokes alternate direction like a painter working down a wall; the head is a dry, ragged comb.
  float t = mod(i, 2.0) < 0.5 ? b : 1.0 - b;
  const float head = 0.15;
  float hx = mix(-pxab.y, 1.0 + head + pxab.y, lp);
  float along = 1.0 - smoothstep(-pxab.y, pxab.y, t + bristle * head - hx);
  return vec3(across * along * valid, bristle, dy);
}
vec4 transition(vec2 uv) {
  bool vert = orientation > 0.5;
  float n = max(floor(count + 0.5), 1.0);
  float a = vert ? uv.x : 1.0 - uv.y;
  float b = vert ? 1.0 - uv.y : uv.x;
  float la = vert ? 1.0 : ratio;
  vec2 pxab = vert ? vec2(fwidth(uv.x), fwidth(uv.y)) : vec2(fwidth(uv.y), fwidth(uv.x));
  float idx = floor(a * n);
  vec3 s0 = brushStroke(idx - 1.0, n, a, b, la, pxab);
  vec3 s1 = brushStroke(idx, n, a, b, la, pxab);
  vec3 s2 = brushStroke(idx + 1.0, n, a, b, la, pxab);
  float cov = max(s0.x, max(s1.x, s2.x));
  // Texture comes from the stroke painted last over this pixel.
  vec3 top = s2.x > 0.5 ? s2 : s1.x > 0.5 ? s1 : s0;
  float env = 1.0 - smoothstep(0.7, 1.0, progress);
  vec4 paint = getToColor(uv);
  float shade = 1.0 + (top.y - 0.5) * 0.16 * texture * env;
  // Paint piles up a little along the stroke borders.
  shade *= 1.0 - 0.2 * texture * env * exp(min(top.z, 0.0) * n / 0.08);
  paint.rgb = clamp(paint.rgb * shade, 0.0, paint.a);
  // Close any hairline gaps between neighbouring strokes before the end.
  cov = max(cov, smoothstep(0.85, 1.0, progress));
  return mix(getFromColor(uv), paint, cov);
}`,
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    category: 'stylized',
    duration: 1.0,
    params: [
      { key: 'count', label: 'Tile Rows', type: 'float', default: 16, min: 4, max: 60, step: 1 },
      { key: 'grout', label: 'Grout Width', type: 'float', default: 0.004, min: 0, max: 0.02, step: 0.0005 },
      { key: 'groutColor', label: 'Grout Color', type: 'color', default: '#15161c' },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  float n = max(count, 2.0);
  vec2 g = (uv - 0.5) * asp * n;
  vec2 ip = floor(g);
  vec2 fp = fract(g);
  // Irregular tiles: a jittered Voronoi pattern.
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 cBest = vec2(0.5);
  vec2 idBest = ip;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = o + 0.5 + (hash22(ip + o + 17.0) - 0.5) * 0.75;
      float d = length(c - fp);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        cBest = c;
        idBest = ip + o;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float k = smoothstep(0.0, 0.3, progress) * (1.0 - smoothstep(0.7, 1.0, progress));
  // Every tile turns over to the incoming picture at its own moment.
  float sw = 0.32 + 0.36 * hash21(idBest * 1.7 + 5.0);
  float m = smoothstep(sw - 0.03, sw + 0.03, progress);
  vec2 tc = clamp((ip + cBest) / n / asp + 0.5, 0.0, 1.0);
  vec4 tile = mix(getFromColor(tc), getToColor(tc), m);
  vec4 full = mix(getFromColor(uv), getToColor(uv), m);
  // Glazed tiles: each a little lighter or darker, catching light towards its upper left.
  float shade = (0.9 + 0.2 * hash21(idBest + 9.0)) * (1.0 + 0.16 * dot(fp - cBest, vec2(-0.7, 0.7)));
  tile.rgb = clamp(tile.rgb * shade, 0.0, tile.a);
  vec4 col = mix(full, tile, k);
  float ed = 0.5 * (d2 - d1) / n;
  float aa = max(fwidth(ed), 1e-5);
  float gw = 0.5 * grout;
  float gcov = (1.0 - smoothstep(gw - aa, gw + aa, ed)) * step(1e-5, grout);
  return mix(col, vec4(groutColor, 1.0), gcov * k);
}`,
  },
  {
    id: 'paper-tear',
    name: 'Paper Tear',
    category: 'stylized',
    duration: 1.0,
    params: [
      {
        key: 'orientation',
        label: 'Tear',
        type: 'select',
        default: 0,
        options: [
          { label: 'Vertical', value: 0 },
          { label: 'Horizontal', value: 1 },
        ],
      },
      { key: 'paper', label: 'Paper Color', type: 'color', default: '#f3efe6' },
    ],
    glsl: `
// Position of the tear across the frame, as a function of the position along it (frame heights).
float tearOffset(float a) {
  return (fbm(vec2(a * 2.2, 4.0)) - 0.5) * 0.2 + (vnoise(vec2(a * 40.0, 9.0)) - 0.5) * 0.022;
}
float rectCov(vec2 q, vec2 size, float px) {
  vec2 lo = clamp(q / px + 0.5, 0.0, 1.0);
  vec2 hi = clamp((size - q) / px + 0.5, 0.0, 1.0);
  return lo.x * lo.y * hi.x * hi.y;
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  bool horiz = orientation > 0.5;
  // P.x runs across the tear (the way the halves move apart), P.y along it; both in frame heights.
  vec2 size = horiz ? vec2(1.0, ratio) : vec2(ratio, 1.0);
  float W = size.x;
  vec2 P = horiz ? vec2(uv.y, uv.x * ratio) : vec2(uv.x * ratio, uv.y);
  float k = max(sin(progress * PI), 0.0);
  float e = progress * progress * (3.0 - 2.0 * progress);
  float shift = e * (0.5 * W + 0.16);
  float ang = 0.07 * k;
  // Each half tilts about its outer corner while it is pulled away.
  vec2 qL = rot2(ang) * (P + vec2(shift, 0.0));
  vec2 qR = rot2(-ang) * (P - vec2(shift + W, 0.0)) + vec2(W, 0.0);
  float tL = 0.5 * W + tearOffset(qL.y);
  float tR = 0.5 * W + tearOffset(qR.y);
  // The white fibrous layer shows along the edge of one half once the paper starts to give.
  float rim = (0.01 + 0.016 * vnoise(vec2(qL.y * 25.0, 2.0))) * smoothstep(0.0, 0.15, progress);
  float inL = rectCov(qL, size, px) * clamp((tL - qL.x) / px + 0.5, 0.0, 1.0);
  float imgL = rectCov(qL, size, px) * clamp((tL - rim - qL.x) / px + 0.5, 0.0, 1.0);
  float inR = rectCov(qR, size, px) * clamp((qR.x - tR) / px + 0.5, 0.0, 1.0);
  vec2 uvL = horiz ? vec2(qL.y / ratio, qL.x) : vec2(qL.x / ratio, qL.y);
  vec2 uvR = horiz ? vec2(qR.y / ratio, qR.x) : vec2(qR.x / ratio, qR.y);
  vec3 fibre = paper * (0.9 + 0.1 * vnoise(vec2(qL.x * 90.0, qL.y * 600.0)));
  // Soft shadows of both halves fall on the incoming picture.
  float shL = clamp((tL - qL.x + 0.02) / 0.05 + 0.5, 0.0, 1.0);
  float shR = clamp((qR.x - tR + 0.02) / 0.05 + 0.5, 0.0, 1.0);
  vec4 under = getToColor(uv);
  under.rgb *= 1.0 - 0.45 * k * max(shL, shR);
  vec4 left = getFromColor(clamp(uvL, 0.0, 1.0)) * imgL + vec4(fibre, 1.0) * max(inL - imgL, 0.0);
  vec4 right = getFromColor(clamp(uvR, 0.0, 1.0)) * inR;
  return left + right + under * max(1.0 - inL - inR, 0.0);
}`,
  },
  {
    id: 'film-roll',
    name: 'Film Roll',
    category: 'stylized',
    duration: 1.0,
    params: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 0,
        options: [
          { label: 'Up', value: 0 },
          { label: 'Down', value: 1 },
        ],
      },
      { key: 'blur', label: 'Motion Blur', type: 'float', default: 0.6, min: 0, max: 1.5, step: 0.01 },
      { key: 'background', label: 'Background', type: 'color', default: '#000000' },
    ],
    glsl: `
const float GAP = 0.12;
float ign() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
// The film strip at frame position f (x) and strip position s (along the film), in frame heights.
// Frame 0 is the outgoing shot; frames on the incoming side (sg) show the incoming shot.
vec4 filmAt(vec2 f, float s, float pxf, float sg) {
  float pitch = 1.0 + GAP;
  float idx = floor((s + 0.5 + 0.5 * GAP) / pitch);
  float ly = s - idx * pitch;
  float hw = 0.5 * ratio;
  float cy = clamp((0.5 - abs(ly)) / pxf + 0.5, 0.0, 1.0);
  float cx = clamp((hw - abs(f.x)) / pxf + 0.5, 0.0, 1.0);
  vec2 t = clamp(vec2(f.x / ratio + 0.5, ly + 0.5), 0.0, 1.0);
  vec4 pic = idx * sg < -0.5 ? getToColor(t) : getFromColor(t);
  // Film base with sprocket holes in the margins.
  float ax = abs(f.x) - hw;
  float onFilm = clamp((0.14 - ax) / pxf + 0.5, 0.0, 1.0);
  float hp = pitch / 4.0;
  vec2 hq = vec2(ax - 0.07, (fract(s / hp) - 0.5) * hp);
  vec2 hd = abs(hq) - vec2(0.026, 0.04) + 0.012;
  float hsd = length(max(hd, 0.0)) + min(max(hd.x, hd.y), 0.0) - 0.012;
  float hole = clamp(0.5 - hsd / pxf, 0.0, 1.0);
  vec3 c = mix(background, vec3(0.075, 0.062, 0.055), onFilm);
  c = mix(c, vec3(0.93, 0.91, 0.86), hole * onFilm);
  return mix(vec4(c, 1.0), pic, cx * cy);
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float p = progress;
  float e = p * p * p * (p * (6.0 * p - 15.0) + 10.0);
  // The gate pulls back to show the strip, the film advances one frame, the gate closes in again.
  float z = smoothstep(0.0, 0.25, p) * (1.0 - smoothstep(0.75, 1.0, p));
  float sc = 1.0 - 0.22 * z;
  float weave = 0.004 * z * sin(p * 70.0);
  vec2 f = vec2((uv.x - 0.5) * ratio + weave, uv.y - 0.5) / sc;
  float pxf = px / sc;
  float sg = direction > 0.5 ? -1.0 : 1.0;
  float s = f.y - sg * e * (1.0 + GAP);
  // Vertical motion blur that follows the speed of the strip.
  float len = blur * 0.12 * 30.0 * p * p * (1.0 - p) * (1.0 - p);
  float j = ign();
  vec4 acc = vec4(0.0);
  const int N = 10;
  for (int i = 0; i < N; i++) {
    acc += filmAt(f, s + ((float(i) + j) / float(N) - 0.5) * len, pxf, sg);
  }
  vec4 col = acc / float(N);
  // Projector flicker and a soft gate vignette while the strip is visible.
  col.rgb *= 1.0 - z * (0.06 * hash11(floor(p * 40.0) + 1.0) + 0.5 * dot(uv - 0.5, uv - 0.5));
  return col;
}`,
  },
  {
    id: 'vhs-rewind',
    name: 'VHS Rewind',
    category: 'stylized',
    duration: 1.0,
    params: [
      { key: 'rolls', label: 'Rolls', type: 'int', default: 2, min: 0, max: 6, step: 1 },
      { key: 'amount', label: 'Distortion', type: 'float', default: 1, min: 0, max: 2, step: 0.05 },
      { key: 'showIcon', label: 'Rewind Icon', type: 'bool', default: true },
    ],
    glsl: `
// Signed distance to a left-pointing triangle: tip at (x0, yc), width w, half-height hh.
float rewTri(vec2 P, float x0, float yc, float w, float hh) {
  float sl = w / hh;
  float dEdge = (abs(P.y - yc) * sl - (P.x - x0)) / sqrt(1.0 + sl * sl);
  return max(dEdge, P.x - x0 - w);
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float k = max(sin(progress * PI), 0.0);
  float e = progress * progress * (3.0 - 2.0 * progress);
  float st = floor(progress * 30.0);
  // The picture rolls through whole frames while the tape rewinds.
  float qy = fract(uv.y + floor(rolls + 0.5) * e);
  float seamD = min(qy, 1.0 - qy);
  float line = floor((1.0 - uv.y) * 240.0);
  float ln = hash21(vec2(line, st + 3.0));
  // Tracking errors: a torn band travels up the frame and every line jitters a little.
  float tb = fract(uv.y * 0.8 - progress * 2.3);
  float band = smoothstep(0.0, 0.05, tb) * (1.0 - smoothstep(0.08, 0.2, tb));
  float dx = k * amount * ((ln - 0.5) * 0.006 + band * (0.03 + 0.04 * ln));
  dx += k * k * amount * 0.01 * sin(uv.y * 14.0 + progress * 40.0);
  vec2 q = vec2(clamp(uv.x + dx, 0.0, 1.0), qy);
  vec2 ca = vec2(0.008 * k * amount, 0.0);
  vec4 c0;
  vec4 cr;
  vec4 cb;
  if (progress < 0.5) {
    c0 = getFromColor(q);
    cr = getFromColor(clamp(q + ca, 0.0, 1.0));
    cb = getFromColor(clamp(q - ca, 0.0, 1.0));
  } else {
    c0 = getToColor(q);
    cr = getToColor(clamp(q + ca, 0.0, 1.0));
    cb = getToColor(clamp(q - ca, 0.0, 1.0));
  }
  vec4 col = vec4(cr.r, c0.g, cb.b, c0.a);
  // Washed-out tape colour with lifted blacks.
  col.rgb = mix(col.rgb, vec3(luma(col.rgb)), 0.3 * k);
  col.rgb = col.rgb * (1.0 - 0.1 * k) + 0.05 * k * col.a;
  // Sparse white dropouts, and a band of static where the rolling picture wraps around.
  float sn = hash21(vec2(floor(uv.x * 160.0 + ln * 40.0), line + st * 7.0));
  col.rgb = mix(col.rgb, vec3(0.9) * col.a, step(1.0 - 0.025 * k, sn) * k * 0.8);
  float bar = (1.0 - smoothstep(0.015, 0.05, seamD)) * min(k * 3.0, 1.0);
  vec3 barCol = vec3(0.04 + 0.5 * hash21(vec2(floor(uv.x * 200.0), line + st)) * smoothstep(0.0, 0.02, seamD));
  col = mix(col, vec4(barCol, 1.0), bar);
  // A blinking rewind symbol in the corner.
  float icon = showIcon * smoothstep(0.05, 0.12, progress) * (1.0 - smoothstep(0.88, 0.95, progress)) * step(0.35, fract(progress * 5.0));
  vec2 P = vec2(uv.x * ratio, 1.0 - uv.y);
  float d = min(rewTri(P, 0.06, 0.08, 0.045, 0.032), rewTri(P, 0.105, 0.08, 0.045, 0.032));
  float ds = min(rewTri(P - 0.004, 0.06, 0.08, 0.045, 0.032), rewTri(P - 0.004, 0.105, 0.08, 0.045, 0.032));
  col = mix(col, vec4(0.0, 0.0, 0.0, 1.0), clamp(0.5 - ds / px, 0.0, 1.0) * icon * 0.6);
  col = mix(col, vec4(0.95, 0.95, 0.95, 1.0), clamp(0.5 - d / px, 0.0, 1.0) * icon);
  return col;
}`,
  },
  {
    id: 'comic-halftone',
    name: 'Comic Halftone',
    category: 'stylized',
    duration: 1.0,
    params: [
      { key: 'dotSize', label: 'Dot Size', type: 'float', default: 12, min: 4, max: 40, step: 0.5, unit: 'px' },
      { key: 'paper', label: 'Paper', type: 'color', default: '#fbf3e0' },
      { key: 'inkColor', label: 'Outline', type: 'color', default: '#16131a' },
    ],
    glsl: `${PICTURE_AT}
// Ink coverage of one screen of dots (angle ang, cell size s in frame heights) for one channel.
float screenInk(vec2 p, float ang, float s, int ch, float m, float px) {
  mat2 r = rot2(ang);
  vec2 g = r * p / s;
  vec2 cid = floor(g) + 0.5;
  vec2 cp = transpose(r) * cid * s;
  vec4 c = pictureAt(clamp(cp / vec2(ratio, 1.0) + 0.5, 0.0, 1.0), m);
  float v = ch == 0 ? c.r : ch == 1 ? c.g : c.b;
  v = clamp((v - 0.5) * 1.25 + 0.5, 0.0, 1.0);
  float rad = 0.72 * sqrt(1.0 - v);
  float cov = clamp((rad - length(g - cid)) * s / px + 0.5, 0.0, 1.0) * smoothstep(0.0, px / s, rad);
  // Cells only a few pixels wide fall back to the coverage they would average to.
  return mix(cov, min(PI * rad * rad, 1.0), smoothstep(0.2, 0.45, px / s));
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float h = smoothstep(0.0, 0.3, progress) * (1.0 - smoothstep(0.7, 1.0, progress));
  float m = smoothstep(0.42, 0.58, progress);
  vec4 full = mix(getFromColor(uv), getToColor(uv), m);
  if (h < 0.001) return full;
  vec2 p = (uv - 0.5) * vec2(ratio, 1.0);
  float s = max(dotSize, 2.0) / 1080.0;
  // Cyan, magenta and yellow screens at the classic print angles.
  float cI = screenInk(p, radians(15.0), s, 0, m, px);
  float mI = screenInk(p, radians(75.0), s, 1, m, px);
  float yI = screenInk(p, 0.0, s, 2, m, px);
  vec3 col = paper;
  col *= mix(vec3(1.0), vec3(0.0, 0.62, 0.9), cI);
  col *= mix(vec3(1.0), vec3(0.93, 0.0, 0.55), mI);
  col *= mix(vec3(1.0), vec3(1.0, 0.92, 0.0), yI);
  // Bold inked contours.
  float line = smoothstep(0.1, 0.25, edgeAt(uv, m, px));
  col = mix(col, inkColor, line);
  return mix(full, vec4(col, 1.0) * full.a, h);
}`,
  },
  {
    id: 'crosshatch',
    name: 'Crosshatch',
    category: 'stylized',
    duration: 1.1,
    params: [
      { key: 'spacing', label: 'Line Spacing', type: 'float', default: 7, min: 3, max: 30, step: 0.5, unit: 'px' },
      { key: 'paper', label: 'Paper', type: 'color', default: '#f4efe4' },
      { key: 'inkColor', label: 'Ink', type: 'color', default: '#2a2522' },
      { key: 'wash', label: 'Color Wash', type: 'float', default: 0.25, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${PICTURE_AT}
// Coverage of a family of parallel pen lines (angle ang, spacing sp and width w in frame heights).
float hatchLines(vec2 p, float ang, float sp, float w, float px, float wob) {
  float t = dot(p, vec2(cos(ang), sin(ang))) / sp + wob;
  float d = abs(fract(t) - 0.5) * sp;
  float cov = clamp((0.5 * w - d) / px + 0.5, 0.0, 1.0);
  // Lines closer than a few pixels fade to their average density instead of producing moiré.
  return mix(cov, w / sp, smoothstep(0.25, 0.5, px / sp));
}
float darkerThan(float l, float t) {
  return 1.0 - smoothstep(t - 0.12, t, l);
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float h = smoothstep(0.0, 0.35, progress) * (1.0 - smoothstep(0.65, 1.0, progress));
  float m = smoothstep(0.45, 0.55, progress);
  vec4 full = mix(getFromColor(uv), getToColor(uv), m);
  if (h < 0.001) return full;
  vec2 p = (uv - 0.5) * vec2(ratio, 1.0);
  float sp = max(spacing, 2.0) / 1080.0;
  float w = sp * 0.28;
  float l = luma(full.rgb);
  // A slight hand-drawn wobble in every line.
  float wob = (vnoise(p * 24.0) - 0.5) * 0.35;
  // As the drawing builds up, darker tones receive more layers of hatching.
  float ink = hatchLines(p, radians(45.0), sp, w, px, wob) * darkerThan(l, 0.85 * h);
  ink = max(ink, hatchLines(p, radians(-45.0), sp, w, px, wob * 1.3) * darkerThan(l, 0.6 * h));
  ink = max(ink, hatchLines(p, radians(10.0), sp * 0.8, w, px, -wob) * darkerThan(l, 0.38 * h));
  ink = max(ink, hatchLines(p, radians(80.0), sp * 0.7, w, px, wob * 0.7) * darkerThan(l, 0.2 * h));
  // Contours drawn from the picture's edges.
  ink = max(ink, smoothstep(0.08, 0.22, edgeAt(uv, m, px)) * smoothstep(0.2, 0.6, h));
  vec3 sheet = paper * (0.97 + 0.03 * vnoise(p * 180.0));
  vec3 sketch = mix(sheet, inkColor, ink * 0.92);
  // A light watercolour wash of the picture's own colours.
  vec3 tint = clamp(full.rgb / max(full.a, 1e-4) * 1.15 + 0.1, 0.0, 1.0);
  sketch *= mix(vec3(1.0), tint, wash);
  return mix(full, vec4(sketch, 1.0) * full.a, h);
}`,
  },
  {
    id: 'paint-splatter',
    name: 'Paint Splatter',
    category: 'stylized',
    duration: 1.0,
    params: [
      { key: 'count', label: 'Splats', type: 'int', default: 9, min: 1, max: 16, step: 1 },
      { key: 'paintColor', label: 'Paint', type: 'color', default: '#ff3e6c' },
      { key: 'rimWidth', label: 'Paint Rim', type: 'float', default: 0.03, min: 0, max: 0.1, step: 0.001 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  vec2 asp = vec2(ratio, 1.0);
  vec2 p = (uv - 0.5) * asp;
  float n = clamp(floor(count + 0.5), 1.0, 16.0);
  float grow = smoothstep(0.55, 1.0, progress);
  float sd = 1e3;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    if (fi >= n) break;
    vec2 c = (hash22(vec2(fi * 3.17 + 1.0, fi * 1.31 + 7.0)) - 0.5) * asp * 0.9;
    float t0 = 0.5 * hash11(fi * 9.1 + 2.0);
    float lp = clamp((progress - t0) / 0.25, 0.0, 1.0);
    // Each splat lands with a fast splash, then everything spreads until any single splat
    // covers the whole frame (its rim never shrinks below 70 % of the nominal radius).
    float base = (0.09 + 0.08 * hash11(fi * 5.3)) * (1.0 - (1.0 - lp) * (1.0 - lp) * (1.0 - lp));
    float far = length(abs(c) + 0.5 * asp);
    float rad = base + grow * (far / 0.7 + 0.1);
    vec2 d = p - c;
    float r = length(d);
    vec2 dirn = d / max(r, 1e-4);
    float wob = 1.0 + 0.35 * (vnoise(dirn * 2.2 + fi * 7.0) - 0.5) + 0.25 * (vnoise(dirn * 6.0 + fi * 3.0) - 0.5);
    sd = min(sd, r - rad * wob);
    // Droplets flung out around the splat.
    for (int j = 0; j < 4; j++) {
      vec2 hj = hash22(vec2(fi * 13.0 + float(j), 5.0));
      float a = hj.x * TAU;
      vec2 dc = c + vec2(cos(a), sin(a)) * base * (1.3 + 0.9 * hj.y);
      sd = min(sd, length(p - dc) - base * (0.08 + 0.12 * hash11(fi * 11.0 + float(j))));
    }
  }
  // The picture shows a little inside a rim of wet paint (the rim disappears at both ends).
  float env = smoothstep(0.0, 0.1, progress) * (1.0 - smoothstep(0.8, 1.0, progress));
  float covPaint = 1.0 - smoothstep(-px, px, sd + px);
  float covPic = 1.0 - smoothstep(-px, px, sd + px + rimWidth * env);
  vec3 wet = paintColor * (0.9 + 0.2 * vnoise(p * 30.0));
  vec4 col = mix(getFromColor(uv), vec4(wet, 1.0), covPaint);
  return mix(col, getToColor(uv), covPic);
}`,
  },
];

export default transitions;
