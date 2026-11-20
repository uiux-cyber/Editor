import type { MotionPresetDef } from '../motionPresets';

const presets: MotionPresetDef[] = [
  {
    id: 'count-up',
    name: 'Count up',
    category: 'data',
    about: 'A big number counts up to your value, with a label and an accent line.',
    duration: 4,
    params: [
      { id: 'value', type: 'number', label: 'Value', default: 12500, min: 0, max: 1000000000, step: 1 },
      { id: 'decimals', type: 'number', label: 'Decimals', default: 0, min: 0, max: 2, step: 1 },
      { id: 'prefix', type: 'text', label: 'Prefix', default: '' },
      { id: 'suffix', type: 'text', label: 'Suffix', default: '+' },
      { id: 'label', type: 'text', label: 'Label', default: 'happy customers' },
      { id: 'color', type: 'color', label: 'Text colour', default: '#ffffff', brand: 'text' },
      { id: 'accent', type: 'color', label: 'Accent colour', default: '#22d3ee', brand: 'accent' },
      { id: 'font', type: 'font', label: 'Number font', default: 'Montserrat Variable', brand: 'heading' },
      { id: 'body', type: 'font', label: 'Label font', default: 'Inter Variable', brand: 'body' },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  await Promise.all([k.font('800 100px "' + p.font + '"'), k.font('500 40px "' + p.body + '"')]);
  const fmt = (v) => p.prefix + v.toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals }) + p.suffix;
  const widest = fmt(p.value);
  const size = k.fitText(ctx, widest, k.width * 0.8, (px) => '800 ' + px + 'px "' + p.font + '"', { max: 220 * s });
  const labelSize = Math.max(22 * s, size * 0.22);
  const cy = k.height / 2 - labelSize * 0.6;

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const outT = k.duration - 0.5;
    const fade = 1 - k.progress(t, outT, k.duration);
    const c = k.ease.outExpo(k.progress(t, 0.15, 2.4));
    const scale = 0.9 + 0.1 * k.ease.outBack(k.progress(t, 0, 0.5));
    const v = p.value * c;
    const step = Math.pow(10, -p.decimals);
    const shown = c >= 1 ? p.value : Math.floor(v / step) * step;
    ctx.globalAlpha = k.progress(t, 0, 0.2) * fade;
    ctx.save();
    ctx.translate(k.width / 2, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = p.color;
    ctx.font = '800 ' + size + 'px "' + p.font + '"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(shown), 0, 0);
    ctx.restore();
    ctx.font = '800 ' + size + 'px "' + p.font + '"';
    const w = ctx.measureText(widest).width;
    const line = k.ease.outExpo(k.progress(t, 0.4, 1.4));
    ctx.fillStyle = p.accent;
    ctx.fillRect(k.width / 2 - (w * line) / 2, cy + size * 0.58, w * line, Math.max(4, 10 * s));
    const la = k.progress(t, 0.8, 1.3);
    ctx.globalAlpha = la * fade;
    ctx.fillStyle = k.mix(p.color, p.accent, 0.2);
    ctx.font = '500 ' + labelSize + 'px "' + p.body + '"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(p.label, k.width / 2, cy + size * 0.58 + 30 * s + (1 - la) * 16 * s);
    ctx.globalAlpha = 1;
  };
}
`,
  },
  {
    id: 'bar-chart',
    name: 'Bar chart',
    category: 'data',
    about: 'Bars grow one after another with values counting up; the highest one is highlighted.',
    duration: 5,
    params: [
      { id: 'title', type: 'text', label: 'Title', default: 'Weekly visitors' },
      { id: 'labels', type: 'text', label: 'Labels', default: 'Mon, Tue, Wed, Thu, Fri' },
      { id: 'values', type: 'text', label: 'Values', default: '42, 67, 54, 88, 73' },
      { id: 'bar', type: 'color', label: 'Bar colour', default: 'rgba(255,255,255,0.85)' },
      { id: 'highlight', type: 'color', label: 'Highlight', default: '#5ce3df', brand: 'accent' },
      { id: 'color', type: 'color', label: 'Text colour', default: '#ffffff', brand: 'text' },
      { id: 'font', type: 'font', label: 'Font', default: 'Inter Variable', brand: 'body' },
    ],
    code: String.raw`import * as d3 from 'd3';

export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  await Promise.all([k.font('700 40px "' + p.font + '"'), k.font('500 32px "' + p.font + '"')]);
  const labels = p.labels.split(',').map((x) => x.trim());
  const values = p.values.split(',').map((x) => parseFloat(x.trim())).map((v) => (Number.isFinite(v) ? v : 0));
  const n = Math.max(1, Math.min(labels.length, values.length, 24));
  const data = Array.from({ length: n }, (_, i) => ({ label: labels[i] || '', value: values[i] || 0 }));
  const max = d3.max(data, (d) => d.value) || 1;
  const top = data.findIndex((d) => d.value === max);
  const m = { top: k.height * 0.22, right: k.width * 0.1, bottom: k.height * 0.16, left: k.width * 0.1 };
  const x = d3.scaleBand().domain(d3.range(n)).range([m.left, k.width - m.right]).padding(0.28);
  const y = d3.scaleLinear().domain([0, max * 1.12]).range([k.height - m.bottom, m.top]);
  const valueSize = Math.min(44 * s, x.bandwidth() * 0.42);
  const labelSize = Math.min(32 * s, x.bandwidth() * 0.32);
  const decimals = values.some((v) => !Number.isInteger(v)) ? 1 : 0;

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const fade = 1 - k.progress(t, k.duration - 0.4, k.duration);
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    if (p.title) {
      const a = k.progress(t, 0, 0.5);
      ctx.globalAlpha = a * fade;
      ctx.fillStyle = p.color;
      ctx.font = '700 ' + 52 * s + 'px "' + p.font + '"';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.title, k.width / 2, m.top * 0.5 + (1 - a) * 20 * s);
    }
    ctx.globalAlpha = fade;
    // Baseline
    ctx.fillStyle = k.mix(p.color, 'transparent', 0.75);
    ctx.fillRect(m.left, y(0), k.width - m.left - m.right, Math.max(1, 2 * s));
    data.forEach((d, i) => {
      const delay = 0.35 + k.stagger(i, Math.min(0.18, 1.6 / n));
      const g = k.ease.outExpo(k.progress(t, delay, delay + 1.3));
      const v = d.value * g;
      const yt = y(v);
      ctx.fillStyle = i === top ? p.highlight : p.bar;
      ctx.beginPath();
      ctx.roundRect(x(i), yt, x.bandwidth(), Math.max(0, y(0) - yt), [Math.min(14 * s, x.bandwidth() / 4), Math.min(14 * s, x.bandwidth() / 4), 0, 0]);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.textBaseline = 'bottom';
      ctx.font = '700 ' + valueSize + 'px "' + p.font + '"';
      ctx.globalAlpha = fade * k.progress(t, delay, delay + 0.3);
      ctx.fillText(v.toFixed(decimals), x(i) + x.bandwidth() / 2, yt - 10 * s);
      ctx.globalAlpha = fade * 0.75;
      ctx.textBaseline = 'top';
      ctx.font = '500 ' + labelSize + 'px "' + p.font + '"';
      ctx.fillText(d.label, x(i) + x.bandwidth() / 2, y(0) + 16 * s);
      ctx.globalAlpha = fade;
    });
    ctx.globalAlpha = 1;
  };
}
`,
  },
  {
    id: 'progress-ring',
    name: 'Progress ring',
    category: 'data',
    about: 'A ring fills to a percentage while the number counts up.',
    duration: 4,
    params: [
      { id: 'percent', type: 'number', label: 'Percent', default: 76, min: 0, max: 100, step: 1, suffix: '%' },
      { id: 'label', type: 'text', label: 'Label', default: 'of goals reached' },
      { id: 'ring', type: 'color', label: 'Ring colour', default: '#7c5cff', brand: 'primary' },
      { id: 'track', type: 'color', label: 'Track colour', default: 'rgba(255,255,255,0.14)' },
      { id: 'color', type: 'color', label: 'Text colour', default: '#ffffff', brand: 'text' },
      { id: 'font', type: 'font', label: 'Font', default: 'Space Grotesk Variable', brand: 'heading' },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  await Promise.all([k.font('700 100px "' + p.font + '"'), k.font('500 40px "' + p.font + '"')]);
  const r = 230 * s;
  const lw = 34 * s;
  const cx = k.width / 2;
  const cy = k.height / 2 - 30 * s;
  const start = -Math.PI / 2;

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const fade = 1 - k.progress(t, k.duration - 0.4, k.duration);
    const pop = k.ease.outBack(k.progress(t, 0, 0.5));
    const fill = k.ease.inOutCubic(k.progress(t, 0.3, 2.3)) * (p.percent / 100);
    ctx.globalAlpha = fade;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = p.track;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    if (fill > 0.001) {
      ctx.strokeStyle = p.ring;
      ctx.shadowColor = p.ring;
      ctx.shadowBlur = 30 * s;
      ctx.beginPath();
      ctx.arc(0, 0, r, start, start + Math.PI * 2 * fill);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const a = start + Math.PI * 2 * fill;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, lw * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = p.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + 120 * s + 'px "' + p.font + '"';
    ctx.fillText(Math.round(fill * 100) + '%', 0, 4 * s);
    ctx.restore();
    const la = k.progress(t, 0.9, 1.4);
    ctx.globalAlpha = la * fade;
    ctx.fillStyle = k.mix(p.color, p.ring, 0.2);
    ctx.font = '500 ' + 40 * s + 'px "' + p.font + '"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(p.label, cx, cy + r + lw + 36 * s + (1 - la) * 14 * s);
    ctx.globalAlpha = 1;
  };
}
`,
  },
];

export default presets;
