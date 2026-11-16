import type { EffectDef, ParamDef } from '../types';

const AMOUNT: ParamDef = { key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0, max: 1, step: 0.01 };

/** 4×4 ordered-dither threshold in -0.5..0.5 for an integer cell position. */
const BAYER = `
float bayer4(vec2 p) {
  const float M[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 i = ivec2(mod(p, 4.0));
  return (M[i.y * 4 + i.x] + 0.5) / 16.0 - 0.5;
}`;

/**
 * Alias-free chunky pixels: `cellColor(id, s)` is evaluated for the four nearest cells and blended
 * over exactly one real pixel at the cell borders, so blocks stay crisp at any preview scale.
 */
const BLOCKY = `
vec4 blocky(vec2 uv, float s) {
  vec2 q = uv * u_res / s - 0.5;
  vec2 id = floor(q);
  vec2 w = clamp((q - id - 0.5) * s + 0.5, 0.0, 1.0);
  return mix(
    mix(cellColor(id, s), cellColor(id + vec2(1.0, 0.0), s), w.x),
    mix(cellColor(id + vec2(0.0, 1.0), s), cellColor(id + 1.0, s), w.x),
    w.y);
}`;

const effects: EffectDef[] = [
  {
    id: 'film-grain',
    name: 'Film Grain',
    category: 'retro',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
      { key: 'size', label: 'Grain size', type: 'float', default: 1.5, min: 0.5, max: 8, step: 0.1, unit: 'px' },
      { key: 'chroma', label: 'Colour grain', type: 'float', default: 0.2, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
float grainAt(vec2 p) { return vnoise(p) + 0.5 * vnoise(p * 2.03 + 31.0) - 0.75; }
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // A fresh pattern 24 times a second, in design pixels so previews match the export.
  float tick = mod(floor(u_time * 24.0), 499.0);
  vec2 p = uv * u_res / (u_px * max(size, 0.25)) + hash22(vec2(tick, tick * 1.7 + 3.0)) * 200.0;
  // Soft two-octave noise clumps like real grain instead of per-pixel static.
  float g = grainAt(p);
  vec3 n = mix(vec3(g), vec3(g, grainAt(p + 57.0), grainAt(p + 113.0)), chroma);
  // Grain sits mostly in the midtones and thins out towards pure black and white.
  float l = luma(rgb);
  float resp = mix(1.0, 4.0 * l * (1.0 - l), 0.5);
  rgb = clamp(rgb + n * amount * 0.9 * resp, 0.0, 1.0);
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'vhs',
    name: 'VHS',
    category: 'retro',
    animated: true,
    params: [
      { key: 'intensity', label: 'Intensity', type: 'float', default: 0.75, min: 0, max: 1, step: 0.01 },
      { key: 'bleed', label: 'Colour bleed', type: 'float', default: 12, min: 0, max: 60, step: 0.5, unit: 'px' },
      { key: 'tracking', label: 'Tracking errors', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'tapeNoise', label: 'Tape noise', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec3 toYiq(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312)));
}
vec3 fromYiq(vec3 c) {
  return vec3(c.x + 0.956 * c.y + 0.621 * c.z, c.x - 0.272 * c.y - 0.647 * c.z, c.x - 1.106 * c.y + 1.703 * c.z);
}
vec4 effect(vec2 uv) {
  if (intensity <= 0.0) return tex(uv);
  float k = intensity;
  float t = u_time;
  float tick = mod(floor(t * 30.0), 997.0);
  float yd = uv.y * u_res.y / u_px;
  float lineN = hash21(vec2(floor(yd / 2.0), tick)) - 0.5;
  // Tape wobble: every line drifts sideways a touch.
  float wob = (vnoise(vec2(yd * 0.02, t * 3.0)) - 0.5) * 6.0 + lineN * 1.5;
  // Head switching bends and tears the last few lines of the frame.
  float hs = smoothstep(0.93, 1.0, uv.y) * tracking;
  float hsOff = hs * hs * (40.0 + 30.0 * sin(t * 17.0 + yd * 0.3));
  // A tracking band rolls slowly through the picture.
  float bd = uv.y - fract(t * 0.11 + 0.2);
  float band = exp(-bd * bd * 900.0) * tracking;
  vec2 q = vec2(uv.x + (wob + hsOff + band * 90.0 * (lineN + 0.2)) * k * u_px / u_res.x, uv.y);
  // Tape has little luma bandwidth and far less for chroma: blur along the line, and smear
  // the colour further and slightly to the right.
  vec2 px = vec2(u_px / u_res.x, 0.0);
  vec4 sharp = vec4(0.0);
  float wl = 0.0;
  for (int i = -2; i <= 2; i++) {
    float w = 1.0 - abs(float(i)) / 3.0;
    sharp += texM(q + px * float(i) * 0.9 * k) * w;
    wl += w;
  }
  sharp /= wl;
  vec3 smear = vec3(0.0);
  float wc = 0.0;
  for (int i = -4; i <= 4; i++) {
    float f = float(i) / 4.0;
    float w = 1.0 - abs(f) * 0.7;
    smear += texM(q + px * (f + 0.4) * bleed * k).rgb * w;
    wc += w;
  }
  vec3 yiq = vec3(toYiq(sharp.rgb).x, toYiq(smear / wc).yz * (1.0 + 0.25 * k));
  vec3 rgb = fromYiq(yiq);
  float a = sharp.a;
  // Hiss stretched along the line, stronger inside the damaged zones, plus rare white dropouts.
  float n = hash21(floor(vec2(uv.x * u_res.x / (u_px * 6.0), yd / 1.5)) + tick * vec2(5.3, 9.1)) - 0.5;
  rgb += n * a * k * (tapeNoise * 0.22 + (band + hs) * 0.9);
  vec2 dc = vec2(uv.x * u_res.x / (u_px * 110.0), yd / 2.5);
  float drop = step(1.0 - 0.006 * tapeNoise * k, hash21(floor(dc) + tick * vec2(1.7, 3.3))) * (1.0 - fract(dc.x));
  rgb = mix(rgb, vec3(a), drop * 0.85);
  // Lifted blacks and gently compressed highlights.
  rgb = mix(rgb, rgb * 0.9 + 0.06 * a, k);
  return vec4(clamp(rgb, vec3(0.0), vec3(a)), a);
}`,
  },
  {
    id: 'crt',
    name: 'CRT Screen',
    category: 'retro',
    params: [
      AMOUNT,
      { key: 'curvature', label: 'Curvature', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
      { key: 'scanlines', label: 'Scanlines', type: 'float', default: 0.55, min: 0, max: 1, step: 0.01 },
      { key: 'grille', label: 'Colour mask', type: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
      { key: 'lineSize', label: 'Line pitch', type: 'float', default: 4, min: 2, max: 20, step: 0.5, unit: 'px' },
      { key: 'vignette', label: 'Vignette', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 base = tex(uv);
  if (amount <= 0.0) return base;
  // Bulge the picture like the face of a tube; the corners fall outside and go black.
  vec2 p = uv * 2.0 - 1.0;
  vec2 pc = p * (1.0 + curvature * 0.15 * p.yx * p.yx);
  vec2 q = pc * 0.5 + 0.5;
  vec2 hs = u_res * 0.5;
  float rr = (0.01 + 0.07 * curvature) * u_res.y;
  vec2 dd = abs(pc) * hs - (hs - rr);
  float sd = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - rr;
  float tube = 1.0 - clamp(sd + 0.5, 0.0, 1.0);
  // Slight misconvergence of the three guns.
  vec2 cv = vec2(0.8 * u_px / u_res.x, 0.0);
  vec4 cr = tex(q + cv);
  vec4 cg = tex(q);
  vec4 cb = tex(q - cv);
  vec4 c = vec4(cr.r, cg.g, cb.b, max(cg.a, max(cr.a, cb.a)));
  // Scanlines and aperture grille are band-limited: when the pitch is too fine to resolve
  // they fade to their average brightness instead of producing moiré.
  float pitch = max(lineSize, 1.0) * u_px;
  float vis = clamp(pitch * 0.5 - 1.0, 0.0, 1.0);
  float l = luma(c.rgb);
  float gap = mix(0.5, 0.5 - 0.5 * cos(q.y * u_res.y / pitch * TAU), vis);
  // Bright lines bloom into the gaps, dark ones stay thin.
  float scan = 1.0 - scanlines * (1.0 - 0.5 * l) * gap;
  vec3 tri = 0.5 + 0.5 * cos((q.x * u_res.x / pitch + vec3(0.0, 0.3333, 0.6667)) * TAU);
  vec3 mask = 1.0 - grille * (1.0 - mix(vec3(0.5), tri, vis));
  float gain = mix(1.0, 1.0 / ((1.0 - 0.375 * scanlines) * (1.0 - 0.5 * grille)), 0.75);
  float vg = pow(clamp(16.0 * q.x * (1.0 - q.x) * q.y * (1.0 - q.y), 0.0, 1.0), 0.3 * vignette);
  vec3 rgb = min(c.rgb * scan * mask * gain * vg, vec3(c.a));
  // Outside the tube: black, but never beyond the layer's own coverage.
  vec4 screen = mix(vec4(0.0, 0.0, 0.0, base.a), vec4(rgb, c.a), tube);
  return mix(base, screen, amount);
}`,
  },
  {
    id: 'old-film',
    name: 'Old Film',
    category: 'retro',
    animated: true,
    params: [
      AMOUNT,
      { key: 'scratches', label: 'Scratches', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'dust', label: 'Dust', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'flicker', label: 'Flicker', type: 'float', default: 0.45, min: 0, max: 1, step: 0.01 },
      { key: 'grain', label: 'Grain', type: 'float', default: 0.45, min: 0, max: 1, step: 0.01 },
      { key: 'tone', label: 'Tone', type: 'color', default: '#fff1d6' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 base = tex(uv);
  if (amount <= 0.0) return base;
  // Everything changes once per frame of an 18 fps projector.
  float fr = mod(floor(u_time * 18.0), 1009.0);
  // Gate weave: the frame never sits in quite the same place twice.
  vec2 weave = (hash22(vec2(fr, 3.0)) - 0.5) * vec2(1.2, 3.0) * amount * u_px / u_res;
  vec4 c = tex(uv + weave);
  if (c.a <= 0.0) return mix(base, c, amount);
  vec3 rgb = c.rgb / c.a;
  // Monochrome stock with a hard, slightly blown-out curve.
  float l = pow(smoothstep(0.02, 0.95, luma(rgb)), 0.9);
  vec3 film = l * tone;
  film *= 1.0 + flicker * ((hash11(fr * 1.3 + 7.0) - 0.5) * 0.35 + (vnoise(vec2(u_time * 2.0, 5.0)) - 0.5) * 0.2);
  vec2 p = uv * u_res / u_px;
  // Scratches: thin vertical lines that hold for a moment, wander and break up along their length.
  float sc = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float slot = mod(floor(u_time * (1.5 + fi * 0.7)) + fi * 37.0, 1009.0);
    float on = step(1.0 - scratches * 0.7, hash11(slot + 11.0));
    float x = hash11(slot) * u_res.x / u_px + (hash11(fr + fi) - 0.5) * 3.0;
    float w = 0.5 + 1.0 * hash11(slot + 5.0);
    float line = 1.0 - smoothstep(w, w + 1.0 / u_px, abs(p.x - x));
    float broken = smoothstep(0.3, 0.5, vnoise(vec2(p.y * 0.008 + slot, fi)));
    float sgn = hash11(slot + 23.0) > 0.3 ? 1.0 : -1.0;
    sc += on * line * broken * sgn * (0.4 + 0.6 * hash11(slot + 41.0));
  }
  film += sc * 0.55;
  // Dust and hairs: a few irregular specks that change every frame.
  float specks = 0.0;
  for (int i = 0; i < 2; i++) {
    float cs = i == 0 ? 230.0 : 130.0;
    vec2 g = p / cs;
    vec2 seed = floor(g) + vec2(fr * 7.0 + float(i) * 51.0, fr * 3.0);
    float on = step(1.0 - dust * 0.22, hash21(seed));
    vec2 pos = 0.2 + 0.6 * hash22(seed + 9.0);
    float r = 0.012 + 0.035 * hash21(seed + 21.0);
    float d = length((fract(g) - pos) * vec2(1.0, 0.6 + 0.8 * hash21(seed + 33.0)));
    float aa = 1.0 / (cs * u_px);
    specks += on * (1.0 - smoothstep(r - aa, r + aa, d));
  }
  film *= 1.0 - min(specks, 1.0) * 0.85;
  vec2 go = hash22(vec2(fr, 9.0)) * 200.0;
  film += (vnoise(p / 1.6 + go) + 0.5 * vnoise(p / 0.8 + go.yx) - 0.75) * grain * 0.3;
  vec2 v = uv - 0.5;
  film *= 1.0 - dot(v, v) * 1.3;
  rgb = mix(rgb, clamp(film, 0.0, 1.0), amount);
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'super-8',
    name: 'Super 8',
    category: 'retro',
    animated: true,
    params: [
      AMOUNT,
      { key: 'grain', label: 'Grain', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'weave', label: 'Gate weave', type: 'float', default: 3, min: 0, max: 20, step: 0.5, unit: 'px' },
      { key: 'vignette', label: 'Vignette', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'leak', label: 'Light leaks', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 base = tex(uv);
  if (amount <= 0.0) return base;
  float fr = mod(floor(u_time * 18.0), 1009.0);
  // Gate weave: a slow drift plus a little jump on every frame.
  vec2 wv = vec2(vnoise(vec2(u_time * 1.3, 2.0)), vnoise(vec2(u_time * 1.1, 8.0))) * 2.0 - 1.0 + (hash22(vec2(fr, 5.0)) - 0.5) * 0.8;
  vec2 q = uv + wv * weave * amount * u_px / u_res;
  // Small-gauge optics are soft.
  vec2 sp = vec2(1.6 * u_px * amount) / u_res;
  vec4 c = (tex(q) * 2.0 + tex(q + vec2(sp.x, 0.0)) + tex(q - vec2(sp.x, 0.0)) + tex(q + vec2(0.0, sp.y)) + tex(q - vec2(0.0, sp.y))) / 6.0;
  if (c.a <= 0.0) return mix(base, c, amount);
  vec3 rgb = c.rgb / c.a;
  // Warm, slightly faded reversal stock.
  vec3 film = mix(rgb, rgb * rgb * (3.0 - 2.0 * rgb), 0.35);
  film *= vec3(1.08, 1.0, 0.86);
  film = mix(vec3(luma(film)), film, 1.15);
  film = film * 0.88 + vec3(0.07, 0.055, 0.045);
  film *= 1.0 + (hash11(fr * 1.7 + 3.0) - 0.5) * 0.12;
  vec2 p = uv * u_res / u_px;
  vec2 go = hash22(vec2(fr, 9.0)) * 200.0;
  vec3 n = vec3(vnoise(p / 2.2 + go), vnoise(p / 2.2 + go + 57.0), vnoise(p / 2.2 + go + 113.0)) - 0.5;
  film += mix(vec3(n.g), n, 0.5) * grain * 0.35;
  // Now and then light fogs the film from the edge.
  float lk = leak * smoothstep(0.5, 0.85, vnoise(vec2(u_time * 0.8, 31.0)));
  film += vec3(1.0, 0.45, 0.12) * lk * smoothstep(0.45, 0.0, uv.x) * (0.6 + 0.4 * vnoise(vec2(uv.y * 3.0, u_time)));
  // Vignette and the soft, rounded edge of the film gate.
  vec2 v = uv - 0.5;
  film *= 1.0 - vignette * dot(v, v) * 2.2;
  vec2 hs = u_res * 0.5;
  float rr = 0.06 * u_res.y;
  vec2 dd = abs(v) * u_res - (hs - rr - 0.012 * u_res.y);
  float sd = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - rr;
  film *= 1.0 - smoothstep(-0.02 * u_res.y, 0.006 * u_res.y, sd);
  rgb = mix(rgb, clamp(film, 0.0, 1.0), amount);
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'sepia-projector',
    name: 'Sepia Projector',
    category: 'retro',
    animated: true,
    params: [
      AMOUNT,
      { key: 'tone', label: 'Tone', type: 'color', default: '#ffcf96' },
      { key: 'hotspot', label: 'Lamp hotspot', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'flicker', label: 'Flicker', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'softness', label: 'Softness', type: 'float', default: 1.5, min: 0, max: 8, step: 0.1, unit: 'px' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 base = tex(uv);
  if (amount <= 0.0) return base;
  float fr = mod(floor(u_time * 16.0), 1009.0);
  // The frame trembles a little in the gate, and the lens is never quite sharp.
  vec2 q = uv + vec2(0.0, (hash11(fr + 2.0) - 0.5) * 1.5 * amount * u_px / u_res.y);
  vec2 sp = vec2(softness * amount * u_px) / u_res;
  vec4 c = (tex(q) * 2.0 + tex(q + sp) + tex(q - sp) + tex(q + vec2(sp.x, -sp.y)) + tex(q + vec2(-sp.x, sp.y))) / 6.0;
  if (c.a <= 0.0) return mix(base, c, amount);
  vec3 rgb = c.rgb / c.a;
  // Sepia toning: luminance carried by the tone colour, with a slightly lifted toe.
  vec3 sep = clamp(luma(rgb) * tone / max(luma(tone), 0.001), 0.0, 1.0) * 0.92 + vec3(0.05, 0.035, 0.02);
  // The projector lamp: a bright centre falling off towards the corners, never quite steady.
  vec2 d = (uv - vec2(0.5, 0.48)) * vec2(u_aspect, 1.0);
  float lamp = 1.0 + hotspot * (0.3 * exp(-dot(d, d) * 3.0) - 0.75 * smoothstep(0.25, 1.1, length(d)));
  float fl = 1.0 + flicker * ((hash11(fr * 1.9) - 0.5) * 0.22 + (vnoise(vec2(u_time * 5.0, 1.0)) - 0.5) * 0.18);
  sep *= lamp * fl;
  vec2 p = uv * u_res / u_px;
  sep += (vnoise(p / 1.4 + hash22(vec2(fr, 9.0)) * 200.0) - 0.5) * 0.07;
  rgb = mix(rgb, clamp(sep, 0.0, 1.0), amount);
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'eight-bit',
    name: '8-Bit',
    category: 'retro',
    params: [
      { key: 'size', label: 'Pixel size', type: 'float', default: 8, min: 1, max: 80, step: 0.5, unit: 'px' },
      {
        key: 'palette',
        label: 'Palette',
        type: 'select',
        default: 1,
        options: [
          { label: 'Colour levels', value: 0 },
          { label: '16 colours', value: 1 },
          { label: '4 colours', value: 2 },
          { label: '1-bit', value: 3 },
        ],
      },
      { key: 'levels', label: 'Levels per channel', type: 'int', default: 4, min: 2, max: 8, step: 1 },
      { key: 'dither', label: 'Dither', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${BAYER}
const vec3 PAL16[16] = vec3[16](
  vec3(0.05, 0.05, 0.07), vec3(0.36, 0.37, 0.40), vec3(0.66, 0.67, 0.70), vec3(0.97, 0.97, 0.94),
  vec3(0.75, 0.15, 0.18), vec3(0.93, 0.46, 0.16), vec3(0.98, 0.84, 0.25), vec3(0.56, 0.80, 0.25),
  vec3(0.16, 0.55, 0.25), vec3(0.30, 0.76, 0.86), vec3(0.20, 0.40, 0.80), vec3(0.13, 0.16, 0.42),
  vec3(0.48, 0.25, 0.65), vec3(0.90, 0.42, 0.66), vec3(0.47, 0.29, 0.18), vec3(0.93, 0.74, 0.60));
const vec3 PAL4[4] = vec3[4](vec3(0.04, 0.04, 0.05), vec3(0.33, 1.0, 1.0), vec3(1.0, 0.33, 1.0), vec3(1.0, 1.0, 1.0));
vec4 cellColor(vec2 id, float s) {
  vec2 cuv = (id + 0.5) * s / u_res;
  vec2 sp = vec2(s * 0.25) / u_res;
  vec4 c = (tex(cuv + sp) + tex(cuv - sp)) * 0.5;
  if (c.a < 0.5) return vec4(0.0);
  vec3 rgb = c.rgb / c.a;
  float d = bayer4(id) * dither;
  if (palette < 0.5) {
    float n = max(floor(levels + 0.5), 2.0) - 1.0;
    rgb = floor(rgb * n + 0.5 + d) / n;
  } else if (palette < 2.5) {
    // Nearest colour of a fixed palette, after nudging by the dither pattern.
    vec3 want = rgb + d * (palette < 1.5 ? 0.3 : 0.7);
    float best = 1.0e9;
    for (int i = 0; i < 16; i++) {
      if (palette > 1.5 && i > 3) break;
      vec3 pc = palette < 1.5 ? PAL16[i] : PAL4[i];
      vec3 df = want - pc;
      float e = dot(df * df, vec3(0.3, 0.59, 0.11));
      if (e < best) { best = e; rgb = pc; }
    }
  } else {
    rgb = vec3(step(0.5, luma(rgb) + d * 0.9));
  }
  return vec4(clamp(rgb, 0.0, 1.0), 1.0);
}${BLOCKY}
vec4 effect(vec2 uv) {
  return blocky(uv, max(size * u_px, 1.0));
}`,
  },
  {
    id: 'pocket-console',
    name: 'Pocket Console',
    category: 'retro',
    params: [
      { key: 'size', label: 'Pixel size', type: 'float', default: 9, min: 2, max: 80, step: 0.5, unit: 'px' },
      {
        key: 'shade',
        label: 'Screen',
        type: 'select',
        default: 0,
        options: [
          { label: 'Olive green', value: 0 },
          { label: 'Grey', value: 1 },
          { label: 'Amber', value: 2 },
        ],
      },
      { key: 'contrast', label: 'Contrast', type: 'float', default: 0.2, min: -0.5, max: 1, step: 0.01 },
      { key: 'dither', label: 'Dither', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'grid', label: 'Pixel grid', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${BAYER}
vec3 darkest() { return shade < 0.5 ? vec3(0.06, 0.16, 0.09) : (shade < 1.5 ? vec3(0.10, 0.11, 0.10) : vec3(0.17, 0.07, 0.02)); }
vec3 lightest() { return shade < 0.5 ? vec3(0.77, 0.84, 0.48) : (shade < 1.5 ? vec3(0.80, 0.83, 0.76) : vec3(1.0, 0.72, 0.28)); }
vec4 cellColor(vec2 id, float s) {
  vec2 cuv = (id + 0.5) * s / u_res;
  vec2 sp = vec2(s * 0.25) / u_res;
  vec4 c = (tex(cuv + sp) + tex(cuv - sp)) * 0.5;
  if (c.a < 0.5) return vec4(0.0);
  float l = clamp((luma(c.rgb / c.a) - 0.5) * (1.0 + contrast) + 0.5, 0.0, 1.0);
  // Four shades, like a reflective LCD.
  float v = clamp(floor(l * 3.0 + 0.5 + bayer4(id) * dither), 0.0, 3.0) / 3.0;
  return vec4(mix(darkest(), lightest(), v), 1.0);
}${BLOCKY}
vec4 effect(vec2 uv) {
  float s = max(size * u_px, 1.0);
  vec4 c = blocky(uv, s);
  // Fine gaps between the LCD cells, faded out when the cells get too small to show them.
  vec2 f = fract(uv * u_res / s);
  vec2 e = min(f, 1.0 - f) * s;
  float line = 1.0 - clamp(min(e.x, e.y) - max(s * 0.06, 0.5) + 0.5, 0.0, 1.0);
  c.rgb = mix(c.rgb, darkest() * c.a, line * grid * 0.45 * clamp(s / 3.0 - 1.0, 0.0, 1.0));
  return c;
}`,
  },
  {
    id: 'led-wall',
    name: 'LED Wall',
    category: 'retro',
    params: [
      { key: 'pitch', label: 'LED pitch', type: 'float', default: 16, min: 4, max: 120, step: 0.5, unit: 'px' },
      { key: 'dotSize', label: 'LED size', type: 'float', default: 0.8, min: 0.3, max: 1, step: 0.01 },
      { key: 'glow', label: 'Glow', type: 'float', default: 0.45, min: 0, max: 1, step: 0.01 },
      { key: 'gain', label: 'Brightness', type: 'float', default: 1.5, min: 0.5, max: 2.5, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 base = tex(uv);
  if (base.a <= 0.0) return base;
  float s = max(pitch, 2.0) * u_px;
  vec2 q = uv * u_res / s;
  vec2 id = floor(q);
  vec2 cuv = (id + 0.5) * s / u_res;
  vec2 sp = vec2(s * 0.25) / u_res;
  vec4 c = (tex(cuv + sp) + tex(cuv - sp) + tex(cuv + vec2(sp.x, -sp.y)) + tex(cuv + vec2(-sp.x, sp.y))) * 0.25;
  vec3 col = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  // Each cell is one round emitter with a soft halo on a dark panel.
  float d = length(q - id - 0.5) * 2.0;
  float aa = 2.0 / s;
  float core = 1.0 - smoothstep(dotSize - aa, dotSize + aa, d);
  float lit = core + exp(-d * d * 3.0) * glow * 0.6;
  // LEDs too small to resolve fade to the panel's average brightness.
  float avg = 0.785 * dotSize * dotSize + glow * 0.3;
  lit = mix(avg, lit, clamp(s * 0.5 - 1.0, 0.0, 1.0));
  vec3 rgb = min(vec3(0.015) + col * gain * lit, vec3(1.0));
  return vec4(rgb * base.a, base.a);
}`,
  },
  {
    id: 'night-vision',
    name: 'Night Vision',
    category: 'retro',
    animated: true,
    params: [
      AMOUNT,
      { key: 'gain', label: 'Gain', type: 'float', default: 1.8, min: 0.5, max: 4, step: 0.05 },
      { key: 'grain', label: 'Noise', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      { key: 'goggle', label: 'Goggle vignette', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      {
        key: 'phosphor',
        label: 'Phosphor',
        type: 'select',
        default: 0,
        options: [
          { label: 'Green', value: 0 },
          { label: 'White', value: 1 },
          { label: 'Amber', value: 2 },
        ],
      },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float tick = mod(floor(u_time * 30.0), 997.0);
  // An image intensifier: amplified luminance with a soft shoulder instead of hard clipping.
  float l = 1.0 - exp(-dot(rgb, vec3(0.4, 0.5, 0.1)) * gain * 1.6);
  vec2 p = uv * u_res / u_px;
  float n = vnoise(p / 1.5 + hash22(vec2(tick, 4.0)) * 300.0) + 0.5 * hash21(floor(p) + tick * vec2(3.1, 7.7)) - 0.75;
  l = clamp(l + n * grain * 0.5, 0.0, 1.0);
  vec3 ph = phosphor < 0.5 ? vec3(0.25, 1.0, 0.3) : (phosphor < 1.5 ? vec3(0.8, 0.95, 1.0) : vec3(1.0, 0.7, 0.2));
  vec3 nv = ph * l + vec3(0.5) * l * l * l * l;
  float period = 3.0 * u_px;
  nv *= 1.0 - 0.25 * mix(0.5, 0.5 + 0.5 * cos(uv.y * u_res.y / period * TAU), clamp(period * 0.5 - 1.0, 0.0, 1.0));
  // The round view through the tube.
  float r = length((uv - 0.5) * vec2(u_aspect, 1.0));
  float rim = mix(1.25, 0.5, goggle);
  nv *= (1.0 - smoothstep(rim - 0.16, rim, r)) * (1.0 - 0.35 * goggle * r * r);
  rgb = mix(rgb, clamp(nv, 0.0, 1.0), amount);
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'thermal',
    name: 'Thermal Camera',
    category: 'retro',
    params: [
      {
        key: 'palette',
        label: 'Palette',
        type: 'select',
        default: 0,
        options: [
          { label: 'Iron', value: 0 },
          { label: 'Rainbow', value: 1 },
          { label: 'White hot', value: 2 },
        ],
      },
      { key: 'softness', label: 'Softness', type: 'float', default: 6, min: 0, max: 30, step: 0.5, unit: 'px' },
      { key: 'range', label: 'Contrast', type: 'float', default: 1.3, min: 0.5, max: 3, step: 0.01 },
      AMOUNT,
    ],
    glsl: `
vec3 ramp(float t) {
  if (palette < 0.5) {
    vec3 c = mix(vec3(0.0, 0.0, 0.05), vec3(0.28, 0.0, 0.55), smoothstep(0.0, 0.25, t));
    c = mix(c, vec3(0.85, 0.1, 0.35), smoothstep(0.2, 0.5, t));
    c = mix(c, vec3(1.0, 0.55, 0.05), smoothstep(0.45, 0.72, t));
    c = mix(c, vec3(1.0, 0.92, 0.3), smoothstep(0.68, 0.88, t));
    return mix(c, vec3(1.0), smoothstep(0.86, 1.0, t));
  }
  if (palette < 1.5) {
    vec3 c = mix(vec3(0.05, 0.0, 0.35), vec3(0.0, 0.35, 1.0), smoothstep(0.0, 0.2, t));
    c = mix(c, vec3(0.0, 0.85, 0.85), smoothstep(0.18, 0.38, t));
    c = mix(c, vec3(0.1, 0.85, 0.15), smoothstep(0.36, 0.55, t));
    c = mix(c, vec3(1.0, 0.9, 0.1), smoothstep(0.52, 0.72, t));
    c = mix(c, vec3(0.95, 0.15, 0.1), smoothstep(0.7, 0.9, t));
    return mix(c, vec3(1.0, 0.92, 0.92), smoothstep(0.92, 1.0, t));
  }
  return vec3(t);
}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  // Thermal sensors are low resolution: read a softened picture.
  vec2 sp = vec2(softness * u_px) / u_res;
  vec4 s = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      s += tex(uv + vec2(float(i), float(j)) * sp * 0.7);
    }
  }
  vec3 soft = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  // Brightness stands in for heat; warm colours read a little hotter than cold ones.
  float heat = luma(soft) + (soft.r - soft.b) * 0.25;
  float t = clamp((heat - 0.5) * range + 0.5 + (hash21(gl_FragCoord.xy) - 0.5) / 128.0, 0.0, 1.0);
  vec3 rgb = mix(c.rgb / c.a, ramp(t), amount);
  return vec4(rgb * c.a, c.a);
}`,
  },
];

export default effects;
