import type { MotionPresetDef } from '../motionPresets';

/**
 * Kinetic reel: the editorial kinetic-typography look of social reels and ads. A short script,
 * one line per beat, is revealed word by word: a bold sans for the sentence, a serif italic for
 * the words marked _like this_, and a coloured, optionally glowing accent for the words marked
 * *like this*; "/" breaks a line. Paper, grid, glow or plain grounds, editorial details (barcode,
 * crop marks, label), crossing arcs with four-point stars, orbits, or a ribbon; beats can
 * alternate light and dark. A picture area (with a dotted ring) can be kept free for a photo on
 * some beats; templates place a placeholder there (see templates/reels.ts for the same geometry).
 */
const presets: MotionPresetDef[] = [
  {
    id: 'reel-kinetic',
    name: 'Kinetic reel',
    category: 'text',
    about: 'A short script revealed word by word: bold sans, serif italics and a coloured accent word, on paper, grid or glow.',
    duration: 10,
    fullFrame: true,
    poster: 0.15,
    tags: ['kinetic typography', 'reel', 'ad', 'editorial', 'script', 'words', 'story', 'explainer'],
    params: [
      { id: 'script', type: 'text', label: 'Script', default: "You've got the / *ideas* and _content_\nbut no one / *sees it*\nLet's make it / _impossible_ to *scroll past*", multiline: true },
      { id: 'style', type: 'select', label: 'Ground', default: 'Paper', options: ['Paper', 'Grid', 'Glow', 'Plain'] },
      { id: 'decor', type: 'select', label: 'Details', default: 'Editorial', options: ['Editorial', 'Arcs & stars', 'Orbits', 'Ribbon', 'None'] },
      { id: 'motion', type: 'select', label: 'Motion', default: 'Mixed', options: ['Mixed', 'Rise', 'Blur', 'Punch', 'Type', 'Echo', 'Slide'] },
      { id: 'accentStyle', type: 'select', label: 'Accent words', default: 'Bold colour', options: ['Bold colour', 'Serif italic', 'Highlight', 'Outline'] },
      { id: 'flip', type: 'toggle', label: 'Light / dark', default: true },
      { id: 'glow', type: 'toggle', label: 'Accent glow', default: true },
      { id: 'background', type: 'toggle', label: 'Background', default: true },
      { id: 'bg', type: 'color', label: 'Paper', default: '#f2eee7', brand: 'background' },
      { id: 'ink', type: 'color', label: 'Ink', default: '#141414', brand: 'text' },
      { id: 'accent', type: 'color', label: 'Accent', default: '#e3242b', brand: 'accent' },
      { id: 'accent2', type: 'color', label: 'Second colour', default: '#7b5cff', brand: 'secondary' },
      { id: 'sans', type: 'font', label: 'Sans', default: 'Inter Variable', brand: 'heading' },
      { id: 'serif', type: 'font', label: 'Serif', default: 'Playfair Display Variable' },
      { id: 'size', type: 'number', label: 'Text size', default: 1, min: 0.6, max: 1.6, step: 0.05, suffix: '×' },
      { id: 'align', type: 'select', label: 'Alignment', default: 'Center', options: ['Center', 'Left'] },
      { id: 'picture', type: 'select', label: 'Picture area', default: 'None', options: ['None', 'Start', 'End'] },
      { id: 'pictureBeats', type: 'text', label: 'Picture beats', default: '1' },
      { id: 'ring', type: 'toggle', label: 'Picture ring', default: true },
      { id: 'label', type: 'text', label: 'Label', default: 'Vol. 01 — Studio notes', brand: 'name' },
    ],
    looks: [
      { style: 'Grid', decor: 'Arcs & stars', accentStyle: 'Serif italic', flip: false },
      { style: 'Glow', decor: 'Orbits', flip: false, motion: 'Echo' },
      { style: 'Paper', decor: 'Ribbon', accentStyle: 'Highlight', flip: false },
      { style: 'Plain', decor: 'Editorial', accentStyle: 'Outline', motion: 'Type' },
    ],
    vary: ['motion'],
    copy: [
      { script: 'Your brain / _makes over_ / *35,000* decisions\n_Smart decisions_ / aren’t *luck*\nThey’re / *systems*', label: 'The habits issue' },
      { script: 'Everything starts / with a *spark*\n*Growth*\nis a _habit_ / not an accident\nStart yours / *today*', label: 'Growth studio' },
      { script: 'Attention / is _expensive_\nSo make every / *second* count\nHook. Story. / *Payoff.*', label: 'Creator notes' },
      { script: 'Your product / is _great_\nBut no one / *knows it*\nLet’s tell / *the story*', label: 'Launch week' },
    ],
    code: String.raw`export default async function setup(k) {
  const p = k.params;
  const W = k.width;
  const H = k.height;
  const s = Math.min(W, H) / 1080;
  const portrait = H > W * 1.05;
  const ctx = k.ctx2d();
  const sans = p.sans;
  const serif = p.serif;
  await Promise.all([
    k.font('700 100px "' + sans + '"'),
    k.font('900 100px "' + sans + '"'),
    k.font('600 100px "' + sans + '"'),
    k.font('italic 500 100px "' + serif + '"'),
    k.font('italic 700 100px "' + serif + '"'),
  ]);

  // ---- script -> beats ------------------------------------------------------------------------
  const beats = String(p.script || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!beats.length) beats.push('Your words here');
  const n = beats.length;
  const beatLen = k.duration / n;
  const side = p.picture;
  const picBeats = new Set(String(p.pictureBeats || '').split(/[^0-9]+/).filter(Boolean).map((x) => Number(x) - 1));
  const hasPic = (b) => side !== 'None' && picBeats.has(b);
  const MOTIONS = ['Rise', 'Blur', 'Punch', 'Type', 'Echo', 'Slide'];
  const pad = Math.min(W, H) * 0.08;

  // The picture area (templates put a placeholder exactly here) and the text area beside it:
  // stacked in tall frames, side by side in wide ones, a smaller picture beside the text in square ones.
  const mode = H > W * 1.15 ? 'stack' : W > H * 1.15 ? 'side' : 'square';
  const first = side === 'Start';
  const pic =
    mode === 'stack'
      ? { x: W / 2, y: first ? H * 0.3 : H * 0.7, r: Math.min(W * 0.3, H * 0.17) }
      : mode === 'side'
        ? { x: first ? W * 0.27 : W * 0.73, y: H / 2, r: H * 0.3 }
        : { x: first ? W * 0.25 : W * 0.75, y: H / 2, r: W * 0.2 };
  function textArea(b) {
    if (hasPic(b)) {
      if (mode === 'stack') return first ? { x: pad, y: H * 0.53, w: W - pad * 2, h: H * 0.38 } : { x: pad, y: H * 0.09, w: W - pad * 2, h: H * 0.38 };
      if (mode === 'side') return first ? { x: W * 0.53, y: pad, w: W * 0.42, h: H - pad * 2 } : { x: W * 0.05, y: pad, w: W * 0.42, h: H - pad * 2 };
      return first ? { x: W * 0.52, y: pad, w: W * 0.43, h: H - pad * 2 } : { x: W * 0.05, y: pad, w: W * 0.43, h: H - pad * 2 };
    }
    return { x: pad, y: pad * 1.5, w: W - pad * 2, h: H - pad * 3 };
  }

  const fontFor = (kind, px) => {
    if (kind === 'serif') return 'italic 500 ' + px + 'px "' + serif + '"';
    if (kind === 'accent') return p.accentStyle === 'Serif italic' ? 'italic 700 ' + px + 'px "' + serif + '"' : '900 ' + px + 'px "' + sans + '"';
    return '700 ' + px + 'px "' + sans + '"';
  };
  const LINE = 1.1;

  const layouts = beats.map((line, b) => {
    const rows = line
      .split('/')
      .map((row) => {
        const words = [];
        const re = /\*([^*]+)\*|_([^_]+)_|(\S+)/g;
        let m;
        while ((m = re.exec(row))) {
          const kind = m[1] ? 'accent' : m[2] ? 'serif' : 'plain';
          for (const w of (m[1] || m[2] || m[3]).trim().split(/\s+/)) if (w) words.push({ text: w, kind });
        }
        return words;
      })
      .filter((r) => r.length);
    const measure = (r) => {
      // Rows that are mostly emphasis (accent or serif words) are set bigger.
      const marked = r.filter((w) => w.kind !== 'plain').length;
      const big = marked * 2 >= r.length && r.some((w) => w.kind === 'accent') ? 1.38 : marked * 2 >= r.length ? 1.2 : 1;
      let width = 0;
      const items = r.map((w, i) => {
        ctx.font = fontFor(w.kind, 100 * big);
        const w100 = ctx.measureText(w.text).width;
        ctx.font = fontFor('plain', 100 * big);
        const sp100 = i < r.length - 1 ? ctx.measureText(' ').width * 1.05 : 0;
        width += w100 + sp100;
        return { text: w.text, kind: w.kind, w100, sp100 };
      });
      return { items, big, width, words: r };
    };
    const area0 = textArea(b);
    const cap = 150 * s * p.size * (portrait ? 1.1 : 1);
    let measured = rows.map(measure);
    // A line too long for the frame at full size is split in two balanced lines (narrow frames).
    for (let pass = 0; pass < 4 && measured.length < 6; pass++) {
      const i = measured.findIndex((r) => r.words.length > 3 && (r.width * cap) / 100 > area0.w * 0.94 * 1.45);
      if (i < 0) break;
      const r = measured[i];
      let best = 2;
      let bestW = Infinity;
      let acc;
      for (let j = 2; j < r.items.length - 1; j++) {
        acc = r.items.slice(0, j).reduce((a, it) => a + it.w100 + it.sp100, 0);
        const worst = Math.max(acc, r.width - acc);
        if (worst < bestW) {
          bestW = worst;
          best = j;
        }
      }
      measured.splice(i, 1, measure(r.words.slice(0, best)), measure(r.words.slice(best)));
    }
    const area = area0;
    const maxW = Math.max(1, ...measured.map((r) => r.width));
    const totalH = Math.max(1, measured.reduce((a, r) => a + 100 * r.big * LINE, 0));
    const px = Math.min((area.w * 0.94 * 100) / maxW, (area.h * 0.92 * 100) / totalH, cap);
    const out = [];
    let y = area.y + (area.h - (totalH * px) / 100) / 2;
    let i = 0;
    for (const r of measured) {
      const size = px * r.big;
      const rw = (r.width * px) / 100;
      let x = p.align === 'Left' ? area.x : area.x + (area.w - rw) / 2;
      const h = size * LINE;
      const words = r.items.map((it) => {
        const o = { text: it.text, kind: it.kind, x, base: y + h * 0.78, w: (it.w100 * px) / 100, size, font: fontFor(it.kind, size), i: i++ };
        x += ((it.w100 + it.sp100) * px) / 100;
        return o;
      });
      out.push({ words, top: y, h, left: area.x - pad, width: area.w + pad * 2 });
      y += h;
    }
    const chars = out.reduce((a, r) => a + r.words.reduce((c, w) => c + w.text.length + 1, 0), 0);
    return { rows: out, count: i, chars, area };
  });

  // ---- colours ----------------------------------------------------------------------------------
  const hex = (c) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(String(c));
    if (!m) return [255, 255, 255];
    const v = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    return [0, 2, 4].map((o) => parseInt(v.slice(o, o + 2), 16));
  };
  const lum = (c) => {
    const [r, g, b] = hex(c).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const onAccent = lum(p.accent) > 0.45 ? '#111111' : '#ffffff';
  const bgOf = (b) => (p.flip && b % 2 === 1 ? p.ink : p.bg);
  const inkOf = (b) => (p.flip && b % 2 === 1 ? p.bg : p.ink);

  // ---- textures (drawn once) --------------------------------------------------------------------
  const grain = new OffscreenCanvas(256, 256);
  {
    const g = grain.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = Math.floor(k.rand(i, 7) * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 22;
    }
    g.putImageData(img, 0, 0);
  }
  const bars = Array.from({ length: 34 }, (_, i) => 1 + Math.floor(k.rand(i, 11) * 3.2));

  function star(x, y, r, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, color);
    g.addColorStop(1, k.mix(color, '#000000', 0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    const q = r * 0.16;
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(q, -q, r, 0);
    ctx.quadraticCurveTo(q, q, 0, r);
    ctx.quadraticCurveTo(-q, q, -r, 0);
    ctx.quadraticCurveTo(-q, -q, 0, -r);
    ctx.fill();
    ctx.restore();
  }

  // Grounds (colour, grid, grain, vignette) are drawn once per colour pair and copied each frame:
  // blending a pattern every frame is not pixel-exact on a GPU canvas.
  const grounds = new Map();
  function baseGround(bg, ink) {
    const key = bg + '|' + ink;
    let c = grounds.get(key);
    if (c) return c;
    c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    if (p.style === 'Grid') {
      const step = 56 * s;
      g.strokeStyle = k.mix(ink, bg, 0.9);
      g.lineWidth = Math.max(1, 1.2 * s);
      g.beginPath();
      for (let x = (W / 2) % step; x < W; x += step) {
        g.moveTo(x, 0);
        g.lineTo(x, H);
      }
      for (let y = (H / 2) % step; y < H; y += step) {
        g.moveTo(0, y);
        g.lineTo(W, y);
      }
      g.stroke();
    }
    if (p.style !== 'Plain') {
      g.save();
      g.globalCompositeOperation = lum(bg) > 0.4 ? 'multiply' : 'screen';
      g.fillStyle = g.createPattern(grain, 'repeat');
      g.fillRect(0, 0, W, H);
      g.restore();
      const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, lum(bg) > 0.4 ? 'rgba(60,40,20,0.10)' : 'rgba(0,0,0,0.45)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }
    grounds.set(key, c);
    return c;
  }
  if (p.background) {
    baseGround(p.bg, p.ink);
    if (p.flip) baseGround(p.ink, p.bg);
  }

  function ground(b, bg, ink, t) {
    ctx.drawImage(baseGround(bg, ink), 0, 0);
    if (p.style === 'Glow') {
      const a = layouts[b].area;
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      const r = Math.max(W, H) * (0.55 + 0.04 * Math.sin(t * 1.3));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, k.mix(p.accent, 'transparent', 0.42));
      g.addColorStop(0.4, k.mix(p.accent, 'transparent', 0.78));
      g.addColorStop(1, k.mix(p.accent, 'transparent', 1));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function details(b, local, t, ink) {
    const d = p.decor;
    if (d === 'Editorial') {
      ctx.save();
      ctx.globalAlpha = 0.85;
      const bw = 190 * s;
      const bh = 48 * s;
      let x = W - pad - bw;
      const y = pad * 0.75;
      const unit = bw / bars.reduce((a, v) => a + v + 1, 0);
      ctx.fillStyle = ink;
      for (const v of bars) {
        ctx.fillRect(x, y, unit * v, bh);
        x += unit * (v + 1);
      }
      ctx.globalAlpha = 0.6;
      ctx.font = '600 ' + 22 * s + 'px "' + sans + '"';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText(String(p.label || '').toUpperCase(), pad, H - pad * 0.7);
      ctx.textAlign = 'right';
      ctx.fillText(String(b + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0'), W - pad, H - pad * 0.7);
      // Crop marks.
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1, 2 * s);
      const m = pad * 0.45;
      const L = 26 * s;
      ctx.beginPath();
      for (const [cx, cy, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
        ctx.moveTo(cx, cy + dy * L);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + dx * L, cy);
      }
      ctx.stroke();
      ctx.restore();
    } else if (d === 'Arcs & stars') {
      ctx.save();
      ctx.strokeStyle = k.mix(ink, 'transparent', 0.72);
      ctx.lineWidth = Math.max(1, 2 * s);
      const R = Math.max(W, H);
      ctx.beginPath();
      ctx.arc(-0.18 * W + Math.sin(t * 0.4) * 20 * s, 1.08 * H, R * 1.02, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(1.2 * W, -0.08 * H + Math.cos(t * 0.35) * 20 * s, R * 0.92, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const stars = [
        [0.14, 0.1, 74, 0],
        [0.88, 0.84, 52, 1.7],
        [0.84, 0.16, 28, 3.1],
      ];
      for (const [fx, fy, r, ph] of stars) star(W * fx, H * fy + Math.sin(t * 1.1 + ph) * 10 * s, r * s, t * 0.5 + ph, p.accent2);
    } else if (d === 'Orbits') {
      ctx.save();
      const cx = W / 2;
      const cy = H / 2;
      ctx.strokeStyle = k.mix(ink, 'transparent', 0.82);
      ctx.lineWidth = Math.max(1, 1.6 * s);
      const base = Math.min(W, H);
      [0.36, 0.52, 0.7].forEach((f, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, base * f, 0, Math.PI * 2);
        ctx.stroke();
        const a = t * (0.35 + i * 0.12) + i * 2.1;
        ctx.fillStyle = i === 1 ? p.accent : p.accent2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * base * f, cy + Math.sin(a) * base * f, (7 - i) * s, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    } else if (d === 'Ribbon') {
      ctx.save();
      const e = k.ease.inOutCubic(k.progress(local, 0, Math.min(1.1, beatLen * 0.6)));
      const g = ctx.createLinearGradient(0, H, W, 0);
      g.addColorStop(0, p.accent2);
      g.addColorStop(1, p.accent);
      ctx.strokeStyle = g;
      ctx.lineWidth = 64 * s;
      ctx.lineCap = 'round';
      const len = (W + H) * 2.2;
      ctx.setLineDash([len * e, len]);
      ctx.globalAlpha = 0.9;
      // Around the edges, clear of the words: in from one bottom corner, over the top, out the other side.
      const m = b % 2 ? -1 : 1;
      const X = (f) => (m > 0 ? f : 1 - f) * W;
      ctx.beginPath();
      ctx.moveTo(X(-0.12), H * 0.98);
      ctx.bezierCurveTo(X(0.02), H * 0.62, X(-0.02), H * 0.2, X(0.3), H * 0.1);
      ctx.bezierCurveTo(X(0.6), H * 0.01, X(0.95), H * 0.06, X(1.12), H * 0.34);
      ctx.stroke();
      ctx.restore();
    }
  }

  function ring(local, ink) {
    const e = k.ease.outCubic(k.progress(local, 0.05, Math.min(1, beatLen * 0.5)));
    if (e <= 0) return;
    ctx.save();
    ctx.translate(pic.x, pic.y);
    ctx.rotate(-Math.PI / 2 + local * 0.25);
    ctx.strokeStyle = k.mix(ink, 'transparent', 0.35);
    ctx.lineWidth = Math.max(2, 4 * s);
    ctx.lineCap = 'round';
    ctx.setLineDash([1, 14 * s]);
    ctx.beginPath();
    ctx.arc(0, 0, pic.r * 1.1, 0, Math.PI * 2 * e);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = p.accent;
    const a = Math.PI * 2 * e;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * pic.r * 1.1, Math.sin(a) * pic.r * 1.1, 9 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- words ----------------------------------------------------------------------------------
  function paint(w, text, ink, alpha, dx, dy, sc, blur, outline) {
    if (alpha <= 0.003) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.translate(w.x + w.w / 2 + dx, w.base - w.size * 0.34 + dy);
    if (sc !== 1) ctx.scale(sc, sc);
    if (blur > 0.4) ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';
    ctx.font = w.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const x0 = -w.w / 2;
    const yb = w.size * 0.34;
    if (w.kind === 'accent' && !outline) {
      if (p.accentStyle === 'Highlight') {
        const ph = w.size * 0.14;
        ctx.fillStyle = p.accent;
        ctx.fillRect(x0 - ph, yb - w.size * 0.84, w.w + ph * 2, w.size * 1.02);
        ctx.fillStyle = onAccent;
      } else if (p.accentStyle === 'Outline') {
        ctx.lineWidth = Math.max(2, w.size * 0.03);
        ctx.strokeStyle = p.accent;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, x0, yb);
        ctx.restore();
        return;
      } else {
        ctx.fillStyle = p.accent;
        if (p.glow) {
          ctx.shadowColor = p.accent;
          ctx.shadowBlur = w.size * 0.4;
        }
      }
    } else if (outline) {
      ctx.lineWidth = Math.max(1.5, w.size * 0.022);
      ctx.strokeStyle = p.accent;
      ctx.strokeText(text, x0, yb);
      ctx.restore();
      return;
    } else ctx.fillStyle = ink;
    ctx.fillText(text, x0, yb);
    ctx.restore();
  }

  return (t) => {
    const b = Math.min(n - 1, Math.max(0, Math.floor(t / beatLen)));
    const local = t - b * beatLen;
    const L = layouts[b];
    const bg = bgOf(b);
    const ink = inkOf(b);
    ctx.clearRect(0, 0, W, H);
    if (p.background) {
      ground(b, bg, ink, t);
      // Alternating light / dark: the new ground opens as a circle from the centre.
      if (p.flip && b > 0) {
        const e = k.ease.inOutCubic(k.progress(local, 0, 0.38));
        if (e < 1) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, W, H);
          ctx.arc(W / 2, H / 2, Math.hypot(W, H) * 0.55 * e, 0, Math.PI * 2, true);
          ctx.clip('evenodd');
          ground(b - 1, bgOf(b - 1), inkOf(b - 1), t);
          ctx.restore();
        }
      }
    }
    details(b, local, t, ink);
    if (hasPic(b) && p.ring) ring(local, ink);

    const motion = p.motion === 'Mixed' ? MOTIONS[b % MOTIONS.length] : p.motion;
    const inDur = Math.min(0.6, beatLen * 0.34);
    const stag = Math.min(0.09, (beatLen * 0.32) / Math.max(1, L.count));
    const outLen = Math.min(0.3, beatLen * 0.15);
    const last = b === n - 1;
    const out = last ? k.progress(local, beatLen - outLen * 1.8, beatLen) : k.progress(local, beatLen - outLen, beatLen);
    const fade = 1 - k.ease.inCubic(out);

    if (motion === 'Type') {
      const typed = Math.floor(k.progress(local, 0.05, Math.max(0.3, beatLen * 0.55)) * L.chars);
      let left = typed;
      let cursor = null;
      for (const row of L.rows) {
        for (const w of row.words) {
          if (left <= 0) break;
          const shown = w.text.slice(0, Math.max(0, left));
          left -= w.text.length + 1;
          paint(w, shown, ink, fade, 0, 0, 1, 0, false);
          ctx.font = w.font;
          cursor = { x: w.x + ctx.measureText(shown).width + w.size * 0.06, y: w.base, size: w.size };
        }
      }
      const blink = typed >= L.chars ? (Math.floor(local * 2.6) % 2 === 0 ? 1 : 0) : 1;
      if (cursor && blink) {
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.accent;
        ctx.fillRect(cursor.x, cursor.y - cursor.size * 0.78, Math.max(3, cursor.size * 0.07), cursor.size * 0.92);
        ctx.restore();
      }
      return;
    }

    for (const row of L.rows) {
      const masked = motion === 'Rise';
      if (masked) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, row.top - row.h * 0.12, W, row.h * 1.24);
        ctx.clip();
      }
      for (const w of row.words) {
        const st = w.i * stag;
        const lin = k.progress(local, st, st + inDur);
        const e = k.ease.outExpo(lin);
        if (lin <= 0) continue;
        if (motion === 'Rise') {
          paint(w, w.text, ink, 1, 0, (1 - e) * row.h - out * row.h * 1.1, 1, 0, false);
        } else if (motion === 'Blur') {
          paint(w, w.text, ink, e * fade, 0, 0, 1.12 - 0.12 * e, (1 - e) * 16 * s + out * 12 * s, false);
        } else if (motion === 'Punch') {
          const pe = k.ease.outBack(lin);
          paint(w, w.text, ink, Math.min(1, lin * 3) * fade, 0, 0, 1 + (1 - pe) * 0.7 - out * 0.08, 0, false);
        } else if (motion === 'Slide') {
          paint(w, w.text, ink, e * fade, (1 - e) * W * 0.22, 0, 1, (1 - e) * 10 * s, false);
        } else if (motion === 'Echo') {
          if (w.kind === 'accent') {
            for (let g = 3; g >= 1; g--) {
              const off = g * w.size * 0.74 * e;
              const a = (0.42 - g * 0.11) * e * fade;
              paint(w, w.text, ink, a, 0, -off, 1, 0, true);
              paint(w, w.text, ink, a, 0, off, 1, 0, true);
            }
          }
          paint(w, w.text, ink, e * fade, 0, (1 - e) * w.size * 0.5, 1, 0, false);
        }
      }
      if (masked) ctx.restore();
    }
  };
}
`,
  },
];

export default presets;
