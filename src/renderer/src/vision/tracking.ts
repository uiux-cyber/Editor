/**
 * Motion tracking: a text / sticker / shape ("follower") follows an object in a video beneath it.
 *
 * The user draws a box around the object on the preview at the playhead. The box is mapped into
 * the video's source picture (through the layer's transform, crop and flips), tracked forward
 * and backward through the overlapping range in the worker, mapped back into design space at
 * every frame (so moving / scaled video layers are handled), cleaned, simplified to sparse
 * keyframes and written as x / y keyframes on the follower, keeping its current offset from the
 * object. One undo step.
 */

import { fitContain, designSize, sourceTimeAt } from '@/core/project';
import { propAt } from '@/core/keyframes';
import { resolveLayer } from '@/core/scene';
import { clipEnd } from '@/core/time';
import type { Clip, ID, Keyframe, Project, VideoClip, VisualClip } from '@/core/types';
import { engine } from '@/engine/engine';
import { getProject, updateProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { cleanTrack, reduceKeyframes } from './algo/tracker';
import { visionRequest } from './client';
import type { TrackResponse } from './protocol';
import { mediaRef } from './reframe';
import { runJob, useVision, type DesignBox, type TrackPoint, type TrackState } from './store';

export const FOLLOWER_TYPES: Clip['type'][] = ['text', 'sticker', 'shape'];
export const isFollower = (c: Clip | undefined): c is VisualClip => !!c && FOLLOWER_TYPES.includes(c.type);

interface Geometry {
  cx: number;
  cy: number;
  /** Signed quad size (negative scale mirrors). */
  a: number;
  b: number;
  cos: number;
  sin: number;
  uv: [number, number, number, number];
}

/** Placement of a video layer at a clip-local time (same maths as the compositor). */
function geometry(project: Project, clip: VideoClip, localTime: number): Geometry | null {
  const asset = project.assets[clip.assetId];
  if (!asset || !asset.width || !asset.height) return null;
  const { cw, ch } = designSize(project.settings);
  const crop = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const keepW = Math.max(0.01, 1 - crop.l - crop.r);
  const keepH = Math.max(0.01, 1 - crop.t - crop.b);
  const fit = fitContain(asset.width * keepW, asset.height * keepH, cw, ch);
  const r = resolveLayer(clip, localTime, fit.w, fit.h, cw, ch);
  let uv: [number, number, number, number] = [crop.l, crop.t, crop.l + keepW, crop.t + keepH];
  if (clip.flipH) uv = [uv[2], uv[1], uv[0], uv[3]];
  if (clip.flipV) uv = [uv[0], uv[3], uv[2], uv[1]];
  const rad = (r.rotation * Math.PI) / 180;
  return { cx: r.x, cy: r.y, a: fit.w * r.scaleX, b: fit.h * r.scaleY, cos: Math.cos(rad), sin: Math.sin(rad), uv };
}

/** Design point → normalised source coordinates (null when the layer is degenerate). */
export function designToSource(project: Project, clip: VideoClip, localTime: number, x: number, y: number): { x: number; y: number } | null {
  const g = geometry(project, clip, localTime);
  if (!g || Math.abs(g.a) < 1e-6 || Math.abs(g.b) < 1e-6) return null;
  const dx = x - g.cx;
  const dy = y - g.cy;
  const u = (dx * g.cos + dy * g.sin) / g.a + 0.5;
  const v = (-dx * g.sin + dy * g.cos) / g.b + 0.5;
  return { x: g.uv[0] + (g.uv[2] - g.uv[0]) * u, y: g.uv[1] + (g.uv[3] - g.uv[1]) * v };
}

/** Normalised source coordinates → design point. */
export function sourceToDesign(project: Project, clip: VideoClip, localTime: number, sx: number, sy: number): { x: number; y: number } | null {
  const g = geometry(project, clip, localTime);
  if (!g) return null;
  const u = (sx - g.uv[0]) / (g.uv[2] - g.uv[0] || 1) - 0.5;
  const v = (sy - g.uv[1]) / (g.uv[3] - g.uv[1] || 1) - 0.5;
  const px = u * g.a;
  const py = v * g.b;
  return { x: g.cx + px * g.cos - py * g.sin, y: g.cy + px * g.sin + py * g.cos };
}

/** Video clips a follower can track: visible below it while both are on screen. */
export function trackTargets(project: Project, followerId: ID): VideoClip[] {
  const f = project.clips[followerId];
  if (!f) return [];
  const order = new Map(project.tracks.map((t, i) => [t.id, i]));
  const fIdx = order.get(f.trackId) ?? 0;
  return Object.values(project.clips)
    .filter((c): c is VideoClip => c.type === 'video' && !!project.assets[c.assetId] && c.start < clipEnd(f) - 1e-6 && clipEnd(c) > f.start + 1e-6 && (order.get(c.trackId) ?? 0) > fIdx)
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
}

/** Best default target: the top-most video under the follower at the playhead. */
export function defaultTarget(project: Project, followerId: ID): VideoClip | null {
  const list = trackTargets(project, followerId);
  return list.find((c) => engine.time >= c.start && engine.time < clipEnd(c)) ?? list[0] ?? null;
}

/** Enter box-drawing mode on the preview. */
export function startDrawing(followerId: ID, videoId: ID): void {
  const cur = useVision.getState().draw;
  useVision.getState().set({ draw: { followerId, videoId, box: cur?.followerId === followerId ? cur.box : null, active: true } });
}

export function stopDrawing(): void {
  const cur = useVision.getState().draw;
  if (cur) useVision.getState().set({ draw: { ...cur, active: false } });
}

export function setDrawBox(box: DesignBox | null): void {
  const cur = useVision.getState().draw;
  if (cur) useVision.getState().set({ draw: { ...cur, box } });
}

/** Track the object in `box` (design px at the playhead) and keyframe the follower. */
export async function trackMotion(followerId: ID, videoId: ID, box: DesignBox): Promise<TrackState | null> {
  const project = getProject();
  const follower = project.clips[followerId];
  const video = project.clips[videoId];
  if (!isFollower(follower) || !video || video.type !== 'video') {
    useUI.getState().toast({ kind: 'info', message: 'Select a text, sticker or shape above a video clip' });
    return null;
  }
  const asset = project.assets[video.assetId];
  if (!asset) return null;
  const T0 = Math.min(Math.max(engine.time, video.start), clipEnd(video) - 1e-3);
  const local0 = T0 - video.start;
  // Box → source picture: map the four corners and take their bounds (handles rotation).
  const corners = [
    [box.cx - box.w / 2, box.cy - box.h / 2],
    [box.cx + box.w / 2, box.cy - box.h / 2],
    [box.cx - box.w / 2, box.cy + box.h / 2],
    [box.cx + box.w / 2, box.cy + box.h / 2],
  ].map(([x, y]) => designToSource(project, video, local0, x, y));
  if (corners.some((c) => !c)) return null;
  const xs = corners.map((c) => c!.x);
  const ys = corners.map((c) => c!.y);
  const src = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  if (src.cx < 0 || src.cx > 1 || src.cy < 0 || src.cy > 1) {
    useUI.getState().toast({ kind: 'info', message: 'Draw the box over the video picture' });
    return null;
  }
  // Range: where follower and video overlap on the timeline.
  const A = Math.max(follower.start, video.start);
  const B = Math.min(clipEnd(follower), clipEnd(video));
  const s0 = sourceTimeAt(video, A - video.start);
  const s1 = sourceTimeAt(video, B - video.start);
  const sT = sourceTimeAt(video, local0);

  const res = await runJob(
    `track:${followerId}`,
    'track',
    'Motion tracking',
    (job) =>
      visionRequest<TrackResponse>(
        { type: 'track', req: { media: mediaRef(asset), t0: sT, start: s0, end: s1, box: { cx: src.cx, cy: src.cy, w: Math.max(0.005, src.w), h: Math.max(0.005, src.h) } } },
        { signal: job.signal, onProgress: (v, l) => job.progress(v, l) },
      ),
    followerId,
  );
  if (!res || res.samples.length === 0) return null;

  // Source samples → design positions at timeline times.
  const speed = video.speed || 1;
  const raw = res.samples
    .map((s) => {
      const T = video.start + (s.t - video.trimIn) / speed;
      const p = sourceToDesign(project, video, T - video.start, s.x, s.y);
      return p ? { t: T, x: p.x, y: p.y, conf: s.conf } : null;
    })
    .filter((p): p is { t: number; x: number; y: number; conf: number } => !!p && p.t >= A - 1e-6 && p.t <= B + 1e-6);
  if (!raw.length) return null;
  const clean = cleanTrack(raw, 0.5, 1.2);
  // Keep the follower's current offset from the object at the playhead.
  const fl = Math.min(Math.max(T0 - follower.start, 0), follower.duration);
  const fx = propAt(follower, 'x', fl);
  const fy = propAt(follower, 'y', fl);
  const anchor = clean.reduce((best, p) => (Math.abs(p.t - T0) < Math.abs(best.t - T0) ? p : best), clean[0]);
  const ox = fx - anchor.x;
  const oy = fy - anchor.y;
  const shifted = clean.map((p) => ({ ...p, x: p.x + ox, y: p.y + oy }));
  const keys = reduceKeyframes(shifted, 0.6);
  const round = (v: number): number => Math.round(v * 100) / 100;
  const toFrames = (axis: 'x' | 'y'): Keyframe[] =>
    keys.map((k) => ({ t: Math.max(0, Math.min(follower.duration, k.t - follower.start)), v: round(k[axis]), ease: 'linear' as const }));
  updateProject((p) => {
    const c = p.clips[followerId];
    if (!c || c.type === 'audio') return;
    c.keyframes = { ...(c.keyframes ?? {}), x: toFrames('x'), y: toFrames('y') };
  });
  const points: TrackPoint[] = shifted.map((p) => ({ T: p.t, x: p.x, y: p.y, conf: p.conf }));
  const state: TrackState = { followerId, videoId, points, keyframes: keys.length, frames: res.frames, ms: res.ms };
  useVision.setState((s) => ({ tracks: { ...s.tracks, [followerId]: state }, draw: s.draw?.followerId === followerId ? { ...s.draw, active: false } : s.draw }));
  useUI.getState().toast({ kind: 'success', message: `Tracked ${res.frames} frames`, detail: `${keys.length} keyframes written on x / y. Press Ctrl+Z to undo.` });
  return state;
}

/** Remove the tracking keyframes (keeps the position shown at the playhead). */
export function clearTracking(followerId: ID): void {
  const project = getProject();
  const c = project.clips[followerId];
  if (!c || c.type === 'audio') return;
  const lt = Math.min(Math.max(engine.time - c.start, 0), c.duration);
  const x = propAt(c, 'x', lt);
  const y = propAt(c, 'y', lt);
  updateProject((p) => {
    const d = p.clips[followerId];
    if (!d || d.type === 'audio') return;
    if (d.keyframes) {
      delete d.keyframes.x;
      delete d.keyframes.y;
    }
    d.transform.x = x;
    d.transform.y = y;
  });
  useVision.setState((s) => {
    const tracks = { ...s.tracks };
    delete tracks[followerId];
    return { tracks };
  });
}

/** Follower path from its x / y keyframes (for showing the motion path after a reload). */
export function keyframePath(clip: VisualClip, fps: number): TrackPoint[] {
  if (!clip.keyframes?.x?.length && !clip.keyframes?.y?.length) return [];
  const out: TrackPoint[] = [];
  const step = 1 / Math.max(1, fps);
  for (let t = 0; t <= clip.duration + 1e-9; t += step) out.push({ T: clip.start + t, x: propAt(clip, 'x', t), y: propAt(clip, 'y', t), conf: 1 });
  return out;
}
