/**
 * Adapt a project to another frame size / aspect ratio (multi-aspect export, auto-reframe).
 *
 * Geometry is in design px (shorter side = 1080), so a different aspect changes the composition
 * width or height. Media that filled the old frame is scaled to fill the new one and panned to
 * keep its subject in view (using a focus provider when one is registered, e.g. face tracking);
 * overlays keep their size and are moved proportionally, shrinking only when they would no
 * longer fit.
 */

import { designSize, fitContain } from './project';
import type { Clip, ImageClip, Keyframe, Project, VideoClip, VisualClip } from './types';

/** Subject position inside the source picture over time: x / y in 0..1, t in clip-local seconds. */
export interface FocusPoint {
  t: number;
  x: number;
  y: number;
}

export type FocusProvider = (clip: VideoClip | ImageClip, project: Project) => FocusPoint[] | null;

let focusProvider: FocusProvider | null = null;

/** Register the subject-tracking provider (set by the vision feature). */
export function setFocusProvider(fn: FocusProvider | null): void {
  focusProvider = fn;
}

export interface ReframeOptions {
  /** Use the focus provider to pan media toward its subject (default true). */
  focus?: boolean;
}

const scaleFrames = (frames: Keyframe[] | undefined, k: number): Keyframe[] | undefined => frames?.map((f) => ({ ...f, v: f.v * k }));

/** A copy of `project` laid out for a `width × height` frame. The input is not modified. */
export function reframeProject(project: Project, width: number, height: number, opts: ReframeOptions = {}): Project {
  const out = JSON.parse(JSON.stringify(project)) as Project;
  const from = designSize(project.settings);
  out.settings = { ...out.settings, width, height };
  const to = designSize(out.settings);
  const kx = to.cw / from.cw;
  const ky = to.ch / from.ch;

  for (const clip of Object.values(out.clips)) {
    if (clip.type === 'audio') continue;
    const v = clip as VisualClip;
    const media = clip.type === 'video' || clip.type === 'image' ? (clip as VideoClip | ImageClip) : null;
    const asset = media ? project.assets[media.assetId] : undefined;

    if (clip.type === 'generator' || clip.type === 'adjustment') continue; // full-frame by nature

    if (media && asset && asset.width > 0 && asset.height > 0) {
      const crop = media.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      const sw = asset.width * Math.max(0.01, 1 - crop.l - crop.r);
      const sh = asset.height * Math.max(0.01, 1 - crop.t - crop.b);
      const fitOld = fitContain(sw, sh, from.cw, from.ch);
      const fitNew = fitContain(sw, sh, to.cw, to.ch);
      const coverOld = Math.max(from.cw / fitOld.w, from.ch / fitOld.h);
      const coverNew = Math.max(to.cw / fitNew.w, to.ch / fitNew.h);
      const s = Math.max(Math.abs(v.transform.scaleX), Math.abs(v.transform.scaleY));
      const filledOld = s >= coverOld * 0.98;
      if (filledOld) {
        // Scale is relative to the contain-fit size in each frame: keep the same overshoot.
        const k = coverNew / coverOld;
        v.transform.scaleX *= k;
        v.transform.scaleY *= k;
        const kf = v.keyframes;
        if (kf) {
          kf.scaleX = scaleFrames(kf.scaleX, k);
          kf.scaleY = scaleFrames(kf.scaleY, k);
        }
        const layerW = fitNew.w * Math.abs(v.transform.scaleX);
        const layerH = fitNew.h * Math.abs(v.transform.scaleY);
        const maxX = Math.max(0, (layerW - to.cw) / 2);
        const maxY = Math.max(0, (layerH - to.ch) / 2);
        const focus = opts.focus !== false && focusProvider ? focusProvider(media, project) : null;
        if (focus && focus.length) {
          // Pan so the subject sits in the middle, never revealing the frame edge.
          const xs = focus.map((f) => ({ t: f.t, v: Math.max(-maxX, Math.min(maxX, (0.5 - f.x) * layerW)) }));
          const ys = focus.map((f) => ({ t: f.t, v: Math.max(-maxY, Math.min(maxY, (0.5 - f.y) * layerH)) }));
          v.keyframes = { ...(v.keyframes ?? {}), x: xs.map((p) => ({ t: p.t, v: p.v, ease: 'easeInOut' as const })), y: ys.map((p) => ({ t: p.t, v: p.v, ease: 'easeInOut' as const })) };
          v.transform.x = xs[0].v;
          v.transform.y = ys[0].v;
        } else {
          v.transform.x = Math.max(-maxX, Math.min(maxX, v.transform.x * kx));
          v.transform.y = Math.max(-maxY, Math.min(maxY, v.transform.y * ky));
        }
        continue;
      }
    }

    // Overlays and picture-in-picture: move proportionally, shrink only if they no longer fit.
    v.transform.x *= kx;
    v.transform.y *= ky;
    if (v.keyframes) {
      v.keyframes.x = scaleFrames(v.keyframes.x, kx);
      v.keyframes.y = scaleFrames(v.keyframes.y, ky);
    }
    const shrink = Math.min(1, kx, ky) < 1 ? Math.max(Math.min(kx, ky), 0.55) : 1;
    if (shrink < 1) {
      v.transform.scaleX *= shrink;
      v.transform.scaleY *= shrink;
      if (v.keyframes) {
        v.keyframes.scaleX = scaleFrames(v.keyframes.scaleX, shrink);
        v.keyframes.scaleY = scaleFrames(v.keyframes.scaleY, shrink);
      }
    }
  }
  return out;
}

export type { Clip };
