import type { Clip } from './types';

export const EPS = 1e-6;

export const frameDuration = (fps: number): number => 1 / Math.max(1, fps);

/** Snap a time to the project's frame grid. */
export function snapToFrame(t: number, fps: number): number {
  const f = Math.max(1, fps);
  return Math.round(t * f + 1e-7) / f;
}

export const timeToFrame = (t: number, fps: number): number => Math.floor(t * fps + 1e-6);
export const frameToTime = (frame: number, fps: number): number => frame / fps;

export const clipEnd = (clip: Pick<Clip, 'start' | 'duration'>): number => clip.start + clip.duration;

const pad = (n: number, len = 2): string => String(Math.floor(n)).padStart(len, '0');

/** `HH:MM:SS:FF` timecode (hours omitted when zero). */
export function formatTimecode(t: number, fps: number, alwaysHours = false): string {
  const f = Math.max(1, Math.round(fps));
  const total = Math.max(0, Math.round(t * f));
  const frames = total % f;
  const secs = Math.floor(total / f);
  const s = secs % 60;
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600);
  const ff = pad(frames, f > 99 ? 3 : 2);
  return h > 0 || alwaysHours ? `${pad(h)}:${pad(m)}:${pad(s)}:${ff}` : `${pad(m)}:${pad(s)}:${ff}`;
}

/** Compact human duration such as `1:05` or `1:02:33`. */
export function formatDuration(t: number): string {
  const secs = Math.max(0, Math.round(t));
  const s = secs % 60;
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Duration with tenths, e.g. `4.5s` or `1m 12s`. */
export function formatSeconds(t: number): string {
  if (t < 60) return `${(Math.round(t * 10) / 10).toFixed(1)}s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return `${m}m ${pad(s)}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
