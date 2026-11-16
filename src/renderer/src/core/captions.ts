/**
 * Captions shared model: caption clips are text clips on a track with `role: 'captions'`.
 * This module turns them into cues and reads / writes SRT and WebVTT.
 */

import type { Project, TextClip, Track } from './types';

export interface CaptionCue {
  /** Timeline seconds. */
  start: number;
  end: number;
  text: string;
}

export const captionTracks = (p: Project): Track[] => p.tracks.filter((t) => t.role === 'captions');

/** Every caption clip on visible caption tracks, sorted by start time. */
export function captionClips(p: Project): TextClip[] {
  const ids = new Set(captionTracks(p).filter((t) => !t.hidden).map((t) => t.id));
  return Object.values(p.clips)
    .filter((c): c is TextClip => c.type === 'text' && ids.has(c.trackId))
    .sort((a, b) => a.start - b.start);
}

/** Cues for the project's captions, optionally limited to (and re-based on) a time range. */
export function collectCaptionCues(p: Project, range?: { start: number; end: number }): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const c of captionClips(p)) {
    let start = c.start;
    let end = c.start + c.duration;
    if (range) {
      start = Math.max(start, range.start);
      end = Math.min(end, range.end);
      if (end - start < 1e-3) continue;
      start -= range.start;
      end -= range.start;
    }
    const text = c.text.content.trim();
    if (text) out.push({ start, end, text });
  }
  return out;
}

const pad = (n: number, len = 2): string => String(Math.floor(n)).padStart(len, '0');

function stamp(t: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: CaptionCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
}

export function toVtt(cues: CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n')}`;
}

function parseStamp(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  const [, h, mm, ss, frac] = m;
  return (Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + Number(frac.padEnd(3, '0')) / 1000);
}

/** Parse SRT or WebVTT text into cues (styling tags are stripped). */
export function parseSubtitles(text: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const start = parseStamp(a);
    const end = parseStamp(b.trim().split(/\s+/)[0]);
    if (start === null || end === null || end <= start) continue;
    const body = lines
      .slice(timeIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]+\}/g, '')
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}
