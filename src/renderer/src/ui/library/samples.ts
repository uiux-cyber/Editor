/**
 * Sample pictures shown in the media placeholders of template thumbnails (and contact sheets), so
 * templates look like finished designs in the gallery. Drawn once, square (they are cropped to
 * cover each placeholder), soft and photographic rather than flat.
 */

import type { MediaAsset } from '@/core/types';

export const SAMPLE_SIZE = 720;
const S = SAMPLE_SIZE;

type Painter = (g: CanvasRenderingContext2D) => void;

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vertical(g: CanvasRenderingContext2D, stops: [number, string][], y0 = 0, y1 = S): void {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) grad.addColorStop(o, c);
  g.fillStyle = grad;
  g.fillRect(0, y0, S, y1 - y0);
}

function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha;
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
}

function ridge(g: CanvasRenderingContext2D, base: number, amp: number, seed: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, S);
  for (let x = 0; x <= S; x += 6) {
    const y = base - amp * (0.55 * Math.sin(x * 0.009 + seed) + 0.3 * Math.sin(x * 0.023 + seed * 2.3) + 0.15 * Math.sin(x * 0.051 + seed * 5.1));
    g.lineTo(x, y);
  }
  g.lineTo(S, S);
  g.closePath();
  g.fill();
}

function grain(g: CanvasRenderingContext2D, seed: number, amount = 0.05): void {
  const r = rand(seed);
  g.globalAlpha = amount;
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() < 0.5 ? '#ffffff' : '#000000';
    g.fillRect(r() * S, r() * S, 1.5, 1.5);
  }
  g.globalAlpha = 1;
}

function vignette(g: CanvasRenderingContext2D, strength = 0.45): void {
  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${strength})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
}

/** Golden hour over layered mountains and a lake. */
const mountains: Painter = (g) => {
  vertical(g, [
    [0, '#2a2f6b'],
    [0.42, '#b9567d'],
    [0.66, '#ffa25f'],
    [0.78, '#ffd89a'],
  ]);
  glow(g, S * 0.62, S * 0.6, S * 0.42, 'rgba(255,236,180,0.95)');
  ridge(g, S * 0.6, 70, 1.2, '#7b4b88');
  ridge(g, S * 0.66, 56, 3.4, '#4f3373');
  ridge(g, S * 0.72, 42, 5.9, '#2b2252');
  vertical(g, [
    [0, '#e98a63'],
    [1, '#1e1a44'],
  ], S * 0.74, S);
  g.globalAlpha = 0.5;
  g.fillStyle = '#ffe7b0';
  for (let i = 0; i < 12; i++) g.fillRect(S * 0.62 - 70 + i * 6 - i * i, S * 0.76 + i * 12, 140 - i * 10 + i * i * 2, 3);
  g.globalAlpha = 1;
  vignette(g, 0.35);
  grain(g, 1);
};

/** City skyline at night with out-of-focus lights. */
const city: Painter = (g) => {
  vertical(g, [
    [0, '#070a1f'],
    [0.6, '#1a2456'],
    [1, '#3b2a5c'],
  ]);
  const r = rand(7);
  glow(g, S * 0.5, S * 0.75, S * 0.6, 'rgba(255,120,170,0.35)');
  for (let layer = 0; layer < 3; layer++) {
    const shade = ['#141a3c', '#0e1230', '#080a1e'][layer];
    let x = -20;
    while (x < S) {
      const w = 40 + r() * 70;
      const h = S * (0.25 + r() * 0.35) * (1 - layer * 0.18);
      const top = S - h - layer * 10;
      g.fillStyle = shade;
      g.fillRect(x, top, w - 4, h + 20);
      g.fillStyle = layer === 2 ? 'rgba(255,214,140,0.85)' : 'rgba(255,214,140,0.45)';
      for (let wy = top + 10; wy < S - 10; wy += 14) for (let wx = x + 6; wx < x + w - 12; wx += 11) if (r() < 0.32) g.fillRect(wx, wy, 5, 7);
      x += w;
    }
  }
  // Bokeh in front.
  g.filter = 'blur(6px)';
  const colors = ['rgba(255,170,90,0.55)', 'rgba(255,90,150,0.45)', 'rgba(120,170,255,0.5)', 'rgba(255,230,160,0.55)'];
  for (let i = 0; i < 26; i++) {
    g.fillStyle = colors[i % colors.length];
    g.beginPath();
    g.arc(r() * S, S * 0.45 + r() * S * 0.55, 14 + r() * 34, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  vignette(g, 0.4);
  grain(g, 2);
};

/** A product on a podium in a soft studio. */
const studio: Painter = (g) => {
  vertical(g, [
    [0, '#f4d9c6'],
    [0.6, '#eab69b'],
    [1, '#c98d78'],
  ]);
  glow(g, S * 0.3, S * 0.2, S * 0.6, 'rgba(255,248,238,0.8)');
  // Floor.
  vertical(g, [
    [0, '#e3a98f'],
    [1, '#b97a66'],
  ], S * 0.7, S);
  // Podium.
  const cx = S * 0.5;
  const top = S * 0.62;
  g.fillStyle = '#f7e8dc';
  g.fillRect(cx - 170, top, 340, 120);
  const side = g.createLinearGradient(cx - 170, 0, cx + 170, 0);
  side.addColorStop(0, '#d9b6a1');
  side.addColorStop(0.35, '#fbefe6');
  side.addColorStop(1, '#caa08a');
  g.fillStyle = side;
  g.fillRect(cx - 170, top, 340, 120);
  g.fillStyle = '#fff6ef';
  g.beginPath();
  g.ellipse(cx, top, 170, 34, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(cx, top + 120, 170, 34, 0, 0, Math.PI);
  g.fillStyle = '#c69a84';
  g.fill();
  // Bottle.
  g.save();
  g.filter = 'blur(10px)';
  g.fillStyle = 'rgba(90,40,30,0.35)';
  g.beginPath();
  g.ellipse(cx + 30, top + 4, 90, 16, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  const body = g.createLinearGradient(cx - 60, 0, cx + 60, 0);
  body.addColorStop(0, '#5b2a3a');
  body.addColorStop(0.3, '#b0546a');
  body.addColorStop(0.55, '#7d3349');
  body.addColorStop(1, '#3b1826');
  g.fillStyle = body;
  g.beginPath();
  g.roundRect(cx - 58, top - 230, 116, 232, [26, 26, 14, 14]);
  g.fill();
  g.fillStyle = '#2b1a1f';
  g.beginPath();
  g.roundRect(cx - 26, top - 300, 52, 80, 8);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(cx - 34, top - 205, 10, 170);
  g.fillStyle = '#f6e6da';
  g.fillRect(cx - 46, top - 150, 92, 64);
  vignette(g, 0.18);
  grain(g, 3, 0.035);
};

/** A person in warm rim light (stylised). */
const portrait: Painter = (g) => {
  vertical(g, [
    [0, '#1d3a4a'],
    [1, '#4a2a52'],
  ]);
  glow(g, S * 0.78, S * 0.22, S * 0.5, 'rgba(255,170,110,0.65)');
  glow(g, S * 0.2, S * 0.85, S * 0.5, 'rgba(90,200,220,0.35)');
  const cx = S * 0.5;
  // Shoulders.
  const torso = g.createLinearGradient(0, S * 0.62, 0, S);
  torso.addColorStop(0, '#2a1f2c');
  torso.addColorStop(1, '#130e16');
  g.fillStyle = torso;
  g.beginPath();
  g.moveTo(cx - 260, S);
  g.bezierCurveTo(cx - 250, S * 0.78, cx - 150, S * 0.7, cx - 60, S * 0.68);
  g.lineTo(cx + 60, S * 0.68);
  g.bezierCurveTo(cx + 150, S * 0.7, cx + 250, S * 0.78, cx + 260, S);
  g.closePath();
  g.fill();
  // Neck and head.
  g.fillStyle = '#3a2a2e';
  g.fillRect(cx - 42, S * 0.52, 84, 110);
  const head = g.createRadialGradient(cx + 40, S * 0.36, 10, cx, S * 0.4, 150);
  head.addColorStop(0, '#c98a6c');
  head.addColorStop(0.5, '#7a4c45');
  head.addColorStop(1, '#2c1d22');
  g.fillStyle = head;
  g.beginPath();
  g.ellipse(cx, S * 0.4, 112, 140, 0, 0, Math.PI * 2);
  g.fill();
  // Hair.
  g.fillStyle = '#1b1216';
  g.beginPath();
  g.ellipse(cx - 6, S * 0.3, 124, 92, -0.1, Math.PI, Math.PI * 2.05);
  g.fill();
  // Rim light.
  g.strokeStyle = 'rgba(255,190,140,0.75)';
  g.lineWidth = 6;
  g.filter = 'blur(3px)';
  g.beginPath();
  g.ellipse(cx, S * 0.4, 112, 140, 0, -1.3, 0.6);
  g.stroke();
  g.filter = 'none';
  vignette(g, 0.4);
  grain(g, 4);
};

/** A beach in the afternoon. */
const beach: Painter = (g) => {
  vertical(g, [
    [0, '#3c8fd8'],
    [0.5, '#9fd4f2'],
  ], 0, S * 0.52);
  glow(g, S * 0.75, S * 0.18, S * 0.25, 'rgba(255,255,230,0.9)');
  vertical(g, [
    [0, '#2a7fb6'],
    [1, '#4cc3c9'],
  ], S * 0.5, S * 0.72);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 9; i++) g.fillRect(0, S * 0.53 + i * 18, S, 2);
  vertical(g, [
    [0, '#f3dfb4'],
    [1, '#d9b98a'],
  ], S * 0.7, S);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.moveTo(0, S * 0.71);
  for (let x = 0; x <= S; x += 10) g.lineTo(x, S * 0.715 + Math.sin(x * 0.03) * 6);
  g.lineTo(S, S * 0.735);
  g.lineTo(0, S * 0.735);
  g.fill();
  // Palm.
  g.strokeStyle = '#2b3a22';
  g.lineWidth = 16;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(S * 0.16, S);
  g.quadraticCurveTo(S * 0.12, S * 0.6, S * 0.24, S * 0.3);
  g.stroke();
  g.fillStyle = '#2f4a26';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + (i / 6) * Math.PI * 1.1 - 0.1;
    g.save();
    g.translate(S * 0.24, S * 0.3);
    g.rotate(a);
    g.beginPath();
    g.ellipse(80, 0, 90, 16, 0.25, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  vignette(g, 0.22);
  grain(g, 5, 0.035);
};

/** Misty forest hills. */
const forest: Painter = (g) => {
  vertical(g, [
    [0, '#c9dccb'],
    [1, '#7f9f8a'],
  ]);
  glow(g, S * 0.4, S * 0.25, S * 0.5, 'rgba(255,250,225,0.7)');
  const r = rand(11);
  const layers = ['#6f8f7a', '#4f725d', '#355643', '#1f3a2c'];
  layers.forEach((color, li) => {
    const base = S * (0.45 + li * 0.15);
    ridge(g, base, 30, li * 2.1 + 1, color);
    g.fillStyle = color;
    for (let x = -20; x < S + 20; x += 18 + r() * 16) {
      const h = 60 + r() * 80 + li * 20;
      const y = base - 10 + r() * 20;
      g.beginPath();
      g.moveTo(x, y - h);
      g.lineTo(x + 18 + li * 3, y + 10);
      g.lineTo(x - 18 - li * 3, y + 10);
      g.closePath();
      g.fill();
    }
    // Mist between layers.
    vertical(g, [
      [0, 'rgba(230,240,230,0)'],
      [1, 'rgba(230,240,230,0.35)'],
    ], base - 40, base + 30);
  });
  vignette(g, 0.3);
  grain(g, 6);
};

/** Coffee and pastry on a café table, from above. */
const cafe: Painter = (g) => {
  const wood = g.createLinearGradient(0, 0, S, S);
  wood.addColorStop(0, '#8a5a3c');
  wood.addColorStop(1, '#5a3622');
  g.fillStyle = wood;
  g.fillRect(0, 0, S, S);
  g.globalAlpha = 0.12;
  g.strokeStyle = '#2a170c';
  for (let y = 0; y < S; y += 9) {
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= S; x += 40) g.lineTo(x, y + Math.sin(x * 0.01 + y) * 3);
    g.stroke();
  }
  g.globalAlpha = 1;
  glow(g, S * 0.3, S * 0.2, S * 0.6, 'rgba(255,220,170,0.4)');
  const shadow = (x: number, y: number, r: number): void => {
    g.save();
    g.filter = 'blur(14px)';
    g.fillStyle = 'rgba(30,15,5,0.45)';
    g.beginPath();
    g.arc(x + 14, y + 18, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  // Cup.
  shadow(S * 0.42, S * 0.45, 140);
  g.fillStyle = '#f5efe8';
  g.beginPath();
  g.arc(S * 0.42, S * 0.45, 140, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(S * 0.42, S * 0.45, 92, 0, Math.PI * 2);
  g.fill();
  const coffee = g.createRadialGradient(S * 0.42, S * 0.45, 5, S * 0.42, S * 0.45, 76);
  coffee.addColorStop(0, '#c98d5a');
  coffee.addColorStop(0.6, '#7a4524');
  coffee.addColorStop(1, '#4a2612');
  g.fillStyle = coffee;
  g.beginPath();
  g.arc(S * 0.42, S * 0.45, 76, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,240,220,0.8)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(S * 0.42, S * 0.45 - 40);
  g.bezierCurveTo(S * 0.42 - 40, S * 0.45, S * 0.42 + 40, S * 0.45 + 10, S * 0.42, S * 0.45 + 46);
  g.stroke();
  // Plate with a croissant.
  shadow(S * 0.78, S * 0.8, 120);
  g.fillStyle = '#efe7de';
  g.beginPath();
  g.arc(S * 0.78, S * 0.8, 120, 0, Math.PI * 2);
  g.fill();
  const bun = g.createLinearGradient(S * 0.7, S * 0.72, S * 0.86, S * 0.88);
  bun.addColorStop(0, '#f2b45c');
  bun.addColorStop(1, '#a8601f');
  g.fillStyle = bun;
  g.beginPath();
  g.ellipse(S * 0.78, S * 0.8, 84, 42, -0.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(120,60,20,0.5)';
  g.lineWidth = 4;
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.ellipse(S * 0.78 + i * 20, S * 0.8 - i * 12, 12, 40, -0.5 + 1.2, 0, Math.PI);
    g.stroke();
  }
  vignette(g, 0.35);
  grain(g, 8, 0.04);
};

const PAINTERS: Painter[] = [mountains, city, studio, portrait, beach, forest, cafe];

/** A neutral sample logo (dark badge, light mark) that reads on light and dark designs. */
function drawLogo(g: CanvasRenderingContext2D): void {
  const c = S / 2;
  g.clearRect(0, 0, S, S);
  const badge = g.createLinearGradient(0, 0, S, S);
  badge.addColorStop(0, '#2a2d38');
  badge.addColorStop(1, '#101117');
  g.fillStyle = badge;
  g.beginPath();
  g.arc(c, c, S * 0.46, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = S * 0.012;
  g.stroke();
  // Four-pointed spark.
  g.fillStyle = '#ffffff';
  g.beginPath();
  const r = S * 0.27;
  const w = S * 0.06;
  g.moveTo(c, c - r);
  g.quadraticCurveTo(c + w, c - w, c + r, c);
  g.quadraticCurveTo(c + w, c + w, c, c + r);
  g.quadraticCurveTo(c - w, c + w, c - r, c);
  g.quadraticCurveTo(c - w, c - w, c, c - r);
  g.fill();
}
let logoCanvas: HTMLCanvasElement | null = null;

/** The sample logo picture. */
export function sampleLogoPicture(): HTMLCanvasElement {
  if (!logoCanvas) {
    logoCanvas = document.createElement('canvas');
    logoCanvas.width = S;
    logoCanvas.height = S;
    drawLogo(logoCanvas.getContext('2d')!);
  }
  return logoCanvas;
}
export const SAMPLE_LOGO_ID = 'sample-logo';

/**
 * A person cut out of their background (transparent around them), for "Person" placeholders of
 * thumbnail designs, where Kinora removes the background of the photo people drop in.
 */
function drawPerson(g: CanvasRenderingContext2D, variant: number): void {
  g.clearRect(0, 0, S, S);
  const cx = S / 2;
  const skin = ['#e0a382', '#b97a57', '#8a5a3c', '#f1c3a1'][variant % 4];
  const shade = ['#b9785c', '#8f5a3d', '#64402a', '#d49a78'][variant % 4];
  const hair = ['#2a1a14', '#151010', '#4a2c1a', '#7a4b26'][variant % 4];
  const shirt = ['#2f6fed', '#e24a5b', '#1fa37a', '#f2b233'][variant % 4];
  // Shoulders and shirt.
  const body = g.createLinearGradient(0, S * 0.62, 0, S);
  body.addColorStop(0, shirt);
  body.addColorStop(1, '#101216');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(cx - 290, S);
  g.bezierCurveTo(cx - 280, S * 0.76, cx - 170, S * 0.68, cx - 70, S * 0.665);
  g.lineTo(cx + 70, S * 0.665);
  g.bezierCurveTo(cx + 170, S * 0.68, cx + 280, S * 0.76, cx + 290, S);
  g.closePath();
  g.fill();
  // Collar.
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.moveTo(cx - 70, S * 0.665);
  g.lineTo(cx, S * 0.75);
  g.lineTo(cx + 70, S * 0.665);
  g.closePath();
  g.fill();
  // Neck.
  g.fillStyle = shade;
  g.fillRect(cx - 46, S * 0.5, 92, S * 0.18);
  // Head.
  const face = g.createRadialGradient(cx - 30, S * 0.34, 20, cx, S * 0.38, 170);
  face.addColorStop(0, skin);
  face.addColorStop(1, shade);
  g.fillStyle = face;
  g.beginPath();
  g.ellipse(cx, S * 0.37, 118, 150, 0, 0, Math.PI * 2);
  g.fill();
  // Ears.
  g.fillStyle = shade;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + side * 116, S * 0.39, 20, 34, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Hair.
  g.fillStyle = hair;
  g.beginPath();
  g.moveTo(cx - 124, S * 0.36);
  g.bezierCurveTo(cx - 140, S * 0.12, cx + 120, S * 0.08, cx + 126, S * 0.34);
  g.bezierCurveTo(cx + 90, S * 0.22, cx - 40, S * 0.24, cx - 124, S * 0.36);
  g.fill();
  // Surprised face: brows up, round eyes, open mouth (the thumbnail classic).
  g.fillStyle = '#1b1210';
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + side * 44, S * 0.36, 15, 19, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx + side * 44 + 5, S * 0.352, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1210';
    g.save();
    g.translate(cx + side * 46, S * 0.3);
    g.rotate(side * -0.18);
    g.fillRect(-26, -5, 52, 10);
    g.restore();
  }
  g.fillStyle = '#5a1c1c';
  g.beginPath();
  g.ellipse(cx, S * 0.465, 30, 38, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f6efe8';
  g.fillRect(cx - 22, S * 0.43, 44, 9);
}
const people = new Map<number, HTMLCanvasElement>();

/** A sample person cut out of the background (several looks). */
export function samplePersonPicture(variant: number): HTMLCanvasElement {
  const v = ((variant % 4) + 4) % 4;
  let c = people.get(v);
  if (!c) {
    c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    drawPerson(c.getContext('2d')!, v);
    people.set(v, c);
  }
  return c;
}
export const samplePersonId = (variant: number): string => `sample-person-${((variant % 4) + 4) % 4}`;
export const samplePersonIndex = (assetId: string): number | null => (/^sample-person-(\d)$/.test(assetId) ? Number(assetId.slice(14)) : null);

/** A sample person as a media asset of a thumbnail project. */
export function samplePersonAsset(variant: number): MediaAsset {
  return { ...sampleAsset(0), id: samplePersonId(variant), name: 'Sample person' };
}
export const SAMPLE_COUNT = PAINTERS.length;

const canvases = new Map<number, HTMLCanvasElement>();

/** The n-th sample picture (drawn on first use). */
export function samplePicture(n: number): HTMLCanvasElement {
  const i = ((n % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT;
  let c = canvases.get(i);
  if (!c) {
    c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    PAINTERS[i](c.getContext('2d')!);
    canvases.set(i, c);
  }
  return c;
}

export const sampleAssetId = (n: number): string => `sample-${((n % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT}`;
export const sampleIndex = (assetId: string): number | null => (/^sample-(\d+)$/.test(assetId) ? Number(assetId.slice(7)) : null);

/** A sample picture (or, with n = -1, the sample logo) as a media asset of a thumbnail project. */
export function sampleAsset(n: number): MediaAsset {
  return {
    id: n < 0 ? SAMPLE_LOGO_ID : sampleAssetId(n),
    kind: 'image',
    name: 'Sample picture',
    source: { type: 'file', path: '' },
    duration: 0,
    width: S,
    height: S,
    fps: 0,
    hasVideo: false,
    hasAudio: false,
    size: 0,
    addedAt: 0,
  };
}
