/**
 * Captions shared model: caption clips are text clips on a track with `role: 'captions'`.
 * This module turns them into cues and reads / writes SRT and WebVTT.
 */

import { CAPTION_PRESETS, DEFAULT_CAPTION_PRESET, captionY, getCaptionPreset, presetTextStyle, type CaptionPosition } from './captionStyles';
import { DEFAULT_TEXT_STYLE, makeText, makeTrack } from './factory';
import { EPS, clipEnd, snapToFrame } from './time';
import type { CaptionWord, ID, Project, TextClip, Track } from './types';

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

// ---------------------------------------------------------------------------------------------
// Creating caption clips (speech feature)
// ---------------------------------------------------------------------------------------------

/**
 * Mutates. The project's captions track, created as the topmost visual track when missing. An
 * existing captions track is moved back to the top so captions are never hidden by overlays.
 */
export function ensureCaptionTrack(p: Project): Track {
  let track = p.tracks.find((t) => t.role === 'captions');
  if (!track) {
    track = { ...makeTrack('visual', 'Captions'), role: 'captions' };
    p.tracks.unshift(track);
    return track;
  }
  const idx = p.tracks.indexOf(track);
  if (idx > 0) {
    p.tracks.splice(idx, 1);
    p.tracks.unshift(track);
  }
  return track;
}

export interface CaptionLook {
  presetId: string;
  position: CaptionPosition;
}

/** A styled caption clip (not yet on a track). `words` are clip-local. */
export function makeCaptionClip(p: Project, text: string, start: number, end: number, words: CaptionWord[] | undefined, look: Partial<CaptionLook> = {}): TextClip {
  const preset = getCaptionPreset(look.presetId ?? DEFAULT_CAPTION_PRESET) ?? CAPTION_PRESETS[0];
  const style = presetTextStyle(preset, p.settings, DEFAULT_TEXT_STYLE);
  const clip = makeText(text, { start, duration: Math.max(1 / p.settings.fps, end - start), style, y: captionY(p.settings, look.position ?? preset.position), name: 'Caption' });
  clip.name = text.replace(/\s+/g, ' ').slice(0, 40) || 'Caption';
  clip.caption = { highlight: preset.highlight, highlightColor: preset.highlightColor, words: words ?? tokenWords(text, end - start) };
  return clip;
}

/** Evenly timed words for caption text without transcription timings. */
function tokenWords(text: string, duration: number): CaptionWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => t.length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return tokens.map((tok, i) => {
    const d = (duration * weights[i]) / total;
    const w = { text: tok, start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 };
    t += d;
    return w;
  });
}

export interface PlaceCaptionsOptions extends Partial<CaptionLook> {
  /** Remove captions already on the track inside the covered time range first. */
  replace?: boolean;
}

export interface CaptionSpec {
  start: number;
  end: number;
  text: string;
  /** Timeline-time word timings. */
  words?: { text: string; start: number; end: number }[];
}

/**
 * Mutates. Adds captions to the captions track (created if needed) with frame-snapped timing
 * and no overlaps: each caption is fitted into the free space around existing ones. Returns
 * the new clip ids.
 */
export function placeCaptions(p: Project, specs: CaptionSpec[], opts: PlaceCaptionsOptions = {}): ID[] {
  const fps = p.settings.fps;
  const track = ensureCaptionTrack(p);
  const sorted = specs.filter((s) => s.text.trim() && s.end > s.start).sort((a, b) => a.start - b.start);
  if (opts.replace && sorted.length) {
    const from = sorted[0].start;
    const to = sorted[sorted.length - 1].end;
    for (const c of Object.values(p.clips)) if (c.trackId === track.id && c.start < to && clipEnd(c) > from) delete p.clips[c.id];
  }
  const busy = Object.values(p.clips)
    .filter((c) => c.trackId === track.id)
    .map((c) => ({ start: c.start, end: clipEnd(c) }));
  const ids: ID[] = [];
  for (const s of sorted) {
    let start = snapToFrame(Math.max(0, s.start), fps);
    let end = snapToFrame(s.end, fps);
    busy.sort((x, y) => x.start - y.start);
    for (const b of busy) {
      if (b.end <= start + EPS || b.start >= end - EPS) continue;
      if (b.start <= start + EPS) start = Math.max(start, b.end);
      else end = Math.min(end, b.start);
    }
    if (end - start < 1 / fps - EPS) continue;
    const words = s.words?.map((w) => ({ text: w.text, start: Math.max(0, Math.round((w.start - start) * 1000) / 1000), end: Math.max(0, Math.round((w.end - start) * 1000) / 1000) }));
    const clip = makeCaptionClip(p, s.text.trim(), start, end, words, opts);
    clip.trackId = track.id;
    p.clips[clip.id] = clip;
    busy.push({ start, end });
    ids.push(clip.id);
  }
  return ids;
}

/** Mutates. Imported subtitle cues → caption clips. */
export function cuesToCaptionClips(p: Project, cues: CaptionCue[], opts: PlaceCaptionsOptions = {}): ID[] {
  return placeCaptions(p, cues, opts);
}
