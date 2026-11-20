import { MOTION_EXAMPLES } from '@shared/motion';
import type { MotionPresetDef } from '../motionPresets';

const kinetic = MOTION_EXAMPLES[0];

const presets: MotionPresetDef[] = [
  {
    id: 'kinetic-title',
    name: 'Kinetic title',
    category: 'titles',
    about: 'Words rise in one after another, an underline draws, everything eases out.',
    duration: kinetic.duration,
    params: kinetic.params ?? [],
    code: kinetic.code,
  },
  {
    id: 'typewriter',
    name: 'Typewriter',
    category: 'titles',
    about: 'Text types itself out letter by letter with a blinking cursor.',
    duration: 5,
    params: [
      { id: 'text', type: 'text', label: 'Text', default: 'Every great story\nstarts with one line.', multiline: true },
      { id: 'color', type: 'color', label: 'Text colour', default: '#ffffff', brand: 'text' },
      { id: 'cursor', type: 'color', label: 'Cursor colour', default: '#5ce3df', brand: 'accent' },
      { id: 'font', type: 'font', label: 'Font', default: 'JetBrains Mono Variable' },
      { id: 'speed', type: 'number', label: 'Speed', default: 16, min: 4, max: 40, step: 1, suffix: ' /s' },
      { id: 'align', type: 'select', label: 'Alignment', default: 'Center', options: ['Center', 'Left'] },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  const lines = p.text.split('\n');
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '') || 'M';
  await k.font('600 64px "' + p.font + '"');
  const size = k.fitText(ctx, longest, k.width * 0.82, (px) => '600 ' + px + 'px "' + p.font + '"', { max: 76 * s });
  const lh = size * 1.4;
  const total = lines.reduce((n, l) => n + l.length, 0);
  ctx.font = '600 ' + size + 'px "' + p.font + '"';
  const blockW = ctx.measureText(longest).width;

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    ctx.font = '600 ' + size + 'px "' + p.font + '"';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1 - k.progress(t, k.duration - 0.4, k.duration);
    const typed = Math.max(0, Math.floor((t - 0.3) * p.speed));
    const top = k.height / 2 - ((lines.length - 1) * lh) / 2;
    let used = 0;
    let cx = null;
    let cy = top;
    lines.forEach((line, i) => {
      const n = Math.max(0, Math.min(line.length, typed - used));
      used += line.length;
      const x = p.align === 'Left' ? (k.width - blockW) / 2 : (k.width - ctx.measureText(line).width) / 2;
      const part = line.slice(0, n);
      ctx.fillStyle = p.color;
      ctx.fillText(part, x, top + i * lh);
      if (n > 0 || cx === null) {
        cx = x + ctx.measureText(part).width;
        cy = top + i * lh;
      }
    });
    const typing = typed < total;
    if (typing || Math.floor(t * 2.4) % 2 === 0) {
      ctx.fillStyle = p.cursor;
      ctx.fillRect(cx + size * 0.08, cy - size * 0.55, Math.max(2, size * 0.09), size * 1.1);
    }
    ctx.globalAlpha = 1;
  };
}
`,
  },
  {
    id: 'neon-sign',
    name: 'Neon sign',
    category: 'titles',
    about: 'A glowing neon sign flickers on inside a lit frame.',
    duration: 4,
    params: [
      { id: 'text', type: 'text', label: 'Text', default: 'OPEN LATE', brand: 'name' },
      { id: 'color', type: 'color', label: 'Glow colour', default: '#ff3df2', brand: 'primary' },
      { id: 'frame', type: 'color', label: 'Frame colour', default: '#3df2ff', brand: 'secondary' },
      { id: 'font', type: 'font', label: 'Font', default: 'Righteous' },
      { id: 'border', type: 'toggle', label: 'Frame', default: true },
      { id: 'flicker', type: 'toggle', label: 'Flicker', default: true },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  await k.font('400 100px "' + p.font + '"');
  const size = k.fitText(ctx, p.text, k.width * 0.7, (px) => '400 ' + px + 'px "' + p.font + '"', { max: 190 * s });
  ctx.font = '400 ' + size + 'px "' + p.font + '"';
  const w = ctx.measureText(p.text).width;
  const cx = k.width / 2;
  const cy = k.height / 2;
  const pad = size * 0.55;

  function glow(color, alpha, draw) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    for (const b of [70, 34, 14]) {
      ctx.shadowBlur = b * s;
      draw(color);
    }
    ctx.shadowBlur = 6 * s;
    draw(k.mix('#ffffff', color, 0.35));
    ctx.restore();
  }

  function level(t, salt) {
    if (!p.flicker) return k.progress(t, 0, 0.25);
    const f = Math.floor(t * 24);
    if (t < 1.1) return k.rand(f, salt) > 0.5 ? 1 : 0.12;
    if (t > 2.6 && t < 2.72) return 0.35;
    return 1;
  }

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const out = 1 - k.progress(t, k.duration - 0.35, k.duration);
    ctx.font = '400 ' + size + 'px "' + p.font + '"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (p.border) {
      const fr = level(t + 0.37, 7) * out;
      ctx.lineWidth = 7 * s;
      glow(p.frame, fr, (c) => {
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.roundRect(cx - w / 2 - pad, cy - size * 0.62 - pad * 0.6, w + pad * 2, size * 1.24 + pad * 1.2, 40 * s);
        ctx.stroke();
      });
    }
    // Unlit tube, then the light.
    ctx.globalAlpha = 0.18 * out;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, cx, cy);
    glow(p.color, level(t, 3) * out, (c) => {
      ctx.fillStyle = c;
      ctx.fillText(p.text, cx, cy);
    });
    ctx.globalAlpha = 1;
  };
}
`,
  },
  {
    id: 'letter-cascade',
    name: 'Block reveal',
    category: 'titles',
    about: 'A colour block sweeps across and leaves the title behind, letters dropping into place.',
    duration: 4,
    params: [
      { id: 'text', type: 'text', label: 'Title', default: 'NEW COLLECTION', brand: 'name' },
      { id: 'color', type: 'color', label: 'Text colour', default: '#ffffff', brand: 'text' },
      { id: 'block', type: 'color', label: 'Block colour', default: '#7c5cff', brand: 'primary' },
      { id: 'font', type: 'font', label: 'Font', default: 'Anton', brand: 'heading' },
      { id: 'speed', type: 'number', label: 'Speed', default: 1, min: 0.5, max: 2, step: 0.05, suffix: '×' },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  await k.font('400 100px "' + p.font + '"');
  const size = k.fitText(ctx, p.text, k.width * 0.8, (px) => '400 ' + px + 'px "' + p.font + '"', { max: 170 * s });
  ctx.font = '400 ' + size + 'px "' + p.font + '"';
  const letters = [...p.text];
  const widths = letters.map((c) => ctx.measureText(c).width);
  const total = ctx.measureText(p.text).width;
  const left = (k.width - total) / 2;
  const cy = k.height / 2;
  const xs = [];
  let x = left;
  for (const w of widths) {
    xs.push(x);
    x += w;
  }

  return (time) => {
    const t = time * p.speed;
    ctx.clearRect(0, 0, k.width, k.height);
    ctx.font = '400 ' + size + 'px "' + p.font + '"';
    ctx.textBaseline = 'middle';
    const outStart = k.duration - 0.9;
    // Letters, masked to their line so they slide in from below it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, cy - size * 0.75, k.width, size * 1.5);
    ctx.clip();
    letters.forEach((c, i) => {
      const d = 0.55 + i * 0.035;
      const inP = k.ease.outBack(k.progress(t, d, d + 0.55));
      const outP = k.ease.inCubic(k.progress(t, outStart + i * 0.02, outStart + 0.45 + i * 0.02));
      const y = cy + (1 - inP) * size * 0.9 + outP * size * 1.2;
      ctx.globalAlpha = k.progress(t, d, d + 0.12);
      ctx.fillStyle = p.color;
      ctx.fillText(c, xs[i], y);
    });
    ctx.restore();
    ctx.globalAlpha = 1;
    // The block grows from the left, then retreats to the right.
    const a = k.ease.inOutQuart(k.progress(t, 0, 0.6));
    const b = k.ease.inOutQuart(k.progress(t, 0.6, 1.15));
    const bx0 = left - 24 * s + (total + 48 * s) * b;
    const bx1 = left - 24 * s + (total + 48 * s) * a;
    if (bx1 > bx0) {
      ctx.fillStyle = p.block;
      ctx.fillRect(bx0, cy - size * 0.62, bx1 - bx0, size * 1.24);
    }
    // A thin underline stays while the title holds.
    const u = k.ease.outExpo(k.progress(t, 1.1, 1.8)) * (1 - k.ease.inCubic(k.progress(t, outStart, outStart + 0.5)));
    ctx.fillStyle = p.block;
    ctx.fillRect(left, cy + size * 0.7, total * u, Math.max(3, 8 * s));
  };
}
`,
  },
];

export default presets;
