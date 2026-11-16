import type { TransitionDef } from '../types';

const LIGHT_LIB = `
float ign() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
vec2 discTap(int i, int n, float rot) {
  float r = sqrt((float(i) + 0.5) / float(n));
  float a = float(i) * 2.39996323 + rot;
  return r * vec2(cos(a), sin(a));
}
// Add light the way film does: never clips harshly, never exceeds the pixel's own alpha.
vec3 screenAdd(vec3 base, vec3 light, float alpha) {
  vec3 l = clamp(light, 0.0, 1.0);
  return alpha - (alpha - base) * (1.0 - l);
}`;

const transitions: TransitionDef[] = [
  {
    id: 'flash',
    name: 'Flash',
    category: 'light',
    duration: 0.5,
    params: [
      { key: 'flashColor', label: 'Color', type: 'color', default: '#ffffff' },
      { key: 'intensity', label: 'Intensity', type: 'float', default: 1, min: 0.2, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec4 c = mix(getFromColor(uv), getToColor(uv), smoothstep(0.42, 0.58, progress));
  float f = max(1.0 - abs(2.0 * progress - 1.0), 0.0);
  // Exposure climbs first (highlights blow out), then the whole frame washes to the flash colour.
  vec3 over = c.rgb * (1.0 + 4.0 * f * f * f * intensity);
  float wash = smoothstep(0.5, 1.0, f) * intensity;
  vec4 lit = vec4(min(over, vec3(c.a)), c.a);
  return mix(lit, vec4(flashColor, 1.0), wash);
}`,
  },
  {
    id: 'glow-dissolve',
    name: 'Glow Dissolve',
    category: 'light',
    duration: 1.0,
    params: [
      { key: 'intensity', label: 'Glow', type: 'float', default: 1, min: 0, max: 2.5, step: 0.05 },
      { key: 'radius', label: 'Radius', type: 'float', default: 0.06, min: 0.01, max: 0.15, step: 0.005 },
      { key: 'threshold', label: 'Threshold', type: 'float', default: 0.55, min: 0, max: 0.95, step: 0.01 },
    ],
    glsl: `${LIGHT_LIB}
vec4 transition(vec2 uv) {
  float k = max(sin(progress * PI), 0.0);
  float m = progress * progress * (3.0 - 2.0 * progress);
  vec4 base = mix(getFromColor(uv), getToColor(uv), m);
  float rot = ign() * TAU;
  vec3 bloom = vec3(0.0);
  vec3 soft = vec3(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    vec2 o = discTap(i, N, rot) * radius;
    vec2 q = uv + vec2(o.x / ratio, o.y);
    vec4 s = mix(getFromColor(q), getToColor(q), m);
    bloom += s.rgb * smoothstep(threshold - 0.15, threshold + 0.3, luma(s.rgb));
    soft += s.rgb;
  }
  bloom /= float(N);
  soft /= float(N);
  // Highlights bloom and the picture softens slightly, like a diffusion filter.
  vec3 c = mix(base.rgb, soft, 0.45 * k);
  c = screenAdd(c, bloom * 1.6 * intensity * k, base.a);
  return vec4(c, base.a);
}`,
  },
  {
    id: 'light-leak',
    name: 'Light Leak',
    category: 'light',
    duration: 1.0,
    params: [
      { key: 'colorA', label: 'Core Color', type: 'color', default: '#ffc15e' },
      { key: 'colorB', label: 'Edge Color', type: 'color', default: '#ff4f6d' },
      { key: 'angle', label: 'Angle', type: 'float', default: 15, min: 0, max: 360, step: 1, unit: '°' },
      { key: 'intensity', label: 'Intensity', type: 'float', default: 1, min: 0.1, max: 2, step: 0.05 },
    ],
    glsl: `${LIGHT_LIB}
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float extent = abs(dir.x) * ratio + abs(dir.y);
  float x = dot(p, dir) / extent + 0.5;
  float y = dot(p, vec2(-dir.y, dir.x));
  // An uneven band of light drifts across; the incoming picture is left in its wake.
  float pos = mix(-0.75, 1.75, progress);
  float wob = (fbm(vec2(y * 1.4 + 2.0, progress * 1.3)) - 0.5) * 0.5;
  float d = x - pos + wob;
  float reveal = 1.0 - smoothstep(-0.3, 0.3, d);
  vec4 c = mix(getFromColor(uv), getToColor(uv), reveal);
  float tex = fbm(vec2(x * 1.1 - progress * 1.6, y * 2.4 + 5.0));
  float env = smoothstep(0.0, 0.15, progress) * (1.0 - smoothstep(0.85, 1.0, progress));
  float band = exp(-d * d / 0.16);
  float amt = band * (0.5 + 0.9 * tex) * intensity * env;
  vec3 leak = mix(colorA, colorB, smoothstep(-0.25, 0.4, abs(d) + (tex - 0.5) * 0.5));
  c.rgb = screenAdd(c.rgb, leak * amt, c.a);
  // The hottest part of the leak washes out towards white.
  c.rgb = screenAdd(c.rgb, vec3(1.0, 0.95, 0.85) * amt * amt * 0.45, c.a);
  return c;
}`,
  },
  {
    id: 'flare-sweep',
    name: 'Flare Sweep',
    category: 'light',
    duration: 0.9,
    params: [
      { key: 'flareColor', label: 'Color', type: 'color', default: '#8fc7ff' },
      { key: 'height', label: 'Height', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 0,
        options: [
          { label: 'Left to Right', value: 0 },
          { label: 'Right to Left', value: 1 },
        ],
      },
      { key: 'intensity', label: 'Intensity', type: 'float', default: 1, min: 0.1, max: 2, step: 0.05 },
    ],
    glsl: `${LIGHT_LIB}
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  float ux = direction < 0.5 ? uv.x : 1.0 - uv.x;
  float e = progress * progress * (3.0 - 2.0 * progress);
  float fx = mix(-0.25, 1.25, e);
  // The cut hides behind the brightest part of the flare.
  float keep = smoothstep(fx - 0.12, fx + 0.12, ux);
  vec4 c = mix(getToColor(uv), getFromColor(uv), keep);
  // 'height' is measured from the top of the frame.
  vec2 d = vec2((ux - fx) * ratio, uv.y - (1.0 - height));
  float r = length(d);
  float core = exp(-r * r / 0.0035);
  float halo = exp(-r * r / 0.07) * 0.4;
  // Anamorphic streak: long and thin, plus a faint ring and two lens ghosts.
  float streak = exp(-d.y * d.y / 0.00012) / (1.0 + d.x * d.x * 5.0);
  float wide = exp(-d.y * d.y / 0.004) / (1.0 + d.x * d.x * 14.0) * 0.35;
  float ring = exp(-(r - 0.2) * (r - 0.2) / 0.0005) * 0.1;
  vec2 mirror = vec2((0.5 - fx) * ratio, height - 0.5);
  vec2 g1 = d - mirror * 1.5;
  vec2 g2 = d - mirror * 2.4;
  float ghosts = exp(-dot(g1, g1) / 0.004) * 0.12 + exp(-dot(g2, g2) / 0.012) * 0.07;
  float env = smoothstep(0.0, 0.2, progress) * (1.0 - smoothstep(0.8, 1.0, progress)) * intensity;
  vec3 tinted = flareColor * (streak * 0.8 + wide + halo + ring + ghosts);
  vec3 white = vec3(core + streak * 0.5);
  c.rgb = screenAdd(c.rgb, (tinted + white) * env, c.a);
  return c;
}`,
  },
  {
    id: 'shine-wipe',
    name: 'Shine Wipe',
    category: 'light',
    duration: 0.8,
    params: [
      { key: 'angle', label: 'Angle', type: 'float', default: 20, min: 0, max: 360, step: 1, unit: '°' },
      { key: 'width', label: 'Shine Width', type: 'float', default: 0.12, min: 0.02, max: 0.5, step: 0.005 },
      { key: 'shineColor', label: 'Color', type: 'color', default: '#ffffff' },
      { key: 'intensity', label: 'Intensity', type: 'float', default: 1, min: 0, max: 2, step: 0.05 },
    ],
    glsl: `${LIGHT_LIB}
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float extent = 0.5 * (abs(dir.x) * ratio + abs(dir.y));
  float d = dot(p, dir);
  float w = max(width, 0.02);
  float e = progress * progress * (3.0 - 2.0 * progress);
  float edge = mix(-extent - 3.2 * w, extent + 3.2 * w, e);
  float x = (d - edge) / w;
  float s = max(0.12 * w, fwidth(d));
  float keep = smoothstep(-s, s, d - edge);
  vec4 c = mix(getToColor(uv), getFromColor(uv), keep);
  // A glossy band rides on the wipe edge: broad sheen, tight core and a thin trailing line.
  float sheen = exp(-x * x * 2.0) * 0.5;
  float core = exp(-x * x * 45.0) * 0.9;
  float trail = exp(-(x + 1.5) * (x + 1.5) * 9.0) * 0.3;
  c.rgb = screenAdd(c.rgb, shineColor * (sheen + core + trail) * intensity, c.a);
  return c;
}`,
  },
  {
    id: 'film-burn',
    name: 'Film Burn',
    category: 'light',
    duration: 1.1,
    params: [
      { key: 'burnColor', label: 'Ember Color', type: 'color', default: '#ff7a1a' },
      { key: 'detail', label: 'Detail', type: 'float', default: 2.4, min: 0.5, max: 8, step: 0.1 },
      { key: 'glow', label: 'Glow Width', type: 'float', default: 0.14, min: 0.03, max: 0.4, step: 0.005 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float n = fbm(p * detail + 7.3) * 0.72 + fbm(p * detail * 3.3 + 21.0) * 0.28;
  float v = clamp((n - 0.22) / 0.56, -0.15, 1.15);
  float w = max(glow, 0.03);
  float aa = max(fwidth(v), 1e-4);
  float edge = mix(-0.15 - w - aa, 1.15 + w + aa, progress);
  // d > 0: film still intact; d < 0: burnt through to the incoming picture.
  float d = v - edge;
  float burned = 1.0 - smoothstep(-aa, aa, d);
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  float ahead = clamp(d / w, 0.0, 1.0);
  float charred = (1.0 - ahead) * (1.0 - ahead);
  a.rgb *= 1.0 - 0.9 * charred;
  vec4 c = mix(a, b, burned);
  float ember = pow(1.0 - ahead, 5.0) * (1.0 - burned);
  float behind = clamp(-d / (w * 0.6), 0.0, 1.0);
  float after = pow(1.0 - behind, 3.0) * burned;
  float hot = pow(1.0 - min(abs(d) / (w * 0.22), 1.0), 2.0);
  vec3 fire = burnColor * (ember * 1.3 + after * 0.9) + vec3(1.0, 0.92, 0.75) * hot;
  c.rgb = min(c.rgb + fire * c.a, vec3(c.a));
  return c;
}`,
  },
  {
    id: 'ray-burst',
    name: 'Ray Burst',
    category: 'light',
    duration: 1.0,
    params: [
      { key: 'rayColor', label: 'Color', type: 'color', default: '#ffe2ad' },
      { key: 'sourceX', label: 'Source X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'sourceY', label: 'Source Y', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
      { key: 'intensity', label: 'Intensity', type: 'float', default: 1, min: 0, max: 2.5, step: 0.05 },
    ],
    glsl: `${LIGHT_LIB}
vec4 transition(vec2 uv) {
  float k = max(sin(progress * PI), 0.0);
  float m = smoothstep(0.3, 0.7, progress);
  // sourceY is measured from the top of the frame.
  vec2 src = vec2(sourceX, 1.0 - sourceY);
  vec4 base = mix(getFromColor(uv), getToColor(uv), m);
  vec2 delta = src - uv;
  float j = ign();
  vec3 rays = vec3(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + j) / float(N);
    vec2 q = uv + delta * t * 0.7;
    vec4 s = mix(getFromColor(q), getToColor(q), m);
    rays += s.rgb * smoothstep(0.4, 0.95, luma(s.rgb)) * (1.0 - t);
  }
  rays /= float(N) * 0.5;
  // A procedural burst at the source keeps the effect alive on dark footage.
  vec2 da = (uv - src) * vec2(ratio, 1.0);
  float r = length(da);
  float ang = atan(da.y, da.x);
  float spokes = 0.55 + 0.3 * sin(ang * 7.0 + progress * 4.0) + 0.15 * sin(ang * 13.0 - progress * 6.0);
  float burst = exp(-r * r / 0.02) + exp(-r / 0.3) * 0.4 * spokes;
  vec3 light = (rays * rayColor * 1.5 + rayColor * burst * 0.55) * k * intensity;
  return vec4(screenAdd(base.rgb, light, base.a), base.a);
}`,
  },
];

export default transitions;
