import type { MotionPresetDef } from '../motionPresets';

const presets: MotionPresetDef[] = [
  {
    id: 'lower-third-clean',
    name: 'Clean lower third',
    category: 'lower-thirds',
    about: 'Name and role slide out from a coloured bar, then tuck away again.',
    duration: 5,
    params: [
      { id: 'name', type: 'text', label: 'Name', default: 'Alex Morgan' },
      { id: 'role', type: 'text', label: 'Role', default: 'Creative Director' },
      { id: 'bar', type: 'color', label: 'Bar colour', default: '#7c5cff', brand: 'primary' },
      { id: 'panel', type: 'color', label: 'Panel colour', default: 'rgba(12,14,20,0.78)' },
      { id: 'color', type: 'color', label: 'Text colour', default: '#ffffff', brand: 'text' },
      { id: 'heading', type: 'font', label: 'Name font', default: 'Montserrat Variable', brand: 'heading' },
      { id: 'body', type: 'font', label: 'Role font', default: 'Inter Variable', brand: 'body' },
      { id: 'side', type: 'select', label: 'Position', default: 'Left', options: ['Left', 'Right'] },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  await Promise.all([k.font('800 60px "' + p.heading + '"'), k.font('500 34px "' + p.body + '"')]);
  const nameSize = 64 * s;
  const roleSize = 34 * s;
  ctx.font = '800 ' + nameSize + 'px "' + p.heading + '"';
  const nameW = ctx.measureText(p.name).width;
  ctx.font = '500 ' + roleSize + 'px "' + p.body + '"';
  const roleW = ctx.measureText(p.role).width;
  const padX = 34 * s;
  const panelW = Math.max(nameW, roleW) + padX * 2;
  const panelH = nameSize * 1.25 + roleSize * 1.6 + 30 * s;
  const right = p.side === 'Right';
  const margin = Math.round(k.width * 0.06);
  const x0 = right ? k.width - margin - panelW : margin;
  const y0 = k.height - Math.round(k.height * 0.1) - panelH;
  const barW = 10 * s;

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const outT = k.duration - 0.7;
    const bar = k.ease.outExpo(k.progress(t, 0, 0.5)) * (1 - k.ease.inExpo(k.progress(t, outT + 0.35, outT + 0.7)));
    const open = k.ease.outExpo(k.progress(t, 0.25, 0.95)) * (1 - k.ease.inExpo(k.progress(t, outT, outT + 0.45)));
    const barX = right ? x0 + panelW : x0 - barW;
    // Bar grows from the middle.
    ctx.fillStyle = p.bar;
    ctx.fillRect(barX, y0 + (panelH * (1 - bar)) / 2, barW, panelH * bar);
    if (open <= 0) return;
    // Panel unfolds from the bar.
    const w = panelW * open;
    const px = right ? x0 + panelW - w : x0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, y0, w, panelH);
    ctx.clip();
    ctx.fillStyle = p.panel;
    ctx.fillRect(px, y0, w, panelH);
    const slide = (1 - open) * (right ? 60 : -60) * s;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = right ? 'right' : 'left';
    const tx = (right ? x0 + panelW - padX : x0 + padX) + slide;
    ctx.fillStyle = p.color;
    ctx.font = '800 ' + nameSize + 'px "' + p.heading + '"';
    ctx.fillText(p.name, tx, y0 + 15 * s + nameSize);
    const role = k.progress(t, 0.55, 1.0) * (1 - k.progress(t, outT - 0.1, outT + 0.2));
    ctx.globalAlpha = role;
    ctx.font = '500 ' + roleSize + 'px "' + p.body + '"';
    ctx.fillStyle = k.mix(p.color, p.bar, 0.25);
    ctx.fillText(p.role, tx, y0 + 15 * s + nameSize * 1.25 + roleSize * 1.15 + (1 - role) * 12 * s);
    ctx.restore();
  };
}
`,
  },
  {
    id: 'lower-third-logo',
    name: 'Logo pill',
    category: 'lower-thirds',
    about: 'Your logo pops in a circle that stretches into a pill with a name and handle.',
    duration: 5,
    params: [
      { id: 'logo', type: 'image', label: 'Logo', default: '', brand: 'logo' },
      { id: 'title', type: 'text', label: 'Title', default: 'Kinora Studio', brand: 'name' },
      { id: 'subtitle', type: 'text', label: 'Subtitle', default: '@kinora.studio' },
      { id: 'background', type: 'color', label: 'Pill colour', default: '#ffffff' },
      { id: 'color', type: 'color', label: 'Text colour', default: '#14151a' },
      { id: 'accent', type: 'color', label: 'Circle colour', default: '#7c5cff', brand: 'primary' },
      { id: 'font', type: 'font', label: 'Font', default: 'Poppins', brand: 'heading' },
      { id: 'side', type: 'select', label: 'Position', default: 'Bottom left', options: ['Bottom left', 'Bottom right', 'Top left', 'Top right'] },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const s = Math.min(k.width, k.height) / 1080;
  const ctx = k.ctx2d();
  // Static fonts (e.g. Poppins) load each weight separately: load every weight drawn.
  await Promise.all([k.font('700 40px "' + p.font + '"'), k.font('500 28px "' + p.font + '"')]);
  const h = 120 * s;
  const r = h / 2;
  const titleSize = 40 * s;
  const subSize = 28 * s;
  ctx.font = '700 ' + titleSize + 'px "' + p.font + '"';
  const tw = ctx.measureText(p.title).width;
  ctx.font = '500 ' + subSize + 'px "' + p.font + '"';
  const sw = ctx.measureText(p.subtitle).width;
  const fullW = h + 26 * s + Math.max(tw, sw) + 46 * s;
  const right = p.side.endsWith('right');
  const top = p.side.startsWith('Top');
  const mx = k.width * 0.05;
  const my = k.height * 0.07;
  const y = top ? my : k.height - my - h;
  const initial = (p.title.trim()[0] || 'K').toUpperCase();

  function logo(cx, cy, d) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = p.accent;
    ctx.fill();
    ctx.clip();
    if (p.logo) {
      const img = p.logo;
      const box = d * 0.66;
      const sc = Math.min(box / img.width, box / img.height);
      ctx.drawImage(img, cx - (img.width * sc) / 2, cy - (img.height * sc) / 2, img.width * sc, img.height * sc);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 ' + d * 0.46 + 'px "' + p.font + '"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, cx, cy + d * 0.03);
    }
    ctx.restore();
  }

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    const outT = k.duration - 0.8;
    const pop = k.spring(t - 0.05, { stiffness: 170, damping: 13 }) * (1 - k.ease.inBack(k.progress(t, outT + 0.4, outT + 0.8)));
    const grow = k.ease.outExpo(k.progress(t, 0.45, 1.15)) * (1 - k.ease.inExpo(k.progress(t, outT, outT + 0.45)));
    if (pop <= 0.001) return;
    const w = h + (fullW - h) * grow;
    const x = right ? k.width - mx - w : mx;
    const d = h * Math.max(0, pop);
    // Pill
    ctx.fillStyle = p.background;
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 30 * s;
    ctx.shadowOffsetY = 8 * s;
    ctx.beginPath();
    ctx.roundRect(right ? x + w - r - d / 2 - (w - h) : x + r - d / 2, y + r - d / 2, d + (w - h), d, d / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // Logo circle sits at the outer end.
    const lx = right ? x + w - r : x + r;
    logo(lx, y + r, d * 0.82);
    // Text
    const a = k.progress(t, 0.85, 1.25) * (1 - k.progress(t, outT - 0.15, outT + 0.15));
    if (a > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(right ? x : x + h * 0.9, y, w - h * 0.9, h);
      ctx.clip();
      ctx.globalAlpha = a;
      ctx.textAlign = right ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      const tx = right ? x + w - h - 18 * s : x + h + 18 * s;
      const dx = (1 - a) * (right ? 30 : -30) * s;
      ctx.fillStyle = p.color;
      ctx.font = '700 ' + titleSize + 'px "' + p.font + '"';
      ctx.fillText(p.title, tx + dx, y + h * 0.48);
      ctx.globalAlpha = a * 0.7;
      ctx.font = '500 ' + subSize + 'px "' + p.font + '"';
      ctx.fillText(p.subtitle, tx + dx, y + h * 0.48 + subSize * 1.25);
      ctx.restore();
    }
  };
}
`,
  },
];

export default presets;
