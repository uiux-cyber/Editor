import type { MotionPresetDef } from '../motionPresets';

const presets: MotionPresetDef[] = [
  {
    id: 'subscribe-button',
    name: 'Subscribe button',
    category: 'social',
    about: 'A button pops up, a cursor clicks it, it turns to “Subscribed” and the bell rings.',
    duration: 4,
    params: [
      { id: 'label', type: 'text', label: 'Button text', default: 'SUBSCRIBE' },
      { id: 'done', type: 'text', label: 'When clicked', default: 'SUBSCRIBED' },
      { id: 'color', type: 'color', label: 'Button colour', default: '#ff2340', brand: 'primary' },
      { id: 'font', type: 'font', label: 'Font', default: 'Montserrat Variable' },
      { id: 'cursor', type: 'toggle', label: 'Show cursor', default: true },
      { id: 'bell', type: 'toggle', label: 'Show bell', default: true },
      { id: 'side', type: 'select', label: 'Position', default: 'Bottom', options: ['Bottom', 'Center', 'Top'] },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  await k.font('800 40px "' + p.font + '"');
  const fs = 40 * s;
  ctx.font = '800 ' + fs + 'px "' + p.font + '"';
  const bw = Math.max(ctx.measureText(p.label).width, ctx.measureText(p.done).width) + 90 * s;
  const bh = 96 * s;
  const bell = p.bell ? bh + 20 * s : 0;
  const cx = k.width / 2 - bell / 2;
  const cy = p.side === 'Top' ? k.height * 0.16 : p.side === 'Center' ? k.height / 2 : k.height * 0.84;
  const clickT = 1.55;

  function cursor(x, y, sc) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc * s * 1.6, sc * s * 1.6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 34);
    ctx.lineTo(9, 26);
    ctx.lineTo(15, 39);
    ctx.lineTo(21, 36);
    ctx.lineTo(15, 23);
    ctx.lineTo(26, 23);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawBell(x, y, size, swing) {
    ctx.save();
    ctx.translate(x, y - size * 0.32);
    ctx.rotate(swing);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, size * 0.5);
    ctx.quadraticCurveTo(-size * 0.3, size * 0.05, -size * 0.22, -size * 0.05);
    ctx.quadraticCurveTo(0, -size * 0.32, size * 0.22, -size * 0.05);
    ctx.quadraticCurveTo(size * 0.3, size * 0.05, size * 0.3, size * 0.5);
    ctx.lineTo(size * 0.38, size * 0.6);
    ctx.lineTo(-size * 0.38, size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, size * 0.7, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const outT = k.duration - 0.45;
    const appear = k.spring(t, { stiffness: 200, damping: 14 }) * (1 - k.ease.inBack(k.progress(t, outT, k.duration)));
    if (appear <= 0.001) return;
    const press = t > clickT && t < clickT + 0.18 ? 0.93 : 1;
    const clicked = t >= clickT;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(appear * press, appear * press);
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 24 * s;
    ctx.shadowOffsetY = 6 * s;
    ctx.fillStyle = clicked ? '#3a3b40' : p.color;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 18 * s);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 ' + fs + 'px "' + p.font + '"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(clicked ? p.done : p.label, 0, 2 * s);
    ctx.restore();
    if (p.bell) {
      const bAppear = k.spring(t - 0.15, { stiffness: 200, damping: 14 }) * (1 - k.ease.inBack(k.progress(t, outT, k.duration)));
      const bx = cx + bw / 2 + 20 * s + bh / 2;
      ctx.save();
      ctx.translate(bx, cy);
      ctx.scale(bAppear, bAppear);
      ctx.fillStyle = clicked ? '#3a3b40' : p.color;
      ctx.beginPath();
      ctx.roundRect(-bh / 2, -bh / 2, bh, bh, 18 * s);
      ctx.fill();
      const ring = clicked ? Math.sin((t - clickT - 0.15) * 30) * 0.45 * Math.exp(-(t - clickT - 0.15) * 3.2) : 0;
      drawBell(0, 0, bh * 0.62, t > clickT + 0.15 ? ring : 0);
      ctx.restore();
    }
    if (p.cursor) {
      const move = k.ease.inOutCubic(k.progress(t, 0.5, clickT - 0.05));
      const leave = k.ease.inCubic(k.progress(t, clickT + 0.5, clickT + 1.2));
      const x0 = cx + bw * 0.9;
      const y0 = cy + bh * 2.4;
      const x1 = cx + bw * 0.18;
      const y1 = cy + bh * 0.05;
      const x = k.lerp(x0, x1, move) + leave * bw * 0.8;
      const y = k.lerp(y0, y1, move) + leave * bh * 2;
      const vis = k.progress(t, 0.45, 0.6) * (1 - leave);
      if (vis > 0) {
        ctx.globalAlpha = vis;
        cursor(x, y, t > clickT && t < clickT + 0.18 ? 0.88 : 1);
        ctx.globalAlpha = 1;
      }
    }
  };
}
`,
  },
  {
    id: 'like-follow',
    name: 'Like & follow',
    category: 'social',
    about: 'A heart bursts into little hearts next to your handle, with a follow badge.',
    duration: 4,
    params: [
      { id: 'handle', type: 'text', label: 'Handle', default: '@yourname' },
      { id: 'badge', type: 'text', label: 'Badge text', default: 'Follow for more' },
      { id: 'heart', type: 'color', label: 'Heart colour', default: '#ff3b6b', brand: 'primary' },
      { id: 'panel', type: 'color', label: 'Panel colour', default: '#ffffff' },
      { id: 'color', type: 'color', label: 'Text colour', default: '#15161b' },
      { id: 'font', type: 'font', label: 'Font', default: 'Poppins', brand: 'heading' },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  await Promise.all([k.font('700 46px "' + p.font + '"'), k.font('600 30px "' + p.font + '"')]);
  const hs = 46 * s;
  const bs = 30 * s;
  ctx.font = '700 ' + hs + 'px "' + p.font + '"';
  const hw = ctx.measureText(p.handle).width;
  ctx.font = '600 ' + bs + 'px "' + p.font + '"';
  const bw = ctx.measureText(p.badge).width;
  const icon = 110 * s;
  const w = icon + 24 * s + Math.max(hw, bw) + 50 * s;
  const h = 150 * s;
  const x0 = (k.width - w) / 2;
  const y0 = k.height * 0.78 - h / 2;
  const hx = x0 + 30 * s + icon / 2;
  const hy = y0 + h / 2;
  const bursts = Array.from({ length: 9 }, (_, i) => ({ a: -Math.PI / 2 + (k.rand(i, 1) - 0.5) * 2.2, d: 120 + k.rand(i, 2) * 160, sz: 0.25 + k.rand(i, 3) * 0.3, delay: k.rand(i, 4) * 0.2 }));

  function heart(x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    ctx.beginPath();
    ctx.moveTo(0, 30);
    ctx.bezierCurveTo(-60, -10, -45, -60, 0, -30);
    ctx.bezierCurveTo(45, -60, 60, -10, 0, 30);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const outT = k.duration - 0.5;
    const open = k.ease.outBack(k.progress(t, 0, 0.5)) * (1 - k.ease.inBack(k.progress(t, outT, k.duration)));
    if (open <= 0.001) return;
    ctx.save();
    ctx.translate(k.width / 2, hy);
    ctx.scale(open, open);
    ctx.translate(-k.width / 2, -hy);
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 30 * s;
    ctx.fillStyle = p.panel;
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, h / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // Heart: pops, then beats.
    const pop = k.spring(t - 0.35, { stiffness: 260, damping: 11 });
    const beat = 1 + 0.08 * Math.max(0, Math.sin((t - 1.2) * 7)) * k.progress(t, 1.2, 1.4);
    heart(hx, hy + 6 * s, icon * 0.95 * pop * beat, p.heart);
    // Burst of small hearts.
    for (const [i, b] of bursts.entries()) {
      const q = k.progress(t, 0.55 + b.delay, 1.55 + b.delay);
      if (q <= 0 || q >= 1) continue;
      const e = k.ease.outCubic(q);
      ctx.globalAlpha = 1 - q;
      heart(hx + Math.cos(b.a) * b.d * s * e, hy + Math.sin(b.a) * b.d * s * e, icon * b.sz, i % 2 ? p.heart : k.mix(p.heart, '#ffffff', 0.45));
    }
    ctx.globalAlpha = 1;
    const a = k.progress(t, 0.5, 0.9);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 ' + hs + 'px "' + p.font + '"';
    const tx = x0 + 30 * s + icon + 24 * s;
    ctx.fillText(p.handle, tx + (1 - a) * 20 * s, hy - 4 * s);
    ctx.globalAlpha = a * 0.65;
    ctx.font = '600 ' + bs + 'px "' + p.font + '"';
    ctx.fillText(p.badge, tx + (1 - a) * 20 * s, hy + bs * 1.15);
    ctx.restore();
    ctx.globalAlpha = 1;
  };
}
`,
  },
];

export default presets;
