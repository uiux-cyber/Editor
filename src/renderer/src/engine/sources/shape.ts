import { tracePath } from '@/core/path';
import type { ID, PathData, ShapeClip, ShapeKind, ShapeStyle } from '@/core/types';
import { MAX_RASTER, ctx2d, hashKey, makeCanvas, nextVersion, paintStyle, roundRectPath, type Ctx2D, type Raster } from './raster';

function polygon(ctx: Ctx2D | Path2D, cx: number, cy: number, rx: number, ry: number, sides: number, rotation = -Math.PI / 2): void {
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function star(ctx: Ctx2D | Path2D, cx: number, cy: number, rx: number, ry: number, points: number, inner: number): void {
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const k = i % 2 === 0 ? 1 : inner;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Build the outline of a shape inside the box (0,0)-(w,h). Returns the fill rule to use.
 * `path` is the pen-tool path of kind 'path' (normalised to the box).
 */
export function shapePath(ctx: Ctx2D | Path2D, kind: ShapeKind, w: number, h: number, radius: number, path?: PathData): CanvasFillRule {
  const cx = w / 2;
  const cy = h / 2;
  switch (kind) {
    case 'path':
      if (path && path.points.length > 1) tracePath(ctx, path, w, h);
      else ctx.rect(0, 0, w, h);
      return 'nonzero';
    case 'rect':
      roundRectPath(ctx, 0, 0, w, h, radius);
      return 'nonzero';
    case 'pill':
      roundRectPath(ctx, 0, 0, w, h, Math.min(w, h) / 2);
      return 'nonzero';
    case 'ellipse':
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
      return 'nonzero';
    case 'triangle':
      ctx.moveTo(cx, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      return 'nonzero';
    case 'diamond':
      polygon(ctx, cx, cy, w / 2, h / 2, 4);
      return 'nonzero';
    case 'pentagon':
      polygon(ctx, cx, cy, w / 2, h / 2, 5);
      return 'nonzero';
    case 'hexagon':
      polygon(ctx, cx, cy, w / 2, h / 2, 6, 0);
      return 'nonzero';
    case 'octagon':
      polygon(ctx, cx, cy, w / 2, h / 2, 8, Math.PI / 8);
      return 'nonzero';
    case 'star':
      star(ctx, cx, cy, w / 2, h / 2, 5, 0.42);
      return 'nonzero';
    case 'burst':
      star(ctx, cx, cy, w / 2, h / 2, 16, 0.8);
      return 'nonzero';
    case 'heart': {
      const top = h * 0.3;
      ctx.moveTo(cx, h);
      ctx.bezierCurveTo(cx - w * 0.75, h * 0.6, cx - w * 0.55, -h * 0.1, cx - w * 0.25, h * 0.02);
      ctx.bezierCurveTo(cx - w * 0.1, h * 0.07, cx - w * 0.02, top * 0.7, cx, top);
      ctx.bezierCurveTo(cx + w * 0.02, top * 0.7, cx + w * 0.1, h * 0.07, cx + w * 0.25, h * 0.02);
      ctx.bezierCurveTo(cx + w * 0.55, -h * 0.1, cx + w * 0.75, h * 0.6, cx, h);
      ctx.closePath();
      return 'nonzero';
    }
    case 'arrow': {
      const head = Math.min(w * 0.45, h * 0.9);
      const shaft = h * 0.36;
      ctx.moveTo(0, cy - shaft / 2);
      ctx.lineTo(w - head, cy - shaft / 2);
      ctx.lineTo(w - head, 0);
      ctx.lineTo(w, cy);
      ctx.lineTo(w - head, h);
      ctx.lineTo(w - head, cy + shaft / 2);
      ctx.lineTo(0, cy + shaft / 2);
      ctx.closePath();
      return 'nonzero';
    }
    case 'chevron': {
      const t = Math.min(w * 0.45, h * 0.5);
      ctx.moveTo(0, 0);
      ctx.lineTo(t, 0);
      ctx.lineTo(w, cy);
      ctx.lineTo(t, h);
      ctx.lineTo(0, h);
      ctx.lineTo(w - t, cy);
      ctx.closePath();
      return 'nonzero';
    }
    case 'line':
      roundRectPath(ctx, 0, 0, w, h, Math.min(w, h) / 2);
      return 'nonzero';
    case 'cross': {
      const tw = w * 0.3;
      const th = h * 0.3;
      ctx.moveTo(cx - tw / 2, 0);
      ctx.lineTo(cx + tw / 2, 0);
      ctx.lineTo(cx + tw / 2, cy - th / 2);
      ctx.lineTo(w, cy - th / 2);
      ctx.lineTo(w, cy + th / 2);
      ctx.lineTo(cx + tw / 2, cy + th / 2);
      ctx.lineTo(cx + tw / 2, h);
      ctx.lineTo(cx - tw / 2, h);
      ctx.lineTo(cx - tw / 2, cy + th / 2);
      ctx.lineTo(0, cy + th / 2);
      ctx.lineTo(0, cy - th / 2);
      ctx.lineTo(cx - tw / 2, cy - th / 2);
      ctx.closePath();
      return 'nonzero';
    }
    case 'bubble': {
      const bodyH = h * 0.78;
      const r = Math.min(radius > 0 ? radius : Math.min(w, bodyH) * 0.22, w / 2, bodyH / 2);
      ctx.moveTo(r, 0);
      ctx.lineTo(w - r, 0);
      ctx.arcTo(w, 0, w, r, r);
      ctx.lineTo(w, bodyH - r);
      ctx.arcTo(w, bodyH, w - r, bodyH, r);
      ctx.lineTo(w * 0.42, bodyH);
      ctx.lineTo(w * 0.22, h);
      ctx.lineTo(w * 0.26, bodyH);
      ctx.lineTo(r, bodyH);
      ctx.arcTo(0, bodyH, 0, bodyH - r, r);
      ctx.lineTo(0, r);
      ctx.arcTo(0, 0, r, 0, r);
      ctx.closePath();
      return 'nonzero';
    }
    case 'ring': {
      const t = Math.min(w, h) * 0.14;
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
      ctx.moveTo(cx + w / 2 - t, cy);
      ctx.ellipse(cx, cy, Math.max(0.1, w / 2 - t), Math.max(0.1, h / 2 - t), 0, 0, Math.PI * 2);
      ctx.closePath();
      return 'evenodd';
    }
    case 'frame': {
      const t = Math.min(w, h) * 0.06;
      roundRectPath(ctx, 0, 0, w, h, radius);
      roundRectPath(ctx, t, t, w - t * 2, h - t * 2, Math.max(0, radius - t));
      return 'evenodd';
    }
    case 'blob': {
      // Smooth organic outline: a circle perturbed by a few fixed harmonics.
      const n = 48;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = 0.86 + 0.07 * Math.sin(a * 2 + 0.6) + 0.05 * Math.sin(a * 3 + 2.1) + 0.03 * Math.cos(a * 5 + 1.3);
        pts.push([cx + Math.cos(a) * (w / 2) * k, cy + Math.sin(a) * (h / 2) * k]);
      }
      for (let i = 0; i < n; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % n];
        const mx = (p0[0] + p1[0]) / 2;
        const my = (p0[1] + p1[1]) / 2;
        if (i === 0) ctx.moveTo(mx, my);
        const p2 = pts[(i + 2) % n];
        ctx.quadraticCurveTo(p1[0], p1[1], (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
      }
      ctx.closePath();
      return 'nonzero';
    }
    default:
      ctx.rect(0, 0, w, h);
      return 'nonzero';
  }
}

function drawSlotHint(ctx: Ctx2D, w: number, h: number, radius: number): void {
  const s = Math.min(w, h);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(2, s * 0.008);
  ctx.setLineDash([s * 0.035, s * 0.025]);
  const inset = ctx.lineWidth;
  ctx.beginPath();
  roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, Math.max(0, radius - inset));
  ctx.stroke();
  ctx.setLineDash([]);
  // Picture glyph: frame, sun and mountains.
  const iw = Math.min(s * 0.3, 220);
  const ih = iw * 0.74;
  const ix = (w - iw) / 2;
  const iy = (h - ih) / 2 - s * 0.03;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = Math.max(2, iw * 0.06);
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  roundRectPath(ctx, ix, iy, iw, ih, iw * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ix + iw * 0.3, iy + ih * 0.33, iw * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ix + iw * 0.12, iy + ih * 0.86);
  ctx.lineTo(ix + iw * 0.42, iy + ih * 0.52);
  ctx.lineTo(ix + iw * 0.58, iy + ih * 0.7);
  ctx.lineTo(ix + iw * 0.72, iy + ih * 0.56);
  ctx.lineTo(ix + iw * 0.9, iy + ih * 0.86);
  ctx.closePath();
  ctx.fill();
  if (s > 260) {
    ctx.font = `600 ${Math.max(14, Math.min(34, s * 0.045))}px "Inter Variable", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Drop media here', w / 2, iy + ih + s * 0.035);
  }
  ctx.restore();
}

/** Line width (design px) of an open path that has no outline of its own. */
const OPEN_PATH_WIDTH = 6;

export class ShapeRenderer {
  private cache = new Map<ID, { key: string; raster: Raster }>();

  render(clip: ShapeClip, rasterScale: number): Raster {
    const shape: ShapeStyle = clip.shape;
    // Open pen paths are lines: stroked only (with the fill paint when they have no outline).
    const openPath = shape.kind === 'path' && !!shape.path && !shape.path.closed;
    const strokeW = shape.stroke ? shape.stroke.width : openPath ? OPEN_PATH_WIDTH : 0;
    const shadowPad = shape.shadow ? Math.max(Math.abs(shape.shadow.x), Math.abs(shape.shadow.y)) + shape.shadow.blur * 1.3 : 0;
    const padD = Math.max(strokeW / 2, shadowPad) + 2;
    let rs = Math.max(0.05, rasterScale);
    const over = (Math.max(shape.width, shape.height) + padD * 2) * rs / MAX_RASTER;
    if (over > 1) rs /= over;

    const key = hashKey(`${JSON.stringify(shape)}|${rs.toFixed(4)}`);
    const cached = this.cache.get(clip.id);
    if (cached && cached.key === key) return cached.raster;

    const pad = Math.ceil(padD * rs);
    const w = Math.max(1, shape.width * rs);
    const h = Math.max(1, shape.height * rs);
    const W = Math.ceil(w) + pad * 2;
    const H = Math.ceil(h) + pad * 2;
    const canvas = cached && cached.raster.canvas.width === W && cached.raster.canvas.height === H ? cached.raster.canvas : makeCanvas(W, H);
    const ctx = ctx2d(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(pad, pad);

    const path = new Path2D();
    const rule = shapePath(path, shape.kind, w, h, shape.radius * rs, shape.path);
    ctx.fillStyle = paintStyle(ctx, shape.fill, 0, 0, w, h);
    ctx.save();
    if (shape.shadow) {
      ctx.shadowColor = shape.shadow.color;
      ctx.shadowBlur = shape.shadow.blur * rs * 2;
      ctx.shadowOffsetX = shape.shadow.x * rs;
      ctx.shadowOffsetY = shape.shadow.y * rs;
    }
    if (openPath) {
      ctx.strokeStyle = shape.stroke ? shape.stroke.color : paintStyle(ctx, shape.fill, 0, 0, w, h);
      ctx.lineWidth = strokeW * rs;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (strokeW > 0) ctx.stroke(path);
    } else {
      ctx.fill(path, rule);
    }
    ctx.restore();
    if (shape.stroke && strokeW > 0 && !openPath) {
      ctx.strokeStyle = shape.stroke.color;
      ctx.lineWidth = strokeW * rs;
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }
    if (shape.slot) drawSlotHint(ctx, w, h, shape.radius * rs);

    const raster: Raster = { canvas, width: W / rs, height: H / rs, contentW: shape.width, contentH: shape.height, version: nextVersion(), static: true };
    this.cache.set(clip.id, { key, raster });
    return raster;
  }

  prune(alive: ReadonlySet<ID>): void {
    for (const id of this.cache.keys()) if (!alive.has(id)) this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}
