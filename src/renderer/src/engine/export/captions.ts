/**
 * Caption handling for exports (pure): which cues go into subtitle files / tracks, and the
 * render copy of a project whose captions are not burned into the picture.
 */

import { collectCaptionCues, type CaptionCue } from '@/core/captions';
import type { Project } from '@/core/types';

/** Caption cues of the exported range, re-based so the range starts at 0. */
export function exportCaptionCues(project: Project, range: { start: number; end: number }): CaptionCue[] {
  return collectCaptionCues(project, { start: range.start, end: range.end });
}

/** A copy of the project whose caption tracks are hidden (captions not burned into the picture). */
export function withoutBurnedCaptions(project: Project): Project {
  if (!project.tracks.some((t) => t.role === 'captions' && !t.hidden)) return project;
  return { ...project, tracks: project.tracks.map((t) => (t.role === 'captions' ? { ...t, hidden: true } : t)) };
}
