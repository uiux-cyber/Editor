import type { ID, Track, TrackKind } from '@/core/types';

export const HEADER_W = 138;
export const RULER_H = 30;
export const LEFT_PAD = 14;
export const RIGHT_PAD = 240;
/** Empty band above the first track; dropping there creates a new track. */
export const TOP_ZONE = 22;
export const BOTTOM_ZONE = 40;
export const TRACK_GAP = 4;
export const TRACK_HEIGHT: Record<TrackKind, number> = { visual: 56, audio: 44 };

export const MIN_PPS = 1.5;
export const MAX_PPS = 900;

export interface TrackRow {
  id: ID;
  kind: TrackKind;
  top: number;
  height: number;
  index: number;
}

export interface Layout {
  rows: TrackRow[];
  byId: Map<ID, TrackRow>;
  /** Height of the tracks area (excluding the ruler). */
  height: number;
}

export function layoutTracks(tracks: Track[]): Layout {
  const rows: TrackRow[] = [];
  const byId = new Map<ID, TrackRow>();
  let y = TOP_ZONE;
  let prevKind: TrackKind | null = null;
  tracks.forEach((track, index) => {
    // A slightly larger gap separates the picture tracks from the sound tracks.
    if (prevKind && prevKind !== track.kind) y += 8;
    const row: TrackRow = { id: track.id, kind: track.kind, top: y, height: TRACK_HEIGHT[track.kind], index };
    rows.push(row);
    byId.set(track.id, row);
    y += row.height + TRACK_GAP;
    prevKind = track.kind;
  });
  return { rows, byId, height: y + BOTTOM_ZONE };
}

export const timeToX = (t: number, pps: number): number => LEFT_PAD + t * pps;
export const xToTime = (x: number, pps: number): number => (x - LEFT_PAD) / pps;

/** Which row (or creation zone) is at a y offset inside the tracks area. */
export function rowAt(layout: Layout, y: number): TrackRow | 'above' | 'below' | null {
  if (layout.rows.length === 0) return 'above';
  if (y < layout.rows[0].top - TRACK_GAP / 2) return 'above';
  const last = layout.rows[layout.rows.length - 1];
  if (y > last.top + last.height + TRACK_GAP / 2) return 'below';
  for (const row of layout.rows) {
    if (y >= row.top - TRACK_GAP / 2 && y < row.top + row.height + TRACK_GAP / 2) return row;
  }
  return null;
}

/** Pick a "nice" major tick spacing (seconds) for the ruler at a zoom level. */
export function rulerStep(pps: number, fps: number): { major: number; minor: number; frames: boolean } {
  const f = Math.max(1, Math.round(fps));
  const target = 96 / pps; // seconds per ~96 px
  const frameSteps = [1, 2, 5, 10].map((n) => n / f).filter((s) => s < 0.5);
  const steps = [...frameSteps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  const major = steps.find((s) => s >= target) ?? 7200;
  let minor: number;
  if (major < 0.5) minor = 1 / f;
  else if (major === 0.5) minor = 0.1;
  else if (major <= 2) minor = major / 4;
  else if (major === 15 || major === 30) minor = major / 3;
  else minor = major / 5;
  return { major, minor: Math.max(minor, 1 / f), frames: major < 1 };
}
