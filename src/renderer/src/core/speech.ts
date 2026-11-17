/**
 * Speech & audio intelligence: the pure, GL- and DOM-free half. Turns transcribed words into
 * readable caption lines, finds filler words, plans ripple cuts that keep linked media in sync,
 * and builds ducking envelopes. Everything here is deterministic and unit tested.
 */

import { uid } from './factory';
import { evalKeyframes, splitKeyframes, baseProp } from './keyframes';
import { cleanupTransitions, clipsOnTrack } from './project';
import { EPS, clipEnd, snapToFrame } from './time';
import type { CaptionWord, Clip, EaseId, ID, Keyframe, KeyframeProp, Project, TextClip } from './types';

// ---------------------------------------------------------------------------------------------
// Words & ranges
// ---------------------------------------------------------------------------------------------

/** A transcribed word. Times are seconds in whatever base the caller uses (timeline / source). */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

/** Sort and merge overlapping / touching ranges (gaps ≤ `join` are bridged). */
export function mergeRanges(ranges: TimeRange[], join = 0): TimeRange[] {
  const sorted = ranges.filter((r) => r.end - r.start > EPS).map((r) => ({ ...r })).sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + join) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/** Total length of a set of ranges. */
export const rangesLength = (ranges: TimeRange[]): number => ranges.reduce((s, r) => s + Math.max(0, r.end - r.start), 0);

/**
 * Where a time lands after `cuts` (sorted, merged) are removed. Times inside a cut collapse to
 * the cut's start.
 */
export function mapTimeThroughCuts(t: number, cuts: TimeRange[]): number {
  let shift = 0;
  for (const c of cuts) {
    if (t >= c.end) shift += c.end - c.start;
    else if (t > c.start) return c.start - shift;
    else break;
  }
  return t - shift;
}

/** Normalised form of a word for matching: lowercase, no surrounding punctuation. */
export const normWord = (w: string): string =>
  w
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');

/** Clean up raw ASR word tokens: trim, drop empties / pure noise tags, keep times monotonic. */
export function cleanWords(words: TranscriptWord[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const w of words) {
    const text = w.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // Whisper sometimes emits bracketed sound tags like "[Music]" or "(laughs)".
    if (/^[[(].*[\])]$/.test(text)) continue;
    let start = Number.isFinite(w.start) ? w.start : 0;
    let end = Number.isFinite(w.end) ? w.end : start;
    const prev = out[out.length - 1];
    if (prev && start < prev.start) start = prev.start;
    if (end < start) end = start;
    // A token that starts with punctuation belongs to the previous word ("," "." "'s").
    if (prev && /^[,.;:!?%)\]}'’]/.test(text) && !/^'\w{2,}/.test(text)) {
      prev.text += text;
      prev.end = Math.max(prev.end, end);
      continue;
    }
    out.push({ text, start, end });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Caption line grouping
// ---------------------------------------------------------------------------------------------

export interface CaptionGroupOptions {
  /** Maximum characters per line (spaces included). */
  maxCharsPerLine: number;
  /** 1 or 2 lines per caption. */
  maxLines: number;
  /** Seconds. Short captions are held at least this long when there is room. */
  minDuration: number;
  /** Seconds. Longer runs of speech are split. */
  maxDuration: number;
  /** A pause longer than this (seconds) always starts a new caption. */
  maxGap: number;
}

export const DEFAULT_CAPTION_GROUPING: CaptionGroupOptions = { maxCharsPerLine: 32, maxLines: 2, minDuration: 0.8, maxDuration: 5, maxGap: 0.9 };

export interface CaptionGroup {
  start: number;
  end: number;
  /** Words of each line. */
  lines: TranscriptWord[][];
  /** Lines joined with '\n'. */
  text: string;
  words: TranscriptWord[];
}

const joinLen = (words: TranscriptWord[]): number => words.reduce((n, w, i) => n + w.text.length + (i ? 1 : 0), 0);
const endsSentence = (w: TranscriptWord): boolean => /[.?!…]["'”’)]*$/.test(w.text);
const endsClause = (w: TranscriptWord): boolean => /[,;:—–-]["'”’)]*$/.test(w.text);

/**
 * Best split of `words` into at most `maxLines` lines no longer than `maxChars`, balancing the
 * line lengths and preferring breaks after punctuation. Returns null when no split fits.
 */
export function splitLines(words: TranscriptWord[], maxChars: number, maxLines: number): TranscriptWord[][] | null {
  if (words.length === 0) return [];
  if (joinLen(words) <= maxChars) return [words];
  if (maxLines < 2) return words.length === 1 ? [words] : null;
  let best: { cost: number; at: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = joinLen(words.slice(0, i));
    const b = joinLen(words.slice(i));
    if (a > maxChars || b > maxChars) continue;
    // Balanced lines read best; a slightly shorter top line ("pyramid") is preferred.
    let cost = Math.abs(a - b) + (a > b ? 2 : 0);
    if (endsSentence(words[i - 1])) cost -= 8;
    else if (endsClause(words[i - 1])) cost -= 5;
    // Avoid leaving a lone short word at the end of the first line ("a", "the", "to").
    if (/^(a|an|the|to|of|and|or|but|in|on|at|for|with|my|your|i)$/i.test(normWord(words[i - 1].text))) cost += 6;
    if (!best || cost < best.cost) best = { cost, at: i };
  }
  if (!best) return null;
  return [words.slice(0, best.at), words.slice(best.at)];
}

/**
 * Group words into captions: readable line lengths, at most `maxLines` lines, breaks at
 * sentence ends and long pauses, minimum / maximum on-screen time and no overlaps.
 */
export function groupCaptions(input: TranscriptWord[], options: Partial<CaptionGroupOptions> = {}): CaptionGroup[] {
  const o = { ...DEFAULT_CAPTION_GROUPING, ...options };
  o.maxLines = Math.max(1, Math.min(3, Math.round(o.maxLines)));
  o.maxCharsPerLine = Math.max(8, Math.round(o.maxCharsPerLine));
  const words = cleanWords(input);
  const groups: TranscriptWord[][] = [];
  let cur: TranscriptWord[] = [];
  const flush = (): void => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = w.start - prev.end;
      const tooLong = w.end - cur[0].start > o.maxDuration;
      const fits = splitLines([...cur, w], o.maxCharsPerLine, o.maxLines) !== null;
      // A clause break late in a full-ish caption is a natural place to start the next one.
      const capacity = o.maxCharsPerLine * o.maxLines;
      const clauseBreak = endsClause(prev) && joinLen(cur) > capacity * 0.6;
      if (gap > o.maxGap || tooLong || !fits || clauseBreak) flush();
    }
    cur.push(w);
    if (endsSentence(w) && joinLen(cur) >= 8) flush();
  }
  flush();

  // Avoid orphans: a dangling one-word caption is merged into its neighbour when it fits, or
  // takes the last words of the previous caption ("…your own" + "computer." → "your own computer.").
  for (let i = groups.length - 1; i > 0; i--) {
    const g = groups[i];
    const prev = groups[i - 1];
    if (g.length !== 1 || endsSentence(prev[prev.length - 1]) || g[0].start - prev[prev.length - 1].end > 0.35) continue;
    const merged = [...prev, ...g];
    if (merged[merged.length - 1].end - merged[0].start <= o.maxDuration && splitLines(merged, o.maxCharsPerLine, o.maxLines)) {
      groups.splice(i - 1, 2, merged);
      continue;
    }
    while (prev.length > 3 && (g.length < 3 && joinLen(g) < 14) && !endsClause(prev[prev.length - 1])) {
      const moved = [prev[prev.length - 1], ...g];
      if (!splitLines(moved, o.maxCharsPerLine, o.maxLines) || moved[moved.length - 1].end - moved[0].start > o.maxDuration) break;
      g.unshift(prev.pop()!);
    }
  }

  const out: CaptionGroup[] = groups.map((ws) => {
    const lines = splitLines(ws, o.maxCharsPerLine, o.maxLines) ?? [ws];
    return { start: ws[0].start, end: Math.max(ws[ws.length - 1].end, ws[0].start + 0.05), lines, text: lines.map((l) => l.map((w) => w.text).join(' ')).join('\n'), words: ws };
  });

  // Timing: hold short captions, bridge tiny gaps so captions do not flicker, never overlap.
  for (let i = 0; i < out.length; i++) {
    const g = out[i];
    const next = out[i + 1];
    const limit = next ? next.start : Infinity;
    if (g.end - g.start < o.minDuration) g.end = Math.min(g.start + o.minDuration, limit);
    if (next && next.start - g.end < 0.45) g.end = next.start;
    else g.end = Math.min(g.end + 0.25, limit);
    if (g.end - g.start > o.maxDuration + 0.5) g.end = g.start + o.maxDuration + 0.5;
    if (g.end > limit) g.end = limit;
  }
  return out.filter((g) => g.end - g.start > 0.02);
}

// ---------------------------------------------------------------------------------------------
// Word timing for highlight rendering
// ---------------------------------------------------------------------------------------------

/** Whitespace-separated tokens of caption text (what the renderer highlights one by one). */
export const captionTokens = (content: string): string[] => content.split(/\s+/).filter(Boolean);

/**
 * Timing for each token of `content`. Uses the transcribed word timings when they still match the
 * text one-to-one; after the text was edited, the original span is redistributed by length.
 */
export function captionTokenTimes(content: string, words: CaptionWord[] | undefined, duration: number): TimeRange[] {
  const tokens = captionTokens(content);
  if (tokens.length === 0) return [];
  if (words && words.length === tokens.length) return words.map((w) => ({ start: w.start, end: Math.max(w.end, w.start) }));
  const s0 = words && words.length ? Math.max(0, words[0].start) : 0;
  const e0 = words && words.length ? Math.min(duration, Math.max(words[words.length - 1].end, s0 + 0.1)) : duration;
  const weights = tokens.map((t) => t.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: TimeRange[] = [];
  let t = s0;
  for (const w of weights) {
    const d = ((e0 - s0) * w) / total;
    out.push({ start: t, end: t + d });
    t += d;
  }
  return out;
}

/** Re-time `words` for new caption text: keeps timings when the token count is unchanged. */
export function retimeCaptionWords(content: string, words: CaptionWord[] | undefined, duration: number): CaptionWord[] {
  const tokens = captionTokens(content);
  const times = captionTokenTimes(content, words, duration);
  return tokens.map((text, i) => ({ text, start: round3(times[i].start), end: round3(times[i].end) }));
}

/** The word being spoken at `t` (clip-local) and how far through it we are. */
export function activeWordAt(times: TimeRange[], t: number): { index: number; progress: number } {
  let index = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i].start <= t + 1e-6) index = i;
    else break;
  }
  if (index < 0) return { index: -1, progress: 0 };
  const w = times[index];
  const span = Math.max(0.04, w.end - w.start);
  return { index, progress: Math.min(1, Math.max(0, (t - w.start) / span)) };
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// Filler words
// ---------------------------------------------------------------------------------------------

export type FillerKind = 'hesitation' | 'phrase' | 'like';

export interface FillerCandidate {
  /** Index of the first word in the transcript. */
  index: number;
  /** Number of words (2 for "you know"). */
  count: number;
  text: string;
  kind: FillerKind;
  /** Range to cut, padded into the surrounding pauses without touching neighbouring words. */
  start: number;
  end: number;
  /** 0..1; candidates ≥ 0.6 are pre-selected in the review list. */
  confidence: number;
}

const HESITATION = /^(u+m+|u+h+m*|e+r+m*|e+h+|a+h+|a+r+|h+m+|m+h*m+|uhm+|uh-huh|mm-hmm)$/;
const LIKE_LITERAL_BEFORE = new Set([
  'look', 'looks', 'looked', 'looking', 'feel', 'feels', 'felt', 'feeling', 'seem', 'seems', 'seemed', 'sound', 'sounds', 'sounded', 'taste', 'tastes', 'smell', 'smells',
  'just', 'something', 'anything', 'nothing', 'everything', 'more', 'much', 'exactly', 'would', "i'd", "you'd", "we'd", "they'd", 'i', 'you', 'we', 'they', 'he', 'she', 'really',
  "don't", "didn't", 'do', 'does', 'did', 'to', 'not', 'most', 'people', 'kids', 'who', 'also', 'still', 'never', 'always', 'totally', "doesn't", 'should', 'could', 'might', 'will', "won't", 'and', 'or',
]);
const QUOTATIVE_BEFORE = new Set(['was', 'were', 'is', "'s", 'am', 'are', 'be', 'been', 'being', "i'm", "he's", "she's", "it's", "we're", "they're"]);
const OBJECT_AFTER = new Set(['this', 'that', 'these', 'those', 'it', 'him', 'her', 'them', 'me', 'us', 'a', 'an', 'the', 'my', 'your', 'his', 'our', 'their', 'what', 'how', 'when']);
const KNOW_LITERAL_AFTER = new Set(['what', 'that', 'how', 'why', 'who', 'where', 'when', 'if', 'whether', 'the', 'a', 'an', 'him', 'her', 'them', 'me', 'it', 'about', 'this', 'those', 'these', 'everything', 'nothing', 'someone', 'something', 'anything', 'everyone', 'more', 'enough', 'better', 'each', 'all']);
const MEAN_LITERAL_AFTER = new Set(['it', 'that', 'what', 'to', 'the', 'you', 'this', 'a', 'an', 'anything', 'something', 'nothing', 'business', 'well', 'him', 'her', 'them', 'me']);
const KIND_LITERAL_BEFORE = new Set(['a', 'an', 'the', 'what', 'this', 'that', 'some', 'any', 'one', 'every', 'no', 'which', 'same', 'different', 'all', 'of', 'two', 'these', 'those', 'many', 'new', 'right', 'wrong', 'first', 'only', 'other', 'another', 'whatever', 'certain', 'my', 'your', 'his', 'her', 'their', 'our']);

const hasCommaAfter = (w: TranscriptWord | undefined): boolean => !!w && /[,;:—–]["'”’)]*$/.test(w.text);
const startsSentence = (prev: TranscriptWord | undefined): boolean => !prev || /[.?!…]["'”’)]*$/.test(prev.text);

/** Find filler words in a transcript. `words` must be in time order. */
export function detectFillers(words: TranscriptWord[]): FillerCandidate[] {
  const out: FillerCandidate[] = [];
  const n = words.length;
  const nw = words.map((w) => normWord(w.text));
  const push = (index: number, count: number, kind: FillerKind, confidence: number): void => {
    const first = words[index];
    const last = words[index + count - 1];
    const prev = words[index - 1];
    const next = words[index + count];
    // Cut into the surrounding pauses (half of each gap, at most 0.15 s) but never into words.
    let start = first.start - 0.15;
    if (prev) start = Math.max(start, (prev.end + first.start) / 2, prev.end);
    let end = last.end + 0.15;
    if (next) end = Math.min(end, (last.end + next.start) / 2, next.start);
    start = Math.max(0, Math.min(start, first.start));
    end = Math.max(end, last.end > start ? Math.min(last.end, next ? next.start : last.end) : start);
    if (end - start < 0.03) return;
    out.push({ index, count, text: words.slice(index, index + count).map((w) => w.text).join(' '), kind, start, end, confidence: Math.min(1, Math.max(0, confidence)) });
  };
  for (let i = 0; i < n; i++) {
    const w = nw[i];
    const prevN = nw[i - 1];
    const nextN = nw[i + 1];
    if (!w) continue;
    if (HESITATION.test(w)) {
      push(i, 1, 'hesitation', 0.95);
      continue;
    }
    // Two-word phrases.
    if (i + 1 < n) {
      const after = nw[i + 2];
      const pair = `${w} ${nextN}`;
      if (pair === 'you know') {
        const comma = hasCommaAfter(words[i + 1]) || hasCommaAfter(words[i - 1]) || i + 2 >= n || startsSentence(words[i - 1]) && hasCommaAfter(words[i + 1]);
        const literal = after !== undefined && KNOW_LITERAL_AFTER.has(after) && !hasCommaAfter(words[i + 1]);
        const subject = prevN === 'do' || prevN === 'did' || prevN === "don't" || prevN === 'if' || prevN === 'as' || prevN === 'what' || prevN === 'how' || prevN === 'would' || prevN === 'will' || prevN === 'to';
        if (!literal && !subject) {
          push(i, 2, 'phrase', comma ? 0.85 : 0.55);
          i++;
          continue;
        }
      }
      if (pair === 'i mean') {
        const comma = hasCommaAfter(words[i + 1]);
        const literal = after !== undefined && MEAN_LITERAL_AFTER.has(after) && !comma;
        if (!literal && (comma || startsSentence(words[i - 1]) || hasCommaAfter(words[i - 1]))) {
          push(i, 2, 'phrase', comma ? 0.85 : 0.6);
          i++;
          continue;
        }
      }
      if ((w === 'sort' || w === 'kind') && nextN === 'of') {
        const literal = prevN !== undefined && KIND_LITERAL_BEFORE.has(prevN);
        if (!literal) {
          push(i, 2, 'phrase', hasCommaAfter(words[i + 1]) || hasCommaAfter(words[i - 1]) ? 0.8 : 0.6);
          i++;
          continue;
        }
      }
    }
    if (w === 'like') {
      let score = 0;
      const commaBefore = hasCommaAfter(words[i - 1]);
      const commaAfter = hasCommaAfter(words[i]);
      if (commaBefore || startsSentence(words[i - 1])) score += 0.5;
      if (commaAfter) score += 0.5;
      if (prevN === 'like' || nextN === 'like') score += 0.5;
      if (prevN && LIKE_LITERAL_BEFORE.has(prevN) && !commaBefore) score -= 1;
      if (prevN && QUOTATIVE_BEFORE.has(prevN)) score -= 0.3;
      if (nextN && OBJECT_AFTER.has(nextN) && !commaAfter) score -= 0.4;
      // "there were like five people": an approximator before a number.
      if (nextN && /^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|fifty|a hundred|hundred)$/.test(nextN) && !commaAfter) score += 0.2;
      if (!nextN) score -= 0.2;
      if (score >= 0.5) push(i, 1, 'like', Math.min(0.9, 0.35 + score * 0.4));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ripple cuts
// ---------------------------------------------------------------------------------------------

export interface RippleCutResult {
  /** Seconds removed from the timeline. */
  removed: number;
  /** Number of cuts applied. */
  cuts: number;
}

function shiftKeyframes(clip: Clip, cut: number): void {
  if (!clip.keyframes) return;
  const next: NonNullable<Clip['keyframes']> = {};
  for (const [prop, frames] of Object.entries(clip.keyframes) as [KeyframeProp, Keyframe[] | undefined][]) {
    if (!frames || !frames.length) continue;
    next[prop] = splitKeyframes(frames, cut, baseProp(clip, prop)).right;
    if (!next[prop]!.length) delete next[prop];
  }
  clip.keyframes = next;
}

/** Mutates. Drops the part of `clip` before local time `cut` (start edge trim). */
function trimClipStart(clip: Clip, cut: number): void {
  if (clip.type === 'video' || clip.type === 'audio') {
    clip.trimIn += cut * clip.speed;
    clip.fadeIn = 0;
  }
  if (clip.type === 'compound') clip.trimIn += cut;
  if (clip.type === 'text' && clip.caption?.words) {
    clip.caption.words = clip.caption.words.filter((w) => w.end > cut + 0.01).map((w) => ({ ...w, start: Math.max(0, w.start - cut), end: Math.max(0, w.end - cut) }));
  }
  if (clip.type !== 'audio' && clip.anim?.in) delete clip.anim.in;
  shiftKeyframes(clip, cut);
  clip.start += cut;
  clip.duration -= cut;
}

/** Mutates. Keeps only the first `keep` seconds of `clip`. */
function trimClipEnd(clip: Clip, keep: number): void {
  if (clip.keyframes) {
    for (const [prop, frames] of Object.entries(clip.keyframes) as [KeyframeProp, Keyframe[] | undefined][]) {
      if (frames?.length) clip.keyframes[prop] = splitKeyframes(frames, keep, baseProp(clip, prop)).left;
    }
  }
  if (clip.type === 'video' || clip.type === 'audio') clip.fadeOut = 0;
  if (clip.type !== 'audio' && clip.anim?.out) delete clip.anim.out;
  if (clip.type === 'text' && clip.caption?.words) clip.caption.words = clip.caption.words.filter((w) => w.start < keep - 0.01).map((w) => ({ ...w, end: Math.min(w.end, keep) }));
  clip.duration = keep;
}

/**
 * Caption clips are re-timed instead of being split: words inside a cut disappear from the text,
 * later words move earlier, and the clip shrinks around what is left.
 */
function retimeCaption(p: Project, clip: TextClip, cuts: TimeRange[], fps: number): void {
  const a = clip.start;
  const b = clipEnd(clip);
  const words = clip.caption?.words;
  const tokens = captionTokens(clip.text.content);
  if (words && words.length && words.length === tokens.length) {
    const kept: CaptionWord[] = [];
    const keptIdx: number[] = [];
    words.forEach((w, i) => {
      const ws = a + w.start;
      const we = a + w.end;
      const mid = (ws + we) / 2;
      if (cuts.some((c) => mid > c.start && mid < c.end)) return;
      kept.push({ ...w, start: mapTimeThroughCuts(ws, cuts), end: mapTimeThroughCuts(we, cuts) });
      keptIdx.push(i);
    });
    if (kept.length === 0) {
      delete p.clips[clip.id];
      return;
    }
    if (kept.length !== words.length) {
      // Rebuild the text from the surviving tokens, keeping the original line structure.
      const lines = clip.text.content.split('\n').map((l) => captionTokens(l).length);
      let idx = 0;
      const byLine: string[][] = lines.map((count) => {
        const out: string[] = [];
        for (let k = 0; k < count; k++, idx++) if (keptIdx.includes(idx)) out.push(tokens[idx]);
        return out;
      });
      clip.text.content = byLine.filter((l) => l.length).map((l) => l.join(' ')).join('\n');
    }
    const ns = Math.min(mapTimeThroughCuts(a, cuts), kept[0].start);
    const ne = Math.max(mapTimeThroughCuts(b, cuts), kept[kept.length - 1].end);
    clip.start = snapToFrame(ns, fps);
    clip.duration = Math.max(1 / fps, snapToFrame(ne, fps) - clip.start);
    clip.caption!.words = kept.map((w) => ({ ...w, start: Math.max(0, w.start - clip.start), end: Math.max(0, w.end - clip.start) }));
    return;
  }
  const ns = mapTimeThroughCuts(a, cuts);
  const ne = mapTimeThroughCuts(b, cuts);
  if (ne - ns < 1 / fps) {
    delete p.clips[clip.id];
    return;
  }
  clip.start = snapToFrame(ns, fps);
  clip.duration = Math.max(1 / fps, snapToFrame(ne, fps) - clip.start);
}

/**
 * Mutates. Removes the timeline `ranges` from every clip on `trackIds` and closes the gaps
 * (clips after a cut move left by the removed length). Clips spanning a cut are split around
 * it; media in-points are adjusted so picture and sound stay in sync. Caption tracks in
 * `trackIds` are re-timed word by word. Ranges are snapped to the frame grid.
 */
export function rippleCutRanges(p: Project, ranges: TimeRange[], trackIds: Iterable<ID>): RippleCutResult {
  const fps = p.settings.fps;
  const cuts = mergeRanges(ranges.map((r) => ({ start: snapToFrame(Math.max(0, r.start), fps), end: snapToFrame(Math.max(0, r.end), fps) }))).filter((r) => r.end - r.start >= 1 / fps - EPS);
  if (cuts.length === 0) return { removed: 0, cuts: 0 };
  const tracks = new Set(trackIds);
  const captionTracks = new Set(p.tracks.filter((t) => t.role === 'captions').map((t) => t.id));
  for (const trackId of tracks) {
    const track = p.tracks.find((t) => t.id === trackId);
    if (!track || track.locked) continue;
    if (captionTracks.has(trackId)) {
      for (const clip of clipsOnTrack(p, trackId)) if (clip.type === 'text') retimeCaption(p, p.clips[clip.id] as TextClip, cuts, fps);
      continue;
    }
    // Last cut first, so earlier cut positions stay valid while we edit.
    for (let ci = cuts.length - 1; ci >= 0; ci--) {
      const { start: a, end: b } = cuts[ci];
      const len = b - a;
      for (const snapshot of clipsOnTrack(p, trackId)) {
        const clip = p.clips[snapshot.id];
        if (!clip) continue;
        const s = clip.start;
        const e = clipEnd(clip);
        if (e <= a + EPS) continue;
        if (s >= b - EPS) {
          clip.start = snapToFrame(s - len, fps);
          continue;
        }
        if (s >= a - EPS && e <= b + EPS) {
          delete p.clips[clip.id];
          continue;
        }
        if (s < a - EPS && e > b + EPS) {
          // Split around the cut: left keeps [s, a), right is [b, e) moved to a.
          const right = JSON.parse(JSON.stringify(clip)) as Clip;
          right.id = uid(clip.id.slice(0, 3));
          trimClipEnd(clip, a - s);
          trimClipStart(right, b - s);
          right.start = a;
          if (right.type !== 'audio' && 'effects' in right) right.effects.forEach((fx) => (fx.uid = uid('fx_')));
          p.clips[right.id] = right;
          for (const tr of Object.values(p.transitions)) if (tr.fromId === clip.id) tr.fromId = right.id;
          continue;
        }
        if (s < a - EPS) {
          trimClipEnd(clip, a - s);
          continue;
        }
        // Starts inside the cut, ends after it.
        trimClipStart(clip, b - s);
        clip.start = a;
      }
    }
  }
  // Markers after a cut follow the content.
  for (const m of p.markers) m.time = snapToFrame(mapTimeThroughCuts(m.time, cuts), fps);
  cleanupTransitions(p);
  return { removed: rangesLength(cuts), cuts: cuts.length };
}

/** Tracks that must be cut together with `clipIds` to keep linked picture and sound in sync. */
export function linkedTrackIds(p: Project, clipIds: Iterable<ID>): Set<ID> {
  const ids = new Set(clipIds);
  const links = new Set<ID>();
  for (const id of ids) {
    const c = p.clips[id];
    if (c?.linkId) links.add(c.linkId);
  }
  const tracks = new Set<ID>();
  for (const c of Object.values(p.clips)) {
    if (ids.has(c.id) || (c.linkId && links.has(c.linkId))) tracks.add(c.trackId);
  }
  // A video and the audio detached from it share the asset and timing even without a link id.
  for (const id of ids) {
    const c = p.clips[id];
    if (!c || (c.type !== 'video' && c.type !== 'audio')) continue;
    for (const o of Object.values(p.clips)) {
      if ((o.type === 'video' || o.type === 'audio') && o.assetId === c.assetId && Math.abs(o.start - c.start) < 1e-3 && Math.abs(o.trimIn - c.trimIn) < 1e-3) tracks.add(o.trackId);
    }
  }
  for (const t of p.tracks) if (t.role === 'captions') tracks.add(t.id);
  return tracks;
}

/** Map source-time words of a media clip to timeline time (dropping words outside the clip). */
export function sourceWordsToTimeline(words: TranscriptWord[], clip: { start: number; duration: number; trimIn: number; speed: number }): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const w of words) {
    const s = clip.start + (w.start - clip.trimIn) / clip.speed;
    const e = clip.start + (w.end - clip.trimIn) / clip.speed;
    if (e <= clip.start + 0.01 || s >= clip.start + clip.duration - 0.01) continue;
    out.push({ text: w.text, start: Math.max(clip.start, s), end: Math.min(clip.start + clip.duration, e) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ducking
// ---------------------------------------------------------------------------------------------

export interface DuckingOptions {
  /** Reduction while speech plays, dB (positive number). */
  depthDb: number;
  /** Seconds to fade down before speech starts. */
  attack: number;
  /** Seconds to fade back up after speech ends. */
  release: number;
}

export const DEFAULT_DUCKING: DuckingOptions = { depthDb: 12, attack: 0.25, release: 0.6 };

/**
 * Volume keyframes (clip-local) that duck `clip` under the timeline `speech` ranges, multiplied
 * into the clip's existing volume envelope.
 */
export function duckingKeyframes(clip: { start: number; duration: number; volume: number; keyframes?: Clip['keyframes'] }, speech: TimeRange[], opts: DuckingOptions): Keyframe[] {
  const duck = Math.pow(10, -Math.abs(opts.depthDb) / 20);
  const attack = Math.max(0.01, opts.attack);
  const release = Math.max(0.01, opts.release);
  // Regions closer than a full fade down + up stay ducked in between.
  const regions = mergeRanges(
    speech.map((r) => ({ start: r.start - clip.start, end: r.end - clip.start })).filter((r) => r.end > 0 && r.start < clip.duration),
    attack + release,
  );
  const existing = clip.keyframes?.volume;
  const envAt = (t: number): number => evalKeyframes(existing, t, clip.volume);
  // Factor curve: 1 → duck → 1 per region.
  const points: { t: number; f: number; ease: EaseId }[] = [];
  for (const r of regions) {
    const downStart = r.start - attack;
    const upEnd = r.end + release;
    points.push({ t: downStart, f: 1, ease: 'easeInOut' }, { t: r.start, f: duck, ease: 'linear' }, { t: r.end, f: duck, ease: 'easeInOut' }, { t: upEnd, f: 1, ease: 'linear' });
  }
  const factorAt = (t: number): number => {
    let f = 1;
    for (let i = 0; i < points.length; i += 4) {
      const [a, b, c, d] = points.slice(i, i + 4);
      if (t <= a.t || t >= d.t) continue;
      if (t < b.t) f = Math.min(f, 1 - (1 - duck) * easeInOut((t - a.t) / (b.t - a.t)));
      else if (t <= c.t) f = Math.min(f, duck);
      else f = Math.min(f, duck + (1 - duck) * easeInOut((t - c.t) / (d.t - c.t)));
    }
    return f;
  };
  const times = new Map<number, EaseId>();
  const addT = (t: number, ease: EaseId): void => {
    const k = Math.round(Math.min(clip.duration, Math.max(0, t)) * 1000) / 1000;
    if (!times.has(k) || ease !== 'linear') times.set(k, ease);
  };
  addT(0, 'linear');
  for (const pt of points) addT(pt.t, pt.ease);
  for (const k of existing ?? []) addT(k.t, k.ease);
  addT(clip.duration, 'linear');
  const sorted = [...times.entries()].sort((a, b) => a[0] - b[0]);
  const out: Keyframe[] = sorted.map(([t, ease]) => ({ t, v: Math.round(envAt(t) * factorAt(t) * 10000) / 10000, ease }));
  // Drop redundant keyframes in flat runs (keep the ends of each run).
  return out.filter((k, i) => i === 0 || i === out.length - 1 || !(Math.abs(out[i - 1].v - k.v) < 1e-4 && Math.abs(out[i + 1].v - k.v) < 1e-4));
}

function easeInOut(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
