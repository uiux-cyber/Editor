/**
 * Path-shape editing helpers shared by the pen overlay and the inspector: mapping between the
 * shape's own coordinates and design space, creating a path clip, and writing edited points back
 * (re-normalising the box while keeping the path where it is on screen).
 */

import { linear } from '@/core/factory';
import { propAt } from '@/core/keyframes';
import { normalizePath, toAbsolute, type AbsPoint, type Vec } from '@/core/path';
import type { ID, ShapeClip, VisualClip } from '@/core/types';
import type { LayerBox } from '@/engine/compositor';
import { engine } from '@/engine/engine';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { addShape, editClips } from '../../actions';

/** Smallest box side of a path (design px), so straight lines stay renderable. */
export const MIN_PATH_BOX = 2;

/** Affine frame of a shape layer: shape-space point (x, y) → origin + ex·x + ey·y in design px. */
export interface ShapeFrame {
  origin: Vec;
  ex: Vec;
  ey: Vec;
}

const sign = (v: number): number => (v < 0 ? -1 : 1);

/** Signed horizontal / vertical mirroring of a clip at a local time (negative scale or flips). */
function mirror(clip: VisualClip, t: number): { x: number; y: number } {
  return { x: sign(propAt(clip, 'scaleX', t)) * (clip.flipH ? -1 : 1), y: sign(propAt(clip, 'scaleY', t)) * (clip.flipV ? -1 : 1) };
}

/** The frame of a shape as it was last rendered (`box` from engine.layerBox). */
export function shapeFrame(clip: ShapeClip, box: LayerBox, t: number): ShapeFrame {
  const W = Math.max(1e-6, clip.shape.width);
  const H = Math.max(1e-6, clip.shape.height);
  const m = mirror(clip, t);
  const ssx = (m.x * box.w) / W;
  const ssy = (m.y * box.h) / H;
  const rad = (box.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const ex = { x: c * ssx, y: s * ssx };
  const ey = { x: -s * ssy, y: c * ssy };
  return { origin: { x: box.cx - ex.x * (W / 2) - ey.x * (H / 2), y: box.cy - ex.y * (W / 2) - ey.y * (H / 2) }, ex, ey };
}

export const frameToDesign = (f: ShapeFrame, p: Vec): Vec => ({ x: f.origin.x + f.ex.x * p.x + f.ey.x * p.y, y: f.origin.y + f.ex.y * p.x + f.ey.y * p.y });
export const frameVecToDesign = (f: ShapeFrame, v: Vec): Vec => ({ x: f.ex.x * v.x + f.ey.x * v.y, y: f.ex.y * v.x + f.ey.y * v.y });

/** Inverse mapping of a design-space vector (no origin). */
export function designVecToFrame(f: ShapeFrame, v: Vec): Vec {
  const det = f.ex.x * f.ey.y - f.ey.x * f.ex.y;
  if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
  return { x: (v.x * f.ey.y - f.ey.x * v.y) / det, y: (f.ex.x * v.y - v.x * f.ex.y) / det };
}

export const designToFrame = (f: ShapeFrame, p: Vec): Vec => designVecToFrame(f, { x: p.x - f.origin.x, y: p.y - f.origin.y });

/** Absolute points of a path shape in its own (unscaled) coordinates. */
export function shapePoints(clip: ShapeClip): AbsPoint[] {
  return clip.shape.path ? toAbsolute(clip.shape.path, clip.shape.width, clip.shape.height) : [];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Move a clip's position (every keyframe when it is animated). Mutates. */
function shiftPosition(c: VisualClip, dx: number, dy: number): void {
  for (const [prop, d] of [
    ['x', dx],
    ['y', dy],
  ] as const) {
    const frames = c.keyframes?.[prop];
    if (frames && frames.length) frames.forEach((k) => (k.v = round2(k.v + d)));
    else c.transform[prop] = round2(c.transform[prop] + d);
  }
}

/**
 * Write edited points (shape space of the clip's current box) back to a path shape. The box is
 * re-fitted to the path and the position adjusted so nothing moves on screen. Mutates `c`.
 */
export function writePathPoints(c: ShapeClip, points: AbsPoint[], closed: boolean, localTime: number): void {
  const { box, path } = normalizePath(points, closed, MIN_PATH_BOX);
  const W = c.shape.width;
  const H = c.shape.height;
  const dx = box.x + box.w / 2 - W / 2;
  const dy = box.y + box.h / 2 - H / 2;
  const m = mirror(c, localTime);
  const sx = Math.abs(propAt(c, 'scaleX', localTime)) * m.x;
  const sy = Math.abs(propAt(c, 'scaleY', localTime)) * m.y;
  const rad = (propAt(c, 'rotation', localTime) * Math.PI) / 180;
  const ux = dx * sx;
  const uy = dy * sy;
  shiftPosition(c, ux * Math.cos(rad) - uy * Math.sin(rad), ux * Math.sin(rad) + uy * Math.cos(rad));
  c.shape.width = Math.round(box.w * 1000) / 1000;
  c.shape.height = Math.round(box.h * 1000) / 1000;
  c.shape.path = path;
}

/** Edit the points of path shapes in one undo step (the recipe works on absolute points). */
export function editPath(ids: ID[], recipe: (points: AbsPoint[], closed: boolean) => { points: AbsPoint[]; closed: boolean } | null, coalesce?: string): void {
  const now = (clip: ShapeClip): number => Math.min(Math.max(engine.time - clip.start, 0), clip.duration);
  editClips(
    ids,
    (c) => {
      if (c.type !== 'shape' || c.shape.kind !== 'path' || !c.shape.path) return;
      const next = recipe(shapePoints(c), c.shape.path.closed);
      if (next) writePathPoints(c, next.points, next.closed, now(c));
    },
    coalesce,
  );
}

/**
 * Create a path shape from points drawn in design space (one undo step). Closed paths get the
 * default shape gradient; open paths are stroked lines. Returns the new clip id.
 */
export function createPathShape(points: AbsPoint[], closed: boolean): ID | null {
  if (points.length < 2) return null;
  const { box, path } = normalizePath(points, closed, MIN_PATH_BOX);
  const store = useProjectStore.getState();
  store.begin();
  let id: ID | null = null;
  try {
    [id] = addShape('path');
    if (id) {
      updateProject((p) => {
        const c = p.clips[id!];
        if (!c || c.type !== 'shape') return;
        c.name = path.closed ? 'Path' : 'Line path';
        c.shape.kind = 'path';
        c.shape.path = path;
        c.shape.width = Math.round(box.w * 1000) / 1000;
        c.shape.height = Math.round(box.h * 1000) / 1000;
        c.shape.radius = 0;
        if (path.closed) {
          c.shape.fill = linear(135, '#7c5cff', '#22d3ee');
        } else {
          c.shape.fill = { type: 'solid', color: '#ffffff' };
          c.shape.stroke = { color: '#ffffff', width: 10 };
        }
        c.transform.x = round2(box.x + box.w / 2);
        c.transform.y = round2(box.y + box.h / 2);
      });
    }
  } finally {
    store.commit();
  }
  if (id && getProject().clips[id]) useUI.getState().select([id]);
  return id;
}
