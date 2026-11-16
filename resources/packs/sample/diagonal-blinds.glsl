// Diagonal blinds: bands sweep in along the diagonal, each opening from its own edge.
vec4 transition(vec2 uv) {
  float d = (uv.x + (1.0 - uv.y)) * 0.5;
  float band = fract(d * count);
  // Threshold runs from -softness to 1 so progress 0 / 1 show exactly the from / to picture.
  float t = progress * (1.0 + softness) - softness;
  float m = 1.0 - smoothstep(t, t + softness, band);
  return mix(getFromColor(uv), getToColor(uv), m);
}
