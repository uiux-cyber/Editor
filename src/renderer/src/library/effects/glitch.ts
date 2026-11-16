import type { EffectDef } from '../types';

const effects: EffectDef[] = [
  {
    id: 'digital-glitch',
    name: 'Digital Glitch',
    category: 'glitch',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'size', label: 'Block size', type: 'float', default: 60, min: 8, max: 300, step: 1, unit: 'px' },
      { key: 'shift', label: 'Displacement', type: 'float', default: 90, min: 0, max: 400, step: 1, unit: 'px' },
      { key: 'split', label: 'Colour split', type: 'float', default: 10, min: 0, max: 60, step: 0.5, unit: 'px' },
      { key: 'rate', label: 'Rate', type: 'float', default: 12, min: 1, max: 30, step: 1, unit: 'Hz' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float tick = mod(floor(u_time * rate), 1024.0);
  // Glitches arrive in bursts; a higher amount leaves fewer quiet moments.
  float burst = step(0.6 - 0.6 * amount, hash11(tick * 1.37 + 5.0));
  vec2 p = uv * u_res / u_px;
  float sx = 0.0;
  float hit = 0.0;
  // Three layers of blocks, each half the size of the one before.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 cell = vec2(size * 5.0, size) / exp2(fi);
    vec2 seed = floor(p / cell) + vec2(tick * 3.17 + fi * 31.7, tick * 1.93);
    float on = step(1.0 - amount * 0.3, hash21(seed));
    sx += on * (hash21(seed + 91.7) * 2.0 - 1.0);
    hit = max(hit, on);
  }
  vec2 off = vec2(sx * burst * shift * u_px / u_res.x, 0.0);
  vec2 ca = vec2(split * u_px / u_res.x * hit * burst, 0.0);
  vec4 r = texM(uv + off + ca);
  vec4 g = texM(uv + off);
  vec4 b = texM(uv + off - ca);
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,
  },
  {
    id: 'scanline-jitter',
    name: 'Scanline Jitter',
    category: 'glitch',
    animated: true,
    params: [
      { key: 'amount', label: 'Jitter', type: 'float', default: 14, min: 0, max: 120, step: 0.5, unit: 'px' },
      { key: 'thickness', label: 'Line height', type: 'float', default: 3, min: 1, max: 40, step: 0.5, unit: 'px' },
      { key: 'tearing', label: 'Tearing', type: 'float', default: 0.25, min: 0, max: 1, step: 0.01 },
      { key: 'rate', label: 'Rate', type: 'float', default: 24, min: 1, max: 60, step: 1, unit: 'Hz' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float line = floor(uv.y * u_res.y / max(thickness * u_px, 1.0));
  float tick = mod(floor(u_time * rate), 1024.0);
  // Most lines move a little; a few tear far out of place.
  float n = hash21(vec2(line, tick)) * 2.0 - 1.0;
  float big = step(1.0 - tearing * 0.2, hash21(vec2(line * 0.37 + 5.0, tick + 13.0)));
  float dx = n * abs(n) * (1.0 + big * 5.0) * amount * u_px / u_res.x;
  return texM(uv + vec2(dx, 0.0));
}`,
  },
  {
    id: 'screen-tear',
    name: 'Screen Tear',
    category: 'glitch',
    animated: true,
    params: [
      { key: 'amount', label: 'Offset', type: 'float', default: 60, min: 0, max: 400, step: 1, unit: 'px' },
      { key: 'tears', label: 'Tears', type: 'int', default: 2, min: 1, max: 3, step: 1 },
      { key: 'rate', label: 'Rate', type: 'float', default: 6, min: 0.5, max: 30, step: 0.5, unit: 'Hz' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float tick = mod(floor(u_time * rate), 1024.0);
  float dx = 0.0;
  float seam = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float on = step(fi + 0.5, tears);
    float y0 = hash21(vec2(tick, fi * 17.0 + 3.0));
    float s = hash21(vec2(tick + 31.0, fi * 5.0 + 1.0)) * 2.0 - 1.0;
    // Everything below a tear slides sideways, and the first lines under it shear even further.
    float below = (uv.y - y0) * u_res.y / u_px;
    float side = step(0.0, below);
    dx += on * side * s * (0.5 + 1.5 * exp(-below / 14.0));
    seam += on * (1.0 - smoothstep(0.0, 2.5, abs(below)));
  }
  vec4 c = texM(uv + vec2(dx * amount * u_px / u_res.x, 0.0));
  // A thin line of static marks each seam.
  float n = hash21(vec2(floor(uv.x * u_res.x / (u_px * 4.0)), tick));
  c.rgb = mix(c.rgb, vec3(n) * c.a, min(seam, 1.0) * 0.6);
  return c;
}`,
  },
  {
    id: 'chromatic-aberration',
    name: 'Chromatic Aberration',
    category: 'glitch',
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 14, min: 0, max: 100, step: 0.5, unit: 'px' },
      { key: 'falloff', label: 'Edge falloff', type: 'float', default: 1.5, min: 0, max: 4, step: 0.05 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float amt = amount * u_px;
  if (amt < 0.01) return tex(uv);
  vec2 d = (uv - 0.5) * u_res;
  float r = length(d);
  vec2 dir = r > 0.0 ? d / r : vec2(0.0);
  // The fringe grows from nothing at the centre to the full amount in the corners.
  vec2 off = dir * amt * pow(r / (0.5 * length(u_res)), falloff) / u_res;
  // Nine taps across the spectrum give a smooth rainbow fringe instead of three hard ghosts.
  vec4 acc = vec4(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float t = float(i) / 8.0;
    vec3 w = vec3(max(1.0 - 2.0 * t, 0.0), 1.0 - abs(2.0 * t - 1.0), max(2.0 * t - 1.0, 0.0));
    vec4 s = tex(uv + off * (t * 2.0 - 1.0));
    acc.rgb += s.rgb * w;
    acc.a += s.a * w.g;
    wsum += w;
  }
  vec3 rgb = acc.rgb / wsum;
  return vec4(rgb, max(acc.a / wsum.g, max(rgb.r, rgb.b)));
}`,
  },
  {
    id: 'noise-bars',
    name: 'Noise Bars',
    category: 'glitch',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.8, min: 0, max: 1, step: 0.01 },
      { key: 'barSize', label: 'Bar height', type: 'float', default: 50, min: 6, max: 400, step: 1, unit: 'px' },
      { key: 'density', label: 'Density', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      { key: 'speed', label: 'Speed', type: 'float', default: 1, min: -4, max: 4, step: 0.05 },
      { key: 'tinted', label: 'Colour noise', type: 'bool', default: false },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float y = uv.y * u_res.y / u_px;
  float tick = mod(floor(u_time * 30.0), 997.0);
  // Bars drift through the frame and flicker in and out.
  float band = vnoise(vec2(y / max(barSize, 2.0) - u_time * speed * 3.0, floor(u_time * 6.0) * 0.37));
  float bars = smoothstep(1.0 - density, 1.08 - density, band) * step(0.001, density);
  vec2 g = floor(vec2(uv.x * u_res.x / (u_px * 5.0), y / 2.0));
  vec2 seed = g + tick * vec2(7.3, 3.1);
  float n = hash21(seed);
  // Inside a bar the picture is shredded sideways and buried in static.
  vec4 c = texM(uv + vec2((n - 0.5) * bars * amount * 24.0 * u_px / u_res.x, 0.0));
  vec3 nz = tinted > 0.5 ? vec3(n, hash21(seed + 41.3), hash21(seed + 97.1)) : vec3(n);
  c.rgb = mix(c.rgb, nz * c.a, bars * amount);
  return c;
}`,
  },
  {
    id: 'signal-loss',
    name: 'Signal Loss',
    category: 'glitch',
    animated: true,
    params: [
      { key: 'intensity', label: 'Intensity', type: 'float', default: 0.65, min: 0, max: 1, step: 0.01 },
      { key: 'rate', label: 'Rate', type: 'float', default: 1.5, min: 0.1, max: 8, step: 0.1, unit: 'Hz' },
      { key: 'wobble', label: 'Sync wobble', type: 'float', default: 70, min: 0, max: 300, step: 1, unit: 'px' },
      { key: 'snow', label: 'Static', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (intensity <= 0.0) return tex(uv);
  // The signal drops out in bursts: e is 0 while it holds and rises to 1 as it breaks up.
  float e = smoothstep(1.0 - intensity, 1.0 - intensity * 0.75, vnoise(vec2(u_time * rate, 7.0)));
  if (e <= 0.0) return tex(uv);
  float tick = mod(floor(u_time * 30.0), 997.0);
  float y = uv.y * u_res.y / u_px;
  // Horizontal hold slips in slow waves plus per-line noise, and the frame rolls a little.
  float lineN = hash21(vec2(floor(y / 3.0), tick)) - 0.5;
  float sway = sin(y * 0.021 + u_time * 9.0) * 0.6 + sin(y * 0.0053 - u_time * 5.0);
  float dx = (sway * 0.5 + lineN * 0.35) * wobble * e * u_px / u_res.x;
  vec4 c = texM(vec2(uv.x + dx, uv.y + e * e * 0.06 * sin(u_time * 13.0)));
  // Colour drops out, static takes over and a few lines blank to white.
  c.rgb = mix(c.rgb, vec3(luma(c.rgb)), e * 0.85);
  float s = hash21(floor(uv * u_res / (u_px * 3.0)) + tick * vec2(13.1, 71.7));
  c.rgb = mix(c.rgb, vec3(s) * c.a, snow * e * 0.8);
  float drop = step(0.985, hash21(vec2(floor(y / 4.0), tick + 3.0))) * e;
  c.rgb = mix(c.rgb, vec3(c.a) * 0.95, drop * 0.8);
  return c;
}`,
  },
  {
    id: 'bad-tv',
    name: 'Bad TV',
    category: 'glitch',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
      { key: 'distortion', label: 'Distortion', type: 'float', default: 30, min: 0, max: 200, step: 1, unit: 'px' },
      { key: 'roll', label: 'Vertical roll', type: 'float', default: 0.15, min: -2, max: 2, step: 0.01 },
      { key: 'snow', label: 'Static', type: 'float', default: 0.25, min: 0, max: 1, step: 0.01 },
      { key: 'fringe', label: 'Colour fringe', type: 'float', default: 6, min: 0, max: 40, step: 0.5, unit: 'px' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float t = u_time;
  // Vertical hold: the picture rolls and a dark blanking bar travels with the seam.
  float y = fract(uv.y + fract(t * roll) * amount);
  float seamD = min(y, 1.0 - y) * u_res.y / u_px;
  float bar = (1.0 - smoothstep(6.0, 18.0, seamD)) * step(0.0005, abs(roll)) * amount;
  // Horizontal hold: two beating waves, a thick bend that wanders, and fine line jitter.
  float yd = y * u_res.y / u_px;
  float tick = mod(floor(t * 30.0), 997.0);
  float wob = sin(yd * 0.035 + t * 4.0) * sin(yd * 0.011 - t * 1.3);
  float bend = exp(-pow((y - fract(t * 0.17 + 0.3)) * 9.0, 2.0)) * sin(t * 21.0 + yd * 0.2);
  float jit = (hash21(vec2(floor(yd / 2.0), tick)) - 0.5) * 0.25;
  float dx = (wob * 0.6 + bend * 1.6 + jit) * distortion * amount * u_px / u_res.x;
  vec2 fr = vec2(fringe * amount * u_px / u_res.x, 0.0);
  vec4 r = texM(vec2(uv.x + dx, y) + fr);
  vec4 g = texM(vec2(uv.x + dx, y));
  vec4 b = texM(vec2(uv.x + dx, y) - fr);
  vec4 c = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  float s = hash21(floor(uv * u_res / (u_px * 2.5)) + tick * vec2(13.1, 71.7));
  c.rgb = clamp(c.rgb + (s - 0.5) * snow * amount * c.a, vec3(0.0), vec3(c.a));
  c.rgb *= 1.0 - bar * 0.85;
  return c;
}`,
  },
  {
    id: 'pixel-drift',
    name: 'Pixel Drift',
    category: 'glitch',
    params: [
      { key: 'dist', label: 'Length', type: 'float', default: 160, min: 0, max: 400, step: 1, unit: 'px' },
      { key: 'angle', label: 'Angle', type: 'float', default: 90, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'threshold', label: 'Threshold', type: 'float', default: 0.55, min: 0, max: 0.98, step: 0.01 },
      { key: 'fade', label: 'Fade', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float len = dist * u_px;
  vec4 c0 = tex(uv);
  if (len < 0.5) return c0;
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a)) / u_res;
  // Bright pixels smear along the angle; the brighter they are, the further they travel.
  vec4 best = c0;
  float bestL = -1.0;
  float bestT = 0.0;
  float span = max(1.0 - threshold, 0.001);
  for (int i = 1; i <= 40; i++) {
    float t = float(i) / 40.0;
    vec4 s = tex(uv - dir * len * t);
    float l = luma(s.rgb);
    float reach = (l - threshold) / span;
    if (reach >= t && l > bestL) {
      best = s;
      bestL = l;
      bestT = t / max(reach, 0.001);
    }
  }
  if (bestL < 0.0) return c0;
  return mix(c0, best, clamp(1.0 - fade * bestT, 0.0, 1.0));
}`,
  },
  {
    id: 'interlace',
    name: 'Interlace',
    category: 'glitch',
    params: [
      { key: 'amount', label: 'Field offset', type: 'float', default: 6, min: 0, max: 60, step: 0.5, unit: 'px' },
      { key: 'thickness', label: 'Line height', type: 'float', default: 3, min: 1, max: 30, step: 0.5, unit: 'px' },
      { key: 'darkness', label: 'Line darkening', type: 'float', default: 0.25, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  // Alternate lines belong to two fields that are pulled apart horizontally. The line pattern
  // is band-limited: lines too thin to resolve blend into an even double image.
  float lineH = max(thickness, 0.5) * u_px;
  float d = abs(fract(uv.y * u_res.y / (2.0 * lineH)) - 0.5);
  float w = min(0.25 / lineH, 0.25);
  float f = mix(0.5, smoothstep(0.25 - w, 0.25 + w, d), clamp(lineH - 1.0, 0.0, 1.0));
  vec2 off = vec2(amount * u_px / u_res.x, 0.0);
  vec4 c = mix(texM(uv - off), texM(uv + off), f);
  c.rgb *= 1.0 - darkness * f * 0.7;
  return c;
}`,
  },
  {
    id: 'tv-static',
    name: 'TV Static',
    category: 'glitch',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
      { key: 'grain', label: 'Grain size', type: 'float', default: 3, min: 1, max: 20, step: 0.5, unit: 'px' },
      { key: 'flicker', label: 'Flicker', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      { key: 'tinted', label: 'Colour noise', type: 'bool', default: false },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  float tick = mod(floor(u_time * 30.0), 997.0);
  vec2 seed = floor(uv * u_res / (u_px * max(grain, 0.5))) + tick * vec2(13.1, 71.7);
  float n = hash21(seed);
  vec3 nz = tinted > 0.5 ? vec3(n, hash21(seed + 41.3), hash21(seed + 97.1)) : vec3(n);
  // Slow horizontal banding and frame-to-frame flicker make the static breathe like a detuned set.
  float band = 0.8 + 0.2 * sin(uv.y * 9.0 + u_time * 7.0);
  float k = amount * band * (1.0 - flicker * 0.5 * hash11(tick + 3.0));
  vec3 rgb = mix(c.rgb / c.a, nz, k);
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'hologram',
    name: 'Hologram',
    category: 'glitch',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
      { key: 'tint', label: 'Colour', type: 'color', default: '#3fd8ff' },
      { key: 'lines', label: 'Scanline pitch', type: 'float', default: 5, min: 2, max: 30, step: 0.5, unit: 'px' },
      { key: 'flicker', label: 'Flicker', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'translucency', label: 'Translucency', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 base = tex(uv);
  if (amount <= 0.0) return base;
  float tick = mod(floor(u_time * 24.0), 997.0);
  float yd = uv.y * u_res.y / u_px;
  // Now and then a band of lines slips sideways.
  float band = floor(yd / 14.0);
  float slip = step(0.94, hash21(vec2(band, tick))) * (hash21(vec2(band + 7.0, tick)) - 0.5);
  vec4 c = texM(uv + vec2(slip * flicker * 60.0 * u_px / u_res.x, 0.0));
  if (c.a <= 0.0) return mix(base, c, amount);
  float l = luma(c.rgb / c.a);
  // Projected light: tinted luminance with a hot white core.
  vec3 holo = tint * (0.25 + 1.1 * l) + vec3(0.6) * l * l * l;
  float period = max(lines, 1.0) * u_px;
  float scan = mix(0.5, 0.5 + 0.5 * cos(uv.y * u_res.y / period * TAU), clamp(period * 0.5 - 1.0, 0.0, 1.0));
  float sweep = exp(-pow((fract(uv.y + u_time * 0.25) - 0.5) * 8.0, 2.0));
  float fl = 1.0 - flicker * (0.25 * hash11(tick) + 0.08 * sin(u_time * 50.0));
  holo = holo * (0.72 + 0.28 * scan) * fl + tint * sweep * 0.18;
  // The scanlines also thin the picture out, so whatever is underneath shows through.
  float alpha = c.a * mix(1.0, (0.5 + 0.5 * scan) * fl, translucency);
  return mix(base, vec4(clamp(holo, 0.0, 1.0) * alpha, alpha), amount);
}`,
  },
];

export default effects;
