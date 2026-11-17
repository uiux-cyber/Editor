/**
 * Colour match: make a clip look like a reference clip / frame. Frames of both are sampled in
 * the worker, compared in CIELAB, and the clip's Adjust values are solved so the rendered result
 * has the reference's statistics (see algo/color.ts). The result is written into `clip.adjust`
 * in one undo step, so every value stays editable in the Adjust tab.
 */

import { isNeutralGrade, resolveFilterGrade } from '@/engine/gl/grade';
import type { Grade, ID, ImageClip, Project, VideoClip } from '@/core/types';
import { engine } from '@/engine/engine';
import { getProject, updateProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { MATCH_PARAMS } from './algo/color';
import { visionRequest } from './client';
import type { ColorMatchResponse } from './protocol';
import { mediaRef } from './reframe';
import { runJob, useVision, type ColorMatchState } from './store';

type MediaClip = VideoClip | ImageClip;
export const isMediaClip = (c: unknown): c is MediaClip => !!c && ((c as MediaClip).type === 'video' || (c as MediaClip).type === 'image');

/** Source times sampled from a clip: evenly across it, or the frame at the playhead. */
function sampleTimes(clip: MediaClip, mode: 'clip' | 'playhead'): number[] {
  if (clip.type === 'image') return [0];
  const speed = clip.speed || 1;
  if (mode === 'playhead') {
    const local = Math.min(Math.max(engine.time - clip.start, 0), clip.duration - 1e-3);
    return [clip.trimIn + local * speed];
  }
  const n = 5;
  return Array.from({ length: n }, (_, i) => clip.trimIn + ((i + 0.5) / n) * clip.duration * speed);
}

function toDataUrl(rgba: Uint8ClampedArray, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

/** Visual clips that can serve as a reference for `clipId` (every other video / image clip). */
export function referenceCandidates(project: Project, clipId: ID): MediaClip[] {
  return Object.values(project.clips)
    .filter((c): c is MediaClip => isMediaClip(c) && c.id !== clipId && !!project.assets[c.assetId])
    .sort((a, b) => a.start - b.start);
}

export interface MatchOptions {
  strength?: number;
  /** Sample the reference across the clip or only the frame under the playhead. */
  referenceFrame?: 'clip' | 'playhead';
}

/** Match `clipId` to `referenceId`, apply the result and return the comparison state. */
export async function matchColor(clipId: ID, referenceId: ID, opts: MatchOptions = {}): Promise<ColorMatchState | null> {
  const project = getProject();
  const clip = project.clips[clipId];
  const ref = project.clips[referenceId];
  if (!isMediaClip(clip) || !isMediaClip(ref)) {
    useUI.getState().toast({ kind: 'info', message: 'Colour match works on video and image clips' });
    return null;
  }
  const asset = project.assets[clip.assetId];
  const refAsset = project.assets[ref.assetId];
  if (!asset || !refAsset) return null;
  // Matched fields are re-solved from neutral; everything else in Adjust is kept.
  const base: Partial<Grade> = { ...(clip.adjust ?? {}) };
  for (const p of MATCH_PARAMS) delete base[p.key];
  const res = await runJob(
    `color:${clipId}`,
    'color',
    'Colour match',
    (job) =>
      visionRequest<ColorMatchResponse>(
        {
          type: 'colorMatch',
          req: {
            source: { ...mediaRef(asset), times: sampleTimes(clip, 'clip') },
            reference: { ...mediaRef(refAsset), times: sampleTimes(ref, opts.referenceFrame ?? 'clip') },
            referenceGrades: [ref.adjust && !isNeutralGrade(ref.adjust) ? ref.adjust : null, resolveFilterGrade(ref.filter)],
            baseAdjust: base,
            filter: resolveFilterGrade(clip.filter),
            strength: opts.strength ?? 1,
            previewWidth: 240,
          },
        },
        { signal: job.signal, onProgress: (v, l) => job.progress(v, l) },
      ),
    clipId,
  );
  if (!res) return null;
  const previous = clip.adjust ? { ...clip.adjust } : undefined;
  const applied: Partial<Grade> = { ...res.adjust };
  updateProject((p) => {
    const c = p.clips[clipId];
    if (c && c.type !== 'audio') c.adjust = applied;
  });
  const { w, h } = res.previews;
  const state: ColorMatchState = {
    clipId,
    referenceId,
    previous,
    applied,
    previews: { w, h, reference: toDataUrl(res.previews.reference, w, h), before: toDataUrl(res.previews.before, w, h), after: toDataUrl(res.previews.after, w, h) },
    distanceBefore: res.distanceBefore,
    distanceAfter: res.distanceAfter,
    ms: res.ms,
  };
  useVision.setState((s) => ({ color: { ...s.color, [clipId]: state } }));
  return state;
}

/** Put back the Adjust values the clip had before the last match (new undo step). */
export function revertColorMatch(clipId: ID): void {
  const st = useVision.getState().color[clipId];
  if (!st) return;
  updateProject((p) => {
    const c = p.clips[clipId];
    if (!c || c.type === 'audio') return;
    if (st.previous) c.adjust = { ...st.previous };
    else delete c.adjust;
  });
  useVision.setState((s) => {
    const color = { ...s.color };
    delete color[clipId];
    return { color };
  });
}
