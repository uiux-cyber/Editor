import type { BlendMode } from '@/core/types';
import { GRADE_GLSL } from './grade';
import { extDeclsGlsl, extStageGlsl } from './layerExt';
import { GLSL_COMMON, GLSL_HEADER } from './shaderlib';

/** Layer quad: `u_matrix` maps the unit quad to clip space; `v_uv` is 0..1 with (0,0) top-left. */
export const LAYER_VERT = `#version 300 es
in vec2 a_pos;
uniform mat3 u_matrix;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  vec3 p = u_matrix * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}
`;

export const MASK_SHAPE_INDEX: Record<string, number> = { rect: 1, ellipse: 2, diamond: 3, triangle: 4, star: 5, heart: 6, hexagon: 7 };

/**
 * Draws one layer: samples the source, applies chroma key, colour grade, vignette / grain /
 * sharpen, rounded corners, reveal insets and the shape mask, and outputs premultiplied colour.
 */
/** Built lazily so every layer extension (engine/gl/ext) is compiled in. */
export const layerFrag = (): string => `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform vec4 u_uvRect;      // x0, y0, x1, y1 inside the texture (crop + flips)
uniform vec2 u_texel;       // 1 / texture size
uniform float u_opacity;
uniform vec2 u_size;        // layer size in render pixels
uniform float u_px;         // render pixels per design pixel
uniform float u_radius;     // corner radius in render pixels
uniform float u_edgeAA;     // 1 = anti-alias the quad edges
uniform vec4 u_clip;        // reveal insets: left, top, right, bottom (0..1)
uniform int u_maskShape;    // 0 = none
uniform vec4 u_maskRect;    // cx, cy, w, h as fractions of the layer
uniform vec4 u_maskOpts;    // rotation (rad), feather, radius, invert
uniform vec4 u_chroma;      // enabled, similarity, smoothness, spill
uniform vec3 u_chromaKey;
uniform float u_adjustOn;
uniform float u_filterOn;
uniform vec3 u_spatial;     // sharpen, vignette, grain
uniform float u_time;
${GLSL_COMMON}
${GRADE_GLSL}
uniform Grade u_adjust;
uniform Grade u_filter;
${extDeclsGlsl()}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
float dot2(vec2 v) { return dot(v, v); }
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

// Signed distance (render px, negative inside) to the mask shape.
float maskDistance(vec2 uv) {
  vec2 half_ = max(u_maskRect.zw * u_size * 0.5, vec2(0.5));
  vec2 p = (uv - 0.5 - u_maskRect.xy) * u_size;
  p = rot2(u_maskOpts.x) * p;
  float m = min(half_.x, half_.y);
  vec2 n = p / half_;
  if (u_maskShape == 1) return sdRoundBox(p, half_, u_maskOpts.z * m);
  if (u_maskShape == 2) return (length(n) - 1.0) * m;
  if (u_maskShape == 3) return (abs(n.x) + abs(n.y) - 1.0) * m * 0.7071;
  if (u_maskShape == 4) return max(n.y - 1.0, (abs(n.x) * 2.0 - (n.y + 1.0)) * 0.4472) * m;
  if (u_maskShape == 5) return sdStar5(vec2(n.x, -n.y), 1.0, 0.45) * m;
  if (u_maskShape == 6) return sdHeart(vec2(n.x * 0.62, (1.0 - (n.y * 0.5 + 0.5)) * 1.12)) * m * 1.6;
  if (u_maskShape == 7) return sdHexagon(n, 0.866) * m;
  return -1.0;
}

vec2 chromaCoords(vec3 c) {
  float y = luma(c);
  return vec2((c.b - y) * 0.564, (c.r - y) * 0.713);
}

void main() {
  vec2 uv = v_uv;
  vec2 tuv = mix(u_uvRect.xy, u_uvRect.zw, uv);
  vec4 c = texture(u_tex, tuv);

  if (u_spatial.x > 0.0) {
    vec4 n = texture(u_tex, tuv + vec2(u_texel.x, 0.0)) + texture(u_tex, tuv - vec2(u_texel.x, 0.0))
           + texture(u_tex, tuv + vec2(0.0, u_texel.y)) + texture(u_tex, tuv - vec2(0.0, u_texel.y));
    c.rgb = max(c.rgb + (c.rgb - n.rgb * 0.25) * u_spatial.x * 1.6, 0.0);
    c.rgb = min(c.rgb, vec3(c.a));
  }

  float alpha = c.a;
  vec3 rgb = alpha > 0.0 ? c.rgb / alpha : vec3(0.0);

  // Extensions: source stage
${extStageGlsl('source')}

  if (u_chroma.x > 0.5) {
    float d = distance(chromaCoords(rgb), chromaCoords(u_chromaKey));
    float sim = u_chroma.y * 0.5;
    float sm = u_chroma.z * 0.3 + 0.002;
    alpha *= smoothstep(sim, sim + sm, d);
    float spillAmt = (1.0 - smoothstep(sim, sim + sm + 0.25, d)) * u_chroma.w;
    rgb = mix(rgb, vec3(luma(rgb)), spillAmt);
  }

  if (u_adjustOn > 0.5) rgb = gradeColor(rgb, u_adjust);
  if (u_filterOn > 0.5) rgb = gradeColor(rgb, u_filter);

  // Extensions: grade stage
${extStageGlsl('grade')}

  if (u_spatial.y > 0.0) {
    float d = length(uv - 0.5) * 1.41421356;
    rgb *= 1.0 - u_spatial.y * 0.9 * smoothstep(0.35, 1.05, d);
  }
  if (u_spatial.z > 0.0) {
    // Grain cells are sized in design pixels so previews and exports match.
    vec2 cell = floor(uv * u_size / max(u_px * 1.6, 1.0));
    float n = hash21(cell + fract(u_time * 7.13) * vec2(131.0, 71.0)) - 0.5;
    rgb = clamp(rgb + n * u_spatial.z * 0.3, 0.0, 1.0);
  }

  // Coverage: quad edges / rounded corners, reveal insets and the shape mask.
  vec2 p = (uv - 0.5) * u_size;
  if (u_radius > 0.0 || u_edgeAA > 0.5) {
    float d = sdRoundBox(p, u_size * 0.5, u_radius);
    alpha *= clamp(-d + 0.5, 0.0, 1.0);
  }
  if (u_clip.x + u_clip.y + u_clip.z + u_clip.w > 0.0) {
    vec2 lo = (uv - u_clip.xy) * u_size;
    vec2 hi = (1.0 - u_clip.zw - uv) * u_size;
    float cx = (u_clip.x > 0.0 ? clamp(lo.x + 0.5, 0.0, 1.0) : 1.0) * (u_clip.z > 0.0 ? clamp(hi.x + 0.5, 0.0, 1.0) : 1.0);
    float cy = (u_clip.y > 0.0 ? clamp(lo.y + 0.5, 0.0, 1.0) : 1.0) * (u_clip.w > 0.0 ? clamp(hi.y + 0.5, 0.0, 1.0) : 1.0);
    alpha *= cx * cy;
  }
  if (u_maskShape > 0) {
    float d = maskDistance(uv);
    float halfMin = min(u_maskRect.z * u_size.x, u_maskRect.w * u_size.y) * 0.5;
    float e = max(u_maskOpts.y * halfMin, 0.75);
    float m = 1.0 - smoothstep(-e, e, d);
    alpha *= u_maskOpts.w > 0.5 ? 1.0 - m : m;
  }

  // Extensions: alpha stage
${extStageGlsl('alpha')}

  alpha *= u_opacity;
  outColor = vec4(rgb * alpha, alpha);
}
`;

export const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  'color-dodge': 6,
  'color-burn': 7,
  'hard-light': 8,
  'soft-light': 9,
  difference: 10,
  exclusion: 11,
  add: 12,
  subtract: 13,
};

/** Composites a full-frame layer over the backdrop with a separable blend mode (W3C formulas). */
export const BLEND_FRAG = `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform int u_mode;
uniform float u_opacity;

float overlayCh(float b, float s) { return b < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); }
float dodgeCh(float b, float s) { return b <= 0.0 ? 0.0 : (s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s))); }
float burnCh(float b, float s) { return b >= 1.0 ? 1.0 : (s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s)); }
float softCh(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
vec3 blendColors(vec3 b, vec3 s) {
  if (u_mode == 1) return b * s;
  if (u_mode == 2) return b + s - b * s;
  if (u_mode == 3) return vec3(overlayCh(b.r, s.r), overlayCh(b.g, s.g), overlayCh(b.b, s.b));
  if (u_mode == 4) return min(b, s);
  if (u_mode == 5) return max(b, s);
  if (u_mode == 6) return vec3(dodgeCh(b.r, s.r), dodgeCh(b.g, s.g), dodgeCh(b.b, s.b));
  if (u_mode == 7) return vec3(burnCh(b.r, s.r), burnCh(b.g, s.g), burnCh(b.b, s.b));
  if (u_mode == 8) return vec3(overlayCh(s.r, b.r), overlayCh(s.g, b.g), overlayCh(s.b, b.b));
  if (u_mode == 9) return vec3(softCh(b.r, s.r), softCh(b.g, s.g), softCh(b.b, s.b));
  if (u_mode == 10) return abs(b - s);
  if (u_mode == 11) return b + s - 2.0 * b * s;
  if (u_mode == 12) return min(b + s, vec3(1.0));
  if (u_mode == 13) return max(b - s, vec3(0.0));
  return s;
}
void main() {
  vec4 B = texture(u_base, v_uv);
  vec4 S = texture(u_layer, v_uv) * u_opacity;
  vec3 b = B.a > 0.0 ? B.rgb / B.a : vec3(0.0);
  vec3 s = S.a > 0.0 ? S.rgb / S.a : vec3(0.0);
  vec3 m = clamp(blendColors(b, s), 0.0, 1.0);
  vec3 co = S.a * (1.0 - B.a) * s + S.a * B.a * m + (1.0 - S.a) * B.a * b;
  float ao = S.a + B.a * (1.0 - S.a);
  outColor = vec4(co, ao);
}
`;

/** Plain textured copy with an opacity multiplier (used with GL blending for normal "over"). */
export const COPY_FRAG = `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_opacity;
void main() {
  outColor = texture(u_tex, v_uv) * u_opacity;
}
`;

/** Final blit to the canvas: flips rows (engine textures are top-first) and forces opacity. */
export const PRESENT_FRAG = `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
void main() {
  outColor = vec4(texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)).rgb, 1.0);
}
`;

/** Present variant that keeps the (premultiplied) alpha — transparent exports only. */
export const PRESENT_ALPHA_FRAG = `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
void main() {
  outColor = texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y));
}
`;
