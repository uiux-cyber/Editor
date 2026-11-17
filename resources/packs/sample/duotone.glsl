// Duotone: maps the picture's brightness onto a two-colour ramp. Identity at amount 0.
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (c.a <= 0.0001) return c;
  vec3 rgb = c.rgb / c.a;
  float l = smoothstep(0.02, 0.98, luma(rgb));
  vec3 tone = mix(shadowColor, highlightColor, l);
  return vec4(mix(rgb, tone, amount) * c.a, c.a);
}
