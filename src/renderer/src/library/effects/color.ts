import type { EffectDef, ParamDef } from '../types';

const AMOUNT: ParamDef = { key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0, max: 1, step: 0.01 };

/** Gives a colour a new luminance while keeping its hue; out-of-range results are pulled back in. */
const SET_LUM = `
vec3 clipColor(vec3 c) {
  float l = luma(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 0.00001);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 0.00001);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - luma(c))); }`;

const effects: EffectDef[] = [
  {
    id: 'invert',
    name: 'Invert',
    category: 'color',
    params: [
      AMOUNT,
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 0,
        options: [
          { label: 'Full negative', value: 0 },
          { label: 'Lightness only', value: 1 },
        ],
      },
    ],
    glsl: `${SET_LUM}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // "Lightness only" flips dark and light but leaves every hue where it was.
  vec3 inv = mode < 0.5 ? 1.0 - rgb : setLum(rgb, 1.0 - luma(rgb));
  return vec4(mix(rgb, inv, amount) * c.a, c.a);
}`,
  },
  {
    id: 'hue-cycle',
    name: 'Hue Cycle',
    category: 'color',
    animated: true,
    params: [
      { key: 'speed', label: 'Speed', type: 'float', default: 90, min: -720, max: 720, step: 1, unit: '°/s' },
      { key: 'shift', label: 'Start hue', type: 'float', default: 0, min: -180, max: 180, step: 1, unit: '°' },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // Rotate the chroma in YIQ so brightness stays put while the colours go round.
  vec3 yiq = vec3(dot(rgb, vec3(0.299, 0.587, 0.114)), dot(rgb, vec3(0.596, -0.274, -0.322)), dot(rgb, vec3(0.211, -0.523, 0.312)));
  yiq.yz = rot2(radians(shift + mod(u_time * speed, 360.0))) * yiq.yz;
  vec3 res = vec3(yiq.x + 0.956 * yiq.y + 0.621 * yiq.z, yiq.x - 0.272 * yiq.y - 0.647 * yiq.z, yiq.x - 1.106 * yiq.y + 1.703 * yiq.z);
  return vec4(mix(rgb, clamp(res, 0.0, 1.0), amount) * c.a, c.a);
}`,
  },
  {
    id: 'colour-isolate',
    name: 'Colour Isolate',
    category: 'color',
    params: [
      { key: 'keep', label: 'Keep colour', type: 'color', default: '#e0262b' },
      { key: 'range', label: 'Range', type: 'float', default: 30, min: 1, max: 180, step: 1, unit: '°' },
      { key: 'softness', label: 'Softness', type: 'float', default: 20, min: 0, max: 90, step: 1, unit: '°' },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  vec3 hsv = rgb2hsv(rgb);
  // Distance around the hue wheel to the colour being kept, in degrees.
  float dh = abs(fract(hsv.x - rgb2hsv(keep).x + 0.5) - 0.5) * 360.0;
  float m = 1.0 - smoothstep(range, range + max(softness, 0.5), dh);
  // Near-greys have no dependable hue, so they fade out with everything else.
  m *= smoothstep(0.08, 0.25, hsv.y);
  vec3 res = mix(mix(rgb, vec3(luma(rgb)), amount), rgb, m);
  return vec4(res * c.a, c.a);
}`,
  },
  {
    id: 'colour-replace',
    name: 'Colour Replace',
    category: 'color',
    params: [
      { key: 'source', label: 'From', type: 'color', default: '#2a62d8' },
      { key: 'target', label: 'To', type: 'color', default: '#e03a8c' },
      { key: 'range', label: 'Range', type: 'float', default: 30, min: 1, max: 180, step: 1, unit: '°' },
      { key: 'softness', label: 'Softness', type: 'float', default: 20, min: 0, max: 90, step: 1, unit: '°' },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  vec3 hsv = rgb2hsv(rgb);
  vec3 src = rgb2hsv(source);
  vec3 dst = rgb2hsv(target);
  float dh = abs(fract(hsv.x - src.x + 0.5) - 0.5) * 360.0;
  float m = (1.0 - smoothstep(range, range + max(softness, 0.5), dh)) * smoothstep(0.08, 0.25, hsv.y) * amount;
  // Shift the hue by the difference between the two swatches and scale saturation and
  // brightness the same way, so shading and texture carry over to the new colour.
  vec3 o = vec3(
    fract(hsv.x + dst.x - src.x),
    clamp(hsv.y * dst.y / max(src.y, 0.05), 0.0, 1.0),
    clamp(hsv.z * mix(1.0, dst.z / max(src.z, 0.05), 0.5), 0.0, 1.0));
  return vec4(mix(rgb, hsv2rgb(o), m) * c.a, c.a);
}`,
  },
  {
    id: 'tint',
    name: 'Tint',
    category: 'color',
    params: [
      { key: 'color', label: 'Colour', type: 'color', default: '#ff9a3d' },
      { key: 'amount', label: 'Amount', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      {
        key: 'mode',
        label: 'Blend',
        type: 'select',
        default: 0,
        options: [
          { label: 'Colourise', value: 0 },
          { label: 'Multiply', value: 1 },
          { label: 'Screen', value: 2 },
          { label: 'Overlay', value: 3 },
        ],
      },
    ],
    glsl: `${SET_LUM}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  vec3 res;
  if (mode < 0.5) res = setLum(color, luma(rgb));
  else if (mode < 1.5) res = rgb * color;
  else if (mode < 2.5) res = 1.0 - (1.0 - rgb) * (1.0 - color);
  else res = mix(2.0 * rgb * color, 1.0 - 2.0 * (1.0 - rgb) * (1.0 - color), step(0.5, rgb));
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'gradient-map',
    name: 'Gradient Map',
    category: 'color',
    params: [
      { key: 'colorA', label: 'Shadows', type: 'color', default: '#0b1d51' },
      { key: 'colorB', label: 'Midtones', type: 'color', default: '#e94f64' },
      { key: 'colorC', label: 'Highlights', type: 'color', default: '#ffe9a8' },
      { key: 'midpoint', label: 'Midpoint', type: 'float', default: 0.5, min: 0.1, max: 0.9, step: 0.01 },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float l = luma(rgb);
  vec3 res = l < midpoint ? mix(colorA, colorB, l / midpoint) : mix(colorB, colorC, (l - midpoint) / (1.0 - midpoint));
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'black-and-white',
    name: 'Black & White',
    category: 'color',
    params: [
      { key: 'lens', label: 'Lens filter', type: 'color', default: '#ff8a1f' },
      { key: 'strength', label: 'Filter strength', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'contrast', label: 'Contrast', type: 'float', default: 0.15, min: -0.5, max: 1, step: 0.01 },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // Like a coloured filter in front of black and white film: colours close to the filter come
  // out lighter, their opposites darker (an orange or red filter deepens blue skies).
  vec3 w = mix(vec3(0.2126, 0.7152, 0.0722), lens / max(lens.r + lens.g + lens.b, 0.001), strength);
  float l = clamp((dot(rgb, w) - 0.5) * (1.0 + contrast) + 0.5, 0.0, 1.0);
  return vec4(mix(rgb, vec3(l), amount) * c.a, c.a);
}`,
  },
  {
    id: 'solarize',
    name: 'Solarize',
    category: 'color',
    params: [
      { key: 'threshold', label: 'Threshold', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'softness', label: 'Softness', type: 'float', default: 0.12, min: 0.005, max: 0.5, step: 0.005 },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // Tones above the threshold tip over into their negative, as on over-exposed film.
  float w = max(softness, 0.005);
  vec3 res = mix(rgb, 1.0 - rgb, smoothstep(threshold - w, threshold + w, rgb));
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'channel-swap',
    name: 'Channel Swap',
    category: 'color',
    params: [
      {
        key: 'order',
        label: 'Channels',
        type: 'select',
        default: 0,
        options: [
          { label: 'Green · Blue · Red', value: 0 },
          { label: 'Blue · Red · Green', value: 1 },
          { label: 'Red · Blue · Green', value: 2 },
          { label: 'Blue · Green · Red', value: 3 },
          { label: 'Green · Red · Blue', value: 4 },
        ],
      },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  vec3 res = order < 0.5 ? rgb.gbr : (order < 1.5 ? rgb.brg : (order < 2.5 ? rgb.rbg : (order < 3.5 ? rgb.bgr : rgb.grb)));
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    category: 'color',
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.8, min: 0, max: 1, step: 0.01 },
      { key: 'desat', label: 'Desaturation', type: 'float', default: 0.45, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // Skipping the bleach leaves the silver image in the print: a black and white copy
  // overlaid on the colour, which hardens contrast and mutes the colours.
  float l = luma(rgb);
  vec3 ov = mix(2.0 * rgb * l, 1.0 - 2.0 * (1.0 - rgb) * (1.0 - l), step(0.5, rgb));
  ov = mix(ov, vec3(luma(ov)), desat * 0.6);
  return vec4(mix(rgb, ov, amount) * c.a, c.a);
}`,
  },
  {
    id: 'cross-process',
    name: 'Cross Process',
    category: 'color',
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.8, min: 0, max: 1, step: 0.01 },
      {
        key: 'style',
        label: 'Cast',
        type: 'select',
        default: 0,
        options: [
          { label: 'Yellow highlights, blue shadows', value: 0 },
          { label: 'Cyan highlights, red shadows', value: 1 },
        ],
      },
      { key: 'vivid', label: 'Colour boost', type: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // Each channel gets its own curve: some are pushed into a hard S, one is flattened so it
  // lingers in the shadows and gives way in the highlights.
  vec3 s = rgb * rgb * (3.0 - 2.0 * rgb);
  vec3 x = style < 0.5
    ? vec3(mix(rgb.r, s.r, 0.9), mix(rgb.g, s.g, 0.6) * 1.04, mix(rgb.b, 0.22 + 0.5 * rgb.b, 0.8))
    : vec3(mix(rgb.r, 0.2 + 0.55 * rgb.r, 0.8), mix(rgb.g, s.g, 0.8), mix(rgb.b, s.b, 0.7) * 1.05);
  x = clamp(mix(vec3(luma(x)), x, 1.0 + vivid * 0.5), 0.0, 1.0);
  return vec4(mix(rgb, x, amount) * c.a, c.a);
}`,
  },
  {
    id: 'infrared',
    name: 'Infrared',
    category: 'color',
    params: [
      AMOUNT,
      {
        key: 'style',
        label: 'Film',
        type: 'select',
        default: 0,
        options: [
          { label: 'False colour', value: 0 },
          { label: 'Black & white', value: 1 },
        ],
      },
      { key: 'foliage', label: 'Foliage glow', type: 'float', default: 0.9, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // Foliage reflects infrared strongly while clear sky and water swallow it.
  float veg = smoothstep(0.02, 0.22, rgb.g - max(rgb.r, rgb.b)) * foliage;
  float sky = smoothstep(0.02, 0.25, rgb.b - max(rgb.r, rgb.g));
  float l = luma(rgb);
  vec3 res;
  if (style < 0.5) {
    // False colour: greenery glows pink-red, skies sink into deep teal.
    res = mix(rgb, min(vec3(0.95, 0.25, 0.42) * (0.45 + 1.2 * l), vec3(1.0)), veg);
    res = mix(res, res * vec3(0.5, 0.8, 1.0), sky * 0.7);
  } else {
    // Monochrome: snow-white foliage under a near-black sky.
    float ir = clamp(l + veg * 0.55 - sky * 0.45, 0.0, 1.0);
    res = vec3(ir * ir * (3.0 - 2.0 * ir));
  }
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'colour-pulse',
    name: 'Colour Pulse',
    category: 'color',
    animated: true,
    params: [
      { key: 'amount', label: 'Pulse', type: 'float', default: 0.9, min: 0, max: 2, step: 0.01 },
      { key: 'tempo', label: 'Tempo', type: 'float', default: 120, min: 30, max: 240, step: 1, unit: 'BPM' },
      { key: 'snap', label: 'Snap', type: 'float', default: 4, min: 0.5, max: 12, step: 0.1 },
      { key: 'offset', label: 'Beat offset', type: 'float', default: 0, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // On every beat the colours jump and then settle back.
  float env = exp(-fract(u_time * tempo / 60.0 - offset) * snap);
  float k = amount * env;
  float l = luma(rgb);
  // Vibrance-style boost: muted colours gain the most, saturated ones are protected.
  float sat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
  rgb = mix(vec3(l), rgb, 1.0 + k * (1.0 - 0.5 * sat));
  rgb *= 1.0 + 0.08 * k;
  return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a);
}`,
  },
  {
    id: 'rainbow-wash',
    name: 'Rainbow Wash',
    category: 'color',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.65, min: 0, max: 1, step: 0.01 },
      { key: 'angle', label: 'Angle', type: 'float', default: 30, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'scale', label: 'Band width', type: 'float', default: 1100, min: 100, max: 4000, step: 10, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 0.2, min: -2, max: 2, step: 0.01 },
      {
        key: 'blend',
        label: 'Blend',
        type: 'select',
        default: 0,
        options: [
          { label: 'Soft light', value: 0 },
          { label: 'Screen', value: 1 },
          { label: 'Colour', value: 2 },
        ],
      },
    ],
    glsl: `${SET_LUM}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float a = radians(angle);
  float h = dot(uv * u_res / u_px, vec2(cos(a), sin(a))) / max(scale, 10.0) - fract(u_time * speed);
  // A cosine palette gives a rainbow without the hard corners of an HSV sweep.
  vec3 col = 0.5 + 0.5 * cos(TAU * (h + vec3(0.0, 0.33, 0.67)));
  vec3 res;
  if (blend < 0.5) res = (1.0 - 2.0 * col) * rgb * rgb + 2.0 * col * rgb;
  else if (blend < 1.5) res = 1.0 - (1.0 - rgb) * (1.0 - col * 0.7);
  else res = setLum(col, luma(rgb));
  return vec4(mix(rgb, clamp(res, 0.0, 1.0), amount) * c.a, c.a);
}`,
  },
  {
    id: 'psychedelic',
    name: 'Psychedelic',
    category: 'color',
    animated: true,
    params: [
      AMOUNT,
      { key: 'cycles', label: 'Colour bands', type: 'float', default: 2, min: 0.5, max: 8, step: 0.1 },
      { key: 'speed', label: 'Speed', type: 'float', default: 0.3, min: -3, max: 3, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // Brightness picks the place on a rainbow that keeps turning; the original colour nudges it
  // so that neighbouring objects do not all land on the same hue.
  float l = luma(rgb);
  float h = l * cycles + (rgb.r - rgb.b) * 0.35 + fract(u_time * speed);
  vec3 col = 0.5 + 0.5 * cos(TAU * (h + vec3(0.0, 0.33, 0.67)));
  col *= 0.45 + 0.55 * smoothstep(0.0, 0.6, l);
  return vec4(mix(rgb, col, amount) * c.a, c.a);
}`,
  },
];

export default effects;
