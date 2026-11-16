import type { StickerDef } from '../types';

/** Reference stickers. Further packs live next to this file. */
const stickers: StickerDef[] = [
  { id: 'emoji-1f525', kind: 'emoji', char: '🔥', name: 'Fire', category: 'nature', keywords: ['fire', 'flame', 'hot', 'lit'] },
  {
    id: 'pulse-heart',
    kind: 'canvas',
    name: 'Beating Heart',
    category: 'animated',
    keywords: ['heart', 'love', 'like', 'beat', 'pulse'],
    aspect: 1,
    animated: true,
    period: 1,
    colors: ['#ff3b6b', '#ff8aa8'],
    draw: (ctx, t, env) => {
      const phase = (t % 1) / 1;
      // Two quick beats followed by a rest, like a heartbeat.
      const beat = Math.max(0, Math.sin(phase * Math.PI * 4)) * (phase < 0.5 ? 1 : 0);
      const s = 0.8 + 0.1 * beat;
      const cx = env.w / 2;
      const cy = env.h / 2 + 8;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      const g = ctx.createLinearGradient(0, -100, 0, 110);
      g.addColorStop(0, env.colors[1] ?? '#ff8aa8');
      g.addColorStop(1, env.colors[0] ?? '#ff3b6b');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 100);
      ctx.bezierCurveTo(-130, 10, -110, -110, -50, -100);
      ctx.bezierCurveTo(-20, -96, -5, -76, 0, -56);
      ctx.bezierCurveTo(5, -76, 20, -96, 50, -100);
      ctx.bezierCurveTo(110, -110, 130, 10, 0, 100);
      ctx.closePath();
      ctx.fill();
      // Specular highlight
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(-52, -56, 20, 12, -0.6, 0, Math.PI * 2);
      ctx.fill();
    },
  },
];

export default stickers;
