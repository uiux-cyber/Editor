import type { MotionPresetDef } from '../motionPresets';

const presets: MotionPresetDef[] = [
  {
    id: 'confetti',
    name: 'Confetti',
    category: 'effects',
    about: 'Confetti bursts from the corners (or rains from the top) and flutters down.',
    duration: 4,
    params: [
      { id: 'a', type: 'color', label: 'Colour 1', default: '#7c5cff', brand: 'primary' },
      { id: 'b', type: 'color', label: 'Colour 2', default: '#22d3ee', brand: 'secondary' },
      { id: 'c', type: 'color', label: 'Colour 3', default: '#ffb020', brand: 'accent' },
      { id: 'd', type: 'color', label: 'Colour 4', default: '#ff4d8d' },
      { id: 'amount', type: 'number', label: 'Amount', default: 220, min: 40, max: 600, step: 10 },
      { id: 'from', type: 'select', label: 'From', default: 'Bottom corners', options: ['Bottom corners', 'Top', 'Center'] },
    ],
    code: String.raw`export default function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  const colors = [p.a, p.b, p.c, p.d];
  const g = 500 * s;
  const pieces = Array.from({ length: p.amount }, (_, i) => {
    const r = (salt) => k.rand(i, salt);
    let x0, y0, vx, vy, delay;
    if (p.from === 'Top') {
      x0 = r(1) * k.width;
      y0 = -40 * s - r(2) * k.height * 0.5;
      vx = (r(3) - 0.5) * 200 * s;
      vy = 100 * s + r(4) * 200 * s;
      delay = r(5) * 1.2;
    } else if (p.from === 'Center') {
      const a = r(1) * Math.PI * 2;
      const sp = (900 + r(2) * 1500) * s;
      x0 = k.width / 2;
      y0 = k.height / 2;
      vx = Math.cos(a) * sp;
      vy = Math.sin(a) * sp - 500 * s;
      delay = r(5) * 0.15;
    } else {
      const left = i % 2 === 0;
      const a = -Math.PI / 2 + (left ? 1 : -1) * (0.12 + r(1) * 0.85);
      const sp = (900 + r(2) * 1900) * s * Math.max(1, k.height / k.width);
      x0 = left ? 0 : k.width;
      y0 = k.height;
      vx = Math.cos(a) * sp;
      vy = Math.sin(a) * sp;
      delay = r(5) * 0.25;
    }
    return { x0, y0, vx, vy, delay, w: (10 + r(6) * 14) * s, h: (16 + r(7) * 18) * s, rot: r(8) * 6, spin: (r(9) - 0.5) * 14, flip: 4 + r(10) * 10, sway: 20 + r(11) * 50, color: colors[Math.floor(r(12) * colors.length) % colors.length] };
  });
  const drag = 2.2;

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const fade = 1 - k.progress(t, k.duration - 0.5, k.duration);
    for (const q of pieces) {
      const tt = t - q.delay;
      if (tt <= 0) continue;
      // Velocity decays with air drag; gravity pulls toward a terminal fall speed.
      const e = (1 - Math.exp(-drag * tt)) / drag;
      const term = g / drag;
      const x = q.x0 + q.vx * e + Math.sin(tt * 3 + q.rot) * q.sway * s;
      const y = q.y0 + q.vy * e + term * (tt - e);
      if (y > k.height + 60 * s || x < -60 * s || x > k.width + 60 * s) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(q.rot + q.spin * tt);
      ctx.scale(1, Math.cos(q.flip * tt));
      ctx.globalAlpha = fade;
      ctx.fillStyle = q.color;
      ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };
}
`,
  },
  {
    id: 'flow-particles',
    name: 'Flow particles',
    category: 'effects',
    about: 'Thousands of glowing particles drift along a smooth noise field.',
    duration: 8,
    params: [
      { id: 'a', type: 'color', label: 'Colour 1', default: '#7c5cff', brand: 'primary' },
      { id: 'b', type: 'color', label: 'Colour 2', default: '#22d3ee', brand: 'secondary' },
      { id: 'count', type: 'number', label: 'Particles', default: 1400, min: 100, max: 4000, step: 50 },
      { id: 'speed', type: 'number', label: 'Speed', default: 1, min: 0.2, max: 3, step: 0.05, suffix: '×' },
      { id: 'background', type: 'toggle', label: 'Background', default: false },
      { id: 'bg', type: 'color', label: 'Fill colour', default: '#0b0d13', brand: 'background' },
    ],
    code: String.raw`import { createNoise3D } from 'simplex-noise';

export default function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  const noise = createNoise3D(k.random);
  const n = p.count;
  const scale = 0.0014 / s;
  const step = 170 * s * p.speed;
  const TRAIL = 9;
  const e = 0.5;
  // Curl of a noise field: particles swirl without bunching up.
  const flow = (x, y, z) => {
    const u = x * scale;
    const v = y * scale;
    const dx = (noise(u, v + e, z) - noise(u, v - e, z)) / (2 * e);
    const dy = -(noise(u + e, v, z) - noise(u - e, v, z)) / (2 * e);
    // Not normalised: keeping the curl's own length is what stops particles bunching up.
    const len = Math.hypot(dx, dy);
    const k2 = len > 1.6 ? 1.6 / len : 1;
    return [dx * k2, dy * k2];
  };
  // Simulate once: positions of every particle for every frame.
  const start = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    start[i * 2] = k.rand(i, 1) * k.width;
    start[i * 2 + 1] = k.rand(i, 2) * k.height;
  }
  let pos = start.slice();
  const sim = k.bake((i, dt) => {
    if (i > 0) {
      const next = pos.slice();
      for (let j = 0; j < n; j++) {
        const x = pos[j * 2];
        const y = pos[j * 2 + 1];
        const [fx, fy] = flow(x, y, (i / k.fps) * 0.12);
        let nx = x + fx * step * dt;
        let ny = y + fy * step * dt;
        if (nx < 0) nx += k.width;
        if (nx > k.width) nx -= k.width;
        if (ny < 0) ny += k.height;
        if (ny > k.height) ny -= k.height;
        next[j * 2] = nx;
        next[j * 2 + 1] = ny;
      }
      pos = next;
    }
    return pos;
  });
  const colors = Array.from({ length: n }, (_, i) => k.mix(p.a, p.b, k.rand(i, 3)));

  return (t) => {
    if (p.background) {
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, k.width, k.height);
    } else {
      ctx.clearRect(0, 0, k.width, k.height);
    }
    const fade = k.progress(t, 0, 0.6) * (1 - k.progress(t, k.duration - 0.6, k.duration));
    const frames = [];
    for (let j = 0; j <= TRAIL; j++) frames.push(sim.at(Math.max(0, t - j / k.fps)));
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 2.2 * s);
    ctx.globalCompositeOperation = p.background ? 'lighter' : 'source-over';
    for (let i = 0; i < n; i++) {
      ctx.strokeStyle = colors[i];
      ctx.globalAlpha = 0.65 * fade;
      ctx.beginPath();
      let px = frames[0][i * 2];
      let py = frames[0][i * 2 + 1];
      ctx.moveTo(px, py);
      for (let j = 1; j <= TRAIL; j++) {
        const x = frames[j][i * 2];
        const y = frames[j][i * 2 + 1];
        // Wrapped around an edge: stop the trail there.
        if (Math.abs(x - px) > k.width / 2 || Math.abs(y - py) > k.height / 2) break;
        ctx.lineTo(x, y);
        px = x;
        py = y;
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  };
}
`,
  },
  {
    id: 'shape-wipe',
    name: 'Colour wipe',
    category: 'effects',
    about: 'Three colour bands sweep across and cover the frame: put it over a cut as a transition.',
    duration: 1.4,
    params: [
      { id: 'a', type: 'color', label: 'Colour 1', default: '#7c5cff', brand: 'primary' },
      { id: 'b', type: 'color', label: 'Colour 2', default: '#22d3ee', brand: 'secondary' },
      { id: 'c', type: 'color', label: 'Colour 3', default: '#0f1117', brand: 'background' },
      { id: 'direction', type: 'select', label: 'Direction', default: 'Left to right', options: ['Left to right', 'Right to left', 'Top to bottom', 'Bottom to top'] },
      { id: 'slant', type: 'number', label: 'Slant', default: 18, min: 0, max: 40, step: 1, suffix: '°' },
    ],
    code: String.raw`export default function setup(k) {
  const p = k.params;
  const ctx = k.ctx2d();
  const angle = { 'Left to right': 0, 'Right to left': Math.PI, 'Top to bottom': Math.PI / 2, 'Bottom to top': -Math.PI / 2 }[p.direction] ?? 0;
  const diag = Math.hypot(k.width, k.height);
  const skew = Math.tan((p.slant * Math.PI) / 180);
  const colors = [p.a, p.b, p.c];
  const D = k.duration;

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    ctx.save();
    ctx.translate(k.width / 2, k.height / 2);
    ctx.rotate(angle);
    const L = diag * (1 + skew);
    colors.forEach((c, j) => {
      const d = j * 0.06 * D;
      const head = k.ease.inOutCubic(k.progress(t, d, d + 0.45 * D));
      const tail = k.ease.inOutCubic(k.progress(t, d + 0.5 * D, d + 0.88 * D));
      const x1 = -L / 2 + L * head;
      const x0 = -L / 2 + L * tail;
      if (x1 <= x0) return;
      const h = diag / 2;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x0 - h * skew - diag * 0.02, -h);
      ctx.lineTo(x1 - h * skew, -h);
      ctx.lineTo(x1 + h * skew, h);
      ctx.lineTo(x0 + h * skew - diag * 0.02, h);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  };
}
`,
  },
];

export default presets;
