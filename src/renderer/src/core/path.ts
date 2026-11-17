/**
 * Bezier paths drawn with the pen tool (`ShapeStyle.path`, shape kind 'path').
 *
 * Stored paths are normalised to the shape's own box: point coordinates and handle offsets are
 * fractions (0..1) of the box width / height. Editing happens on "absolute" points (design px,
 * handles as offsets from their point); `normalizePath` turns those back into a box + PathData.
 * Pure functions — no DOM — shared by the renderer, the pen overlay and the tests.
 */

import type { PathData, PathPoint } from './types';

export interface Vec {
  x: number;
  y: number;
}

/** A path point in absolute units; handles are offsets from the point (null = sharp corner). */
export interface AbsPoint {
  x: number;
  y: number;
  in: Vec | null;
  out: Vec | null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A cubic segment: start, control 1, control 2, end. */
export type Cubic = [Vec, Vec, Vec, Vec];

const EPS = 1e-9;
const isZero = (v: Vec | null | undefined): boolean => !v || (Math.abs(v.x) < EPS && Math.abs(v.y) < EPS);

export const clonePoints = (points: AbsPoint[]): AbsPoint[] =>
  points.map((p) => ({ x: p.x, y: p.y, in: p.in ? { ...p.in } : null, out: p.out ? { ...p.out } : null }));

/** Stored path → absolute points inside a box of `w` × `h`. */
export function toAbsolute(path: PathData, w: number, h: number): AbsPoint[] {
  return path.points.map((p) => ({
    x: p.x * w,
    y: p.y * h,
    in: p.inX !== undefined || p.inY !== undefined ? { x: (p.inX ?? 0) * w, y: (p.inY ?? 0) * h } : null,
    out: p.outX !== undefined || p.outY !== undefined ? { x: (p.outX ?? 0) * w, y: (p.outY ?? 0) * h } : null,
  }));
}

/** Absolute points (relative to the box origin) → stored points for a box of `w` × `h`. */
export function fromAbsolute(points: AbsPoint[], w: number, h: number): PathPoint[] {
  const W = Math.max(EPS, w);
  const H = Math.max(EPS, h);
  const r = (v: number): number => Math.round(v * 1e6) / 1e6;
  return points.map((p) => {
    const out: PathPoint = { x: r(p.x / W), y: r(p.y / H) };
    if (!isZero(p.in)) {
      out.inX = r(p.in!.x / W);
      out.inY = r(p.in!.y / H);
    }
    if (!isZero(p.out)) {
      out.outX = r(p.out!.x / W);
      out.outY = r(p.out!.y / H);
    }
    return out;
  });
}

/** The cubic segments of a path (a closed path also has the segment from the last point back to the first). */
export function cubicSegments(points: AbsPoint[], closed: boolean): Cubic[] {
  const out: Cubic[] = [];
  const n = points.length;
  const count = closed && n > 2 ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push([
      { x: a.x, y: a.y },
      { x: a.x + (a.out?.x ?? 0), y: a.y + (a.out?.y ?? 0) },
      { x: b.x + (b.in?.x ?? 0), y: b.y + (b.in?.y ?? 0) },
      { x: b.x, y: b.y },
    ]);
  }
  return out;
}

export function cubicAt(c: Cubic, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}

/** Parameters in (0, 1) where one coordinate of the cubic has a local extremum. */
function extremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  // Derivative: 3[(p1-p0)(1-t)^2 + 2(p2-p1)(1-t)t + (p3-p2)t^2] → a t^2 + b t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** Tight bounding box of a path (curves included, handles excluded). */
export function pathBounds(points: AbsPoint[], closed: boolean): Box {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (v: Vec): void => {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  };
  for (const p of points) add(p);
  for (const c of cubicSegments(points, closed)) {
    for (const t of [...extremaT(c[0].x, c[1].x, c[2].x, c[3].x), ...extremaT(c[0].y, c[1].y, c[2].y, c[3].y)]) add(cubicAt(c, t));
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Normalise absolute points to their bounding box. Returns the box (absolute) and the stored path.
 * A degenerate axis (e.g. a perfectly horizontal line) is given `minSize` so the path stays
 * renderable; the points then sit in the middle of that axis.
 */
export function normalizePath(points: AbsPoint[], closed: boolean, minSize = 1): { box: Box; path: PathData } {
  const b = pathBounds(points, closed);
  const box: Box = { ...b };
  if (box.w < minSize) {
    box.x -= (minSize - box.w) / 2;
    box.w = minSize;
  }
  if (box.h < minSize) {
    box.y -= (minSize - box.h) / 2;
    box.h = minSize;
  }
  const rel = points.map((p) => ({ ...p, x: p.x - box.x, y: p.y - box.y }));
  return { box, path: { points: fromAbsolute(rel, box.w, box.h), closed: closed && points.length > 2 } };
}

interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
}

/** Trace a stored path, scaled to a `w` × `h` box, into a canvas context or Path2D. */
export function tracePath(ctx: PathSink, path: PathData, w: number, h: number): void {
  const pts = toAbsolute(path, w, h);
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  const n = pts.length;
  const count = path.closed && n > 2 ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (isZero(a.out) && isZero(b.in)) ctx.lineTo(b.x, b.y);
    else ctx.bezierCurveTo(a.x + (a.out?.x ?? 0), a.y + (a.out?.y ?? 0), b.x + (b.in?.x ?? 0), b.y + (b.in?.y ?? 0), b.x, b.y);
  }
  if (path.closed && n > 2) ctx.closePath();
}

/** Closest point on the path to `q`: segment index (from point `index` to the next), parameter and distance. */
export function nearestOnPath(points: AbsPoint[], closed: boolean, q: Vec): { index: number; t: number; x: number; y: number; dist: number } | null {
  const segs = cubicSegments(points, closed);
  let best: { index: number; t: number; x: number; y: number; dist: number } | null = null;
  segs.forEach((c, index) => {
    const steps = 48;
    let bt = 0;
    let bd = Infinity;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = cubicAt(c, t);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bd) {
        bd = d;
        bt = t;
      }
    }
    // Refine around the best sample.
    let lo = Math.max(0, bt - 1 / steps);
    let hi = Math.min(1, bt + 1 / steps);
    for (let k = 0; k < 24; k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      const p1 = cubicAt(c, m1);
      const p2 = cubicAt(c, m2);
      if (Math.hypot(p1.x - q.x, p1.y - q.y) < Math.hypot(p2.x - q.x, p2.y - q.y)) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const p = cubicAt(c, t);
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || dist < best.dist) best = { index, t, x: p.x, y: p.y, dist };
  });
  return best;
}

/** Insert a point on segment `index` at parameter `t` without changing the shape (de Casteljau). */
export function insertPoint(points: AbsPoint[], closed: boolean, index: number, t: number): AbsPoint[] {
  const out = clonePoints(points);
  const n = out.length;
  const a = out[index];
  const bi = (index + 1) % n;
  const b = out[bi];
  const straight = isZero(a.out) && isZero(b.in);
  const [p0, p1, p2, p3] = cubicSegments(points, closed)[index];
  const lerp = (u: Vec, v: Vec): Vec => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const q0 = lerp(p0, p1);
  const q1 = lerp(p1, p2);
  const q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1);
  const r1 = lerp(q1, q2);
  const s = lerp(r0, r1);
  const mid: AbsPoint = straight ? { x: s.x, y: s.y, in: null, out: null } : { x: s.x, y: s.y, in: { x: r0.x - s.x, y: r0.y - s.y }, out: { x: r1.x - s.x, y: r1.y - s.y } };
  if (!straight) {
    a.out = { x: q0.x - p0.x, y: q0.y - p0.y };
    b.in = { x: q2.x - p3.x, y: q2.y - p3.y };
  }
  out.splice(index + 1, 0, mid);
  return out;
}

/** Handles that make point `i` smooth: tangent along its neighbours, a third of each neighbour's distance. */
export function smoothHandles(points: AbsPoint[], closed: boolean, i: number): { in: Vec | null; out: Vec | null } {
  const n = points.length;
  const p = points[i];
  const prev = i > 0 ? points[i - 1] : closed && n > 2 ? points[n - 1] : null;
  const next = i < n - 1 ? points[i + 1] : closed && n > 2 ? points[0] : null;
  if (!prev && !next) return { in: null, out: null };
  const tx = (next ?? p).x - (prev ?? p).x;
  const ty = (next ?? p).y - (prev ?? p).y;
  const len = Math.hypot(tx, ty);
  if (len < EPS) return { in: null, out: null };
  const ux = tx / len;
  const uy = ty / len;
  const dPrev = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) / 3 : 0;
  const dNext = next ? Math.hypot(next.x - p.x, next.y - p.y) / 3 : 0;
  return {
    in: prev ? { x: -ux * dPrev, y: -uy * dPrev } : null,
    out: next ? { x: ux * dNext, y: uy * dNext } : null,
  };
}

export const isSmooth = (p: AbsPoint | PathPoint): boolean =>
  'in' in p ? !isZero(p.in) || !isZero(p.out) : p.inX !== undefined || p.inY !== undefined || p.outX !== undefined || p.outY !== undefined;

/** Toggle point `i` between a sharp corner and a smooth point. */
export function toggleSmooth(points: AbsPoint[], closed: boolean, i: number): AbsPoint[] {
  const out = clonePoints(points);
  const p = out[i];
  if (isSmooth(p)) {
    p.in = null;
    p.out = null;
  } else {
    const h = smoothHandles(points, closed, i);
    p.in = h.in;
    p.out = h.out;
  }
  return out;
}

/** Remove point `i`. Paths keep at least two points; a closed path with fewer than three opens. */
export function removePoint(points: AbsPoint[], closed: boolean, i: number): { points: AbsPoint[]; closed: boolean } | null {
  if (points.length <= 2) return null;
  const out = clonePoints(points);
  out.splice(i, 1);
  return { points: out, closed: closed && out.length > 2 };
}

/** Constrain `v` (relative to `from`) to the nearest multiple of 45°. */
export function constrain45(from: Vec, v: Vec): Vec {
  const dx = v.x - from.x;
  const dy = v.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return { ...v };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}
