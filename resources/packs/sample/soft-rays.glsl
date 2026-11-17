// Soft light rays fanning down from above the frame, slowly turning.
vec4 generate(vec2 uv) {
  vec2 p = (uv - vec2(0.5, -0.35)) * vec2(u_aspect, 1.0);
  float a = atan(p.x, p.y);
  float r = length(p);
  float wave = 0.5 + 0.5 * sin(a * rays + u_time * speed);
  // Widen the rays with distance so they stay soft (no aliasing near the source).
  float beam = smoothstep(0.35, 1.0, wave) * exp(-r * 0.9);
  float glow = exp(-r * 1.6) * 0.35;
  vec3 col = colorBg + colorA * (beam * 0.6 + glow);
  col += (vnoise(uv * u_res / 3.0) - 0.5) / 255.0;
  return vec4(clamp(col, 0.0, 1.0), 1.0);
}
