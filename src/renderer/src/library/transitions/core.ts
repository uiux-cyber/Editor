import type { TransitionDef } from '../types';

/** Core transitions the app relies on by id. Do not rename or remove. */
const transitions: TransitionDef[] = [
  {
    id: 'fade',
    name: 'Cross Dissolve',
    category: 'basic',
    duration: 0.6,
    glsl: `
vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}`,
  },
  {
    id: 'dip-to-color',
    name: 'Dip to Color',
    category: 'basic',
    duration: 0.8,
    params: [{ key: 'dipColor', label: 'Color', type: 'color', default: '#000000' }],
    glsl: `
vec4 transition(vec2 uv) {
  vec4 dip = vec4(dipColor, 1.0);
  float a = smoothstep(0.0, 0.5, progress);
  float b = smoothstep(0.5, 1.0, progress);
  return mix(mix(getFromColor(uv), dip, a), getToColor(uv), b);
}`,
  },
  {
    id: 'wipe',
    name: 'Soft Wipe',
    category: 'wipe',
    duration: 0.6,
    params: [
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
      { key: 'softness', label: 'Softness', type: 'float', default: 0.08, min: 0, max: 0.5, step: 0.01 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  // Project onto the wipe direction and normalise to 0..1 across the frame.
  float extent = abs(dir.x) + abs(dir.y);
  float d = dot(uv - 0.5, dir) / extent + 0.5;
  float s = max(softness, 0.0005);
  float edge = mix(-s, 1.0 + s, progress);
  float m = smoothstep(edge - s, edge + s, d);
  return mix(getToColor(uv), getFromColor(uv), m);
}`,
  },
  {
    id: 'push',
    name: 'Push',
    category: 'slide',
    duration: 0.6,
    params: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 0,
        options: [
          { label: 'Left', value: 0 },
          { label: 'Right', value: 1 },
          { label: 'Up', value: 2 },
          { label: 'Down', value: 3 },
        ],
      },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec2 dir = direction < 0.5 ? vec2(1.0, 0.0) : direction < 1.5 ? vec2(-1.0, 0.0) : direction < 2.5 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
  float p = progress * progress * (3.0 - 2.0 * progress);
  vec2 q = uv + dir * p;
  vec2 inside = step(vec2(0.0), q) * step(q, vec2(1.0));
  if (inside.x * inside.y > 0.5) return getFromColor(q);
  return getToColor(q - dir);
}`,
  },
];

export default transitions;
