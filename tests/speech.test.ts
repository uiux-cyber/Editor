import { describe, expect, it } from 'vitest';
import { detectBeats, detectSilences, detectSpeech, denoiseChannels, gainToDb } from '@/core/audioAnalysis';
import { captionClips, cuesToCaptionClips, ensureCaptionTrack, parseSubtitles, toSrt } from '@/core/captions';
import { makeAudio, makeText, makeVideo } from '@/core/factory';
import { createProject } from '@/core/project';
import {
  activeWordAt,
  captionTokenTimes,
  cleanWords,
  detectFillers,
  duckingKeyframes,
  groupCaptions,
  mapTimeThroughCuts,
  mergeRanges,
  retimeCaptionWords,
  rippleCutRanges,
  splitLines,
  type TranscriptWord,
} from '@/core/speech';
import type { MediaAsset } from '@/core/types';

/** Words with a fixed rhythm: each word takes `dur`, separated by `gap`. */
function words(text: string, start = 0, dur = 0.3, gap = 0.05): TranscriptWord[] {
  let t = start;
  return text.split(' ').map((w) => {
    const out = { text: w, start: t, end: t + dur };
    t += dur + gap;
    return out;
  });
}

describe('caption grouping', () => {
  it('splits into balanced lines within the character limit', () => {
    const ws = words('the quick brown fox jumps over the lazy dog');
    const lines = splitLines(ws, 24, 2)!;
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.map((w) => w.text).join(' ').length).toBeLessThanOrEqual(24);
    expect(splitLines(ws, 10, 2)).toBeNull();
  });

  it('groups words into readable, non-overlapping captions', () => {
    const ws = [
      ...words('Hello everyone and welcome back to the channel.', 0),
      ...words("Today we're going to talk about something really exciting, so stay tuned until the very end of this video.", 3.2),
      ...words('Thanks', 12),
    ];
    const groups = groupCaptions(ws, { maxCharsPerLine: 28, maxLines: 2, minDuration: 0.8, maxDuration: 4.5, maxGap: 0.8 });
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const g of groups) {
      const lines = g.text.split('\n');
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(28);
      expect(g.end).toBeGreaterThan(g.start);
      expect(g.end - g.start).toBeLessThanOrEqual(5.01);
    }
    for (let i = 1; i < groups.length; i++) expect(groups[i].start).toBeGreaterThanOrEqual(groups[i - 1].end - 1e-9);
    // A sentence end closes the caption.
    expect(groups[0].text.replace('\n', ' ')).toBe('Hello everyone and welcome back to the channel.');
    // Every word ends up in exactly one caption, in order.
    expect(groups.flatMap((g) => g.words.map((w) => w.text))).toEqual(cleanWords(ws).map((w) => w.text));
    // The last caption (one short word after a long pause) is held for the minimum duration.
    const last = groups[groups.length - 1];
    expect(last.text).toBe('Thanks');
    expect(last.end - last.start).toBeGreaterThanOrEqual(0.8 - 1e-9);
  });

  it('does not leave a single orphan word on its own', () => {
    const ws = words('Welcome to Kinora, the video editor that runs on your own computer.', 0, 0.25, 0.05);
    const groups = groupCaptions(ws, { maxCharsPerLine: 18, maxLines: 2 });
    expect(groups.every((g) => g.words.length >= 2)).toBe(true);
    expect(groups[groups.length - 1].text.replace('\n', ' ')).toMatch(/own computer\.$/);
  });

  it('respects a one-line limit and long pauses', () => {
    const ws = [...words('one two three four five six seven eight', 0), ...words('nine ten', 10)];
    const groups = groupCaptions(ws, { maxCharsPerLine: 14, maxLines: 1 });
    for (const g of groups) expect(g.text).not.toContain('\n');
    expect(groups[groups.length - 1].text).toBe('nine ten');
  });

  it('merges punctuation tokens and drops sound tags', () => {
    const cleaned = cleanWords([
      { text: ' Hello', start: 0, end: 0.4 },
      { text: ',', start: 0.4, end: 0.41 },
      { text: '[Music]', start: 0.5, end: 1 },
      { text: ' world', start: 1, end: 1.4 },
      { text: '.', start: 1.4, end: 1.41 },
    ]);
    expect(cleaned.map((w) => w.text)).toEqual(['Hello,', 'world.']);
  });

  it('maps word timings to tokens and redistributes after edits', () => {
    const w = [
      { text: 'Hello', start: 0, end: 0.5 },
      { text: 'there', start: 0.6, end: 1 },
    ];
    expect(captionTokenTimes('Hello there', w, 2)).toEqual([
      { start: 0, end: 0.5 },
      { start: 0.6, end: 1 },
    ]);
    const edited = captionTokenTimes('Hello out there', w, 2);
    expect(edited).toHaveLength(3);
    expect(edited[0].start).toBe(0);
    expect(edited[2].end).toBeCloseTo(1, 6);
    expect(retimeCaptionWords('Hi\nthere', w, 2).map((x) => x.text)).toEqual(['Hi', 'there']);
    expect(activeWordAt(edited, -0.1).index).toBe(-1);
    const active = activeWordAt(captionTokenTimes('Hello there', w, 2), 0.8);
    expect(active.index).toBe(1);
    expect(active.progress).toBeCloseTo(0.5, 6);
  });
});

describe('filler words', () => {
  const find = (text: string): string[] => detectFillers(words(text)).map((f) => f.text);

  it('finds hesitations and filler phrases', () => {
    expect(find('So um I think uh we should go')).toEqual(['um', 'uh']);
    expect(find('Hmm, that is erm interesting')).toEqual(['Hmm,', 'erm']);
    expect(find('It was, you know, pretty good')).toEqual(['you know,']);
    expect(find('I mean, it works')).toEqual(['I mean,']);
    expect(find('It is kind of weird')).toEqual(['kind of']);
  });

  it('keeps literal uses', () => {
    expect(find('Do you know what I mean')).toEqual([]);
    expect(find('I mean it')).toEqual([]);
    expect(find('What kind of tool is this')).toEqual([]);
    expect(find('This is a kind of magic')).toEqual([]);
  });

  it('only removes "like" when it behaves as a filler', () => {
    expect(find('I like pizza')).toEqual([]);
    expect(find('It looks like rain')).toEqual([]);
    expect(find('Something like this')).toEqual([]);
    expect(find('It was, like, really good')).toEqual(['like,']);
    expect(find('Like, I do not know')).toEqual(['Like,']);
  });

  it('cuts into the pauses without touching neighbouring words', () => {
    const ws = words('we um go', 0, 0.3, 0.2);
    const [f] = detectFillers(ws);
    expect(f.start).toBeGreaterThanOrEqual(ws[0].end);
    expect(f.end).toBeLessThanOrEqual(ws[2].start);
    expect(f.start).toBeLessThan(ws[1].start);
    expect(f.end).toBeGreaterThan(ws[1].end);
  });
});

describe('ranges and ripple cuts', () => {
  const asset: MediaAsset = { id: 'a', kind: 'video', name: 'talk.mp4', source: { type: 'file', path: 'C:/talk.mp4' }, duration: 20, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, size: 1, addedAt: 0 };

  it('merges ranges and maps times through cuts', () => {
    expect(mergeRanges([{ start: 3, end: 4 }, { start: 1, end: 2 }, { start: 1.5, end: 2.5 }])).toEqual([
      { start: 1, end: 2.5 },
      { start: 3, end: 4 },
    ]);
    const cuts = [{ start: 1, end: 2 }, { start: 5, end: 6 }];
    expect(mapTimeThroughCuts(0.5, cuts)).toBe(0.5);
    expect(mapTimeThroughCuts(1.5, cuts)).toBe(1);
    expect(mapTimeThroughCuts(3, cuts)).toBe(2);
    expect(mapTimeThroughCuts(7, cuts)).toBe(5);
  });

  it('cuts linked video and audio together, keeping them in sync', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    p.assets.a = asset;
    const video = makeVideo(asset, { duration: 10 });
    video.trackId = p.tracks[0].id;
    video.linkId = 'L';
    video.muted = true;
    const audio = makeAudio({ ...asset, kind: 'audio' } as MediaAsset, { duration: 10 });
    audio.assetId = 'a';
    audio.trackId = p.tracks[1].id;
    audio.linkId = 'L';
    p.clips[video.id] = video;
    p.clips[audio.id] = audio;
    const res = rippleCutRanges(p, [{ start: 2, end: 3 }, { start: 6, end: 6.5 }], [video.trackId, audio.trackId]);
    expect(res.removed).toBeCloseTo(1.5, 6);
    const clips = Object.values(p.clips).sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId));
    const total = (track: string): number => clips.filter((c) => c.trackId === track).reduce((s, c) => s + c.duration, 0);
    expect(total(video.trackId)).toBeCloseTo(8.5, 6);
    expect(total(audio.trackId)).toBeCloseTo(8.5, 6);
    // Each video piece has an audio piece with the same timing and source in-point.
    const vids = clips.filter((c) => c.type === 'video');
    const auds = clips.filter((c) => c.type === 'audio');
    expect(vids).toHaveLength(3);
    for (let i = 0; i < vids.length; i++) {
      const v = vids[i] as typeof video;
      const a = auds[i] as typeof audio;
      expect(a.start).toBeCloseTo(v.start, 6);
      expect(a.duration).toBeCloseTo(v.duration, 6);
      expect(a.trimIn).toBeCloseTo(v.trimIn, 6);
    }
    expect((vids[1] as typeof video).trimIn).toBeCloseTo(3, 6);
    expect(vids[1].start).toBeCloseTo(2, 6);
    expect((vids[2] as typeof video).trimIn).toBeCloseTo(6.5, 6);
    expect(vids[2].start).toBeCloseTo(5, 6);
  });

  it('re-times caption clips word by word', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    const track = ensureCaptionTrack(p);
    const clip = makeText('so um yes', { start: 1, duration: 2 });
    clip.trackId = track.id;
    clip.caption = {
      highlight: 'color',
      highlightColor: '#ffd84d',
      words: [
        { text: 'so', start: 0, end: 0.4 },
        { text: 'um', start: 0.6, end: 1 },
        { text: 'yes', start: 1.2, end: 1.8 },
      ],
    };
    p.clips[clip.id] = clip;
    rippleCutRanges(p, [{ start: 1.5, end: 2.1 }], [track.id]);
    const c = p.clips[clip.id];
    expect(c.type === 'text' && c.text.content).toBe('so yes');
    expect(c.type === 'text' && c.caption?.words?.map((w) => w.text)).toEqual(['so', 'yes']);
    expect(c.duration).toBeCloseTo(1.4, 1);
  });
});

describe('ducking', () => {
  it('ducks the music under speech with smooth ramps', () => {
    const kf = duckingKeyframes({ start: 0, duration: 10, volume: 1 }, [{ start: 2, end: 4 }], { depthDb: 12, attack: 0.25, release: 0.5 });
    const at = (t: number): number => {
      let v = kf[0].v;
      for (const k of kf) if (k.t <= t + 1e-9) v = k.v;
      return v;
    };
    expect(at(0)).toBeCloseTo(1, 4);
    expect(at(3)).toBeCloseTo(Math.pow(10, -12 / 20), 3);
    expect(at(9)).toBeCloseTo(1, 4);
    expect(kf.some((k) => Math.abs(k.t - 1.75) < 1e-6)).toBe(true);
    expect(kf.some((k) => Math.abs(k.t - 4.5) < 1e-6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------------------------

const SR = 16000;

/** A tone with silent gaps: [tone seconds, silence seconds, …]. */
function toneWithGaps(pattern: number[], amp = 0.3, noise = 0.001): Float32Array {
  const total = pattern.reduce((a, b) => a + b, 0);
  const out = new Float32Array(Math.round(total * SR));
  let t = 0;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  pattern.forEach((len, i) => {
    const a = Math.round(t * SR);
    const b = Math.round((t + len) * SR);
    for (let k = a; k < b; k++) out[k] = (i % 2 === 0 ? amp * Math.sin((2 * Math.PI * 220 * k) / SR) : 0) + noise * rnd();
    t += len;
  });
  return out;
}

describe('silence detection', () => {
  it('finds the gaps of a synthetic signal', () => {
    // tone 0–1, silence 1–1.8, tone 1.8–2.8, short pause 2.8–3.1 (kept), tone 3.1–4.1, silence 4.1–5.3, tone.
    const sig = toneWithGaps([1, 0.8, 1, 0.3, 1, 1.2, 0.5]);
    const ranges = detectSilences(sig, SR, { thresholdDb: -40, minDuration: 0.5, padding: 0.1 });
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toBeCloseTo(1.1, 1);
    expect(ranges[0].end).toBeCloseTo(1.7, 1);
    expect(ranges[1].start).toBeCloseTo(4.2, 1);
    expect(ranges[1].end).toBeCloseTo(5.2, 1);
  });

  it('includes leading and trailing silence without padding at the file edges', () => {
    const sig = toneWithGaps([0, 1, 1, 1]);
    const ranges = detectSilences(sig, SR, { thresholdDb: -40, minDuration: 0.5, padding: 0.1 });
    expect(ranges[0].start).toBe(0);
    expect(ranges[0].end).toBeCloseTo(0.9, 1);
    expect(ranges[ranges.length - 1].end).toBeCloseTo(3, 2);
  });

  it('detects speech-like activity regions', () => {
    const sig = toneWithGaps([0.5, 1, 1, 1], 0.2, 0.002).map((v, i) => v + 0.15 * Math.sin((2 * Math.PI * 900 * i) / SR) * (i > 1.5 * SR && i < 2.5 * SR ? 1 : 0));
    const regions = detectSpeech(sig, SR);
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions.some((r) => r.start < 1.6 && r.end > 2.4)).toBe(true);
  });
});

describe('beat detection', () => {
  it('finds tempo, beats and accented downbeats of a click track', () => {
    const sr = 22050;
    const bpm = 120;
    const seconds = 16;
    const sig = new Float32Array(sr * seconds);
    const period = 60 / bpm;
    const first = 0.25;
    const clicks: number[] = [];
    for (let t = first, i = 0; t < seconds - 0.1; t += period, i++) {
      clicks.push(t);
      const accent = i % 4 === 1; // bars start on the second click
      const a = Math.round(t * sr);
      for (let k = 0; k < sr * 0.05; k++) {
        const env = Math.exp(-k / (sr * 0.008));
        const tone = accent ? Math.sin((2 * Math.PI * 70 * k) / sr) * 0.9 + Math.sin((2 * Math.PI * 1500 * k) / sr) * 0.3 : Math.sin((2 * Math.PI * 1500 * k) / sr) * 0.4;
        if (a + k < sig.length) sig[a + k] += tone * env;
      }
    }
    const res = detectBeats(sig, sr);
    expect(Math.abs(res.bpm - bpm)).toBeLessThan(1.5);
    // Most clicks have a detected beat within 30 ms.
    const hits = clicks.filter((c) => res.beats.some((b) => Math.abs(b - c) < 0.03)).length;
    expect(hits / clicks.length).toBeGreaterThan(0.9);
    // Downbeats every 4 beats, on the accented clicks.
    expect(res.downbeats.length).toBeGreaterThanOrEqual(6);
    for (const d of res.downbeats) {
      const i = clicks.findIndex((c) => Math.abs(c - d) < 0.04);
      expect(i % 4).toBe(1);
    }
  });
});

describe('noise reduction', () => {
  it('attenuates steady noise while keeping the signal', () => {
    const sr = 16000;
    const n = sr * 3;
    let seed = 3;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const noise = new Float32Array(n).map(() => 0.03 * rnd());
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = noise[i] + (i > sr && i < 2 * sr ? 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr) : 0);
    const [out] = denoiseChannels([sig], { strength: 1, sensitivity: 2 });
    const rms = (a: Float32Array, s: number, e: number): number => {
      let acc = 0;
      for (let i = s; i < e; i++) acc += a[i] * a[i];
      return Math.sqrt(acc / (e - s));
    };
    const noiseBefore = gainToDb(rms(sig, 0, sr * 0.8));
    const noiseAfter = gainToDb(rms(out, 0, sr * 0.8));
    const toneBefore = gainToDb(rms(sig, sr * 1.2, sr * 1.8));
    const toneAfter = gainToDb(rms(out, sr * 1.2, sr * 1.8));
    expect(noiseBefore - noiseAfter).toBeGreaterThan(15);
    expect(Math.abs(toneBefore - toneAfter)).toBeLessThan(1.5);
    expect(out.length).toBe(sig.length);
  });
});

describe('subtitles', () => {
  it('imports SRT and VTT into caption clips on a captions track', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\nSecond line\r\nwraps here\r\n';
    const vtt = 'WEBVTT\n\nNOTE comment\n\n00:01.000 --> 00:02.500 align:start\nHello there\n\n00:00:03.000 --> 00:00:05.000\nSecond line\nwraps here\n';
    const a = parseSubtitles(srt);
    const b = parseSubtitles(vtt);
    expect(a).toEqual(b);
    expect(a).toEqual([
      { start: 1, end: 2.5, text: 'Hello there' },
      { start: 3, end: 5, text: 'Second line\nwraps here' },
    ]);
    const p = createProject({ width: 1080, height: 1920, fps: 30 });
    const ids = cuesToCaptionClips(p, a);
    expect(ids).toHaveLength(2);
    const track = p.tracks[0];
    expect(track.role).toBe('captions');
    const clips = captionClips(p);
    expect(clips.map((c) => c.text.content)).toEqual(['Hello there', 'Second line\nwraps here']);
    expect(clips[0].caption?.words?.map((w) => w.text)).toEqual(['Hello', 'there']);
    expect(toSrt([{ start: 1, end: 2.5, text: 'Hello there' }])).toContain('00:00:01,000 --> 00:00:02,500');
    // Importing again reuses the captions track and never overlaps existing captions.
    cuesToCaptionClips(p, [{ start: 2, end: 3.5, text: 'Overlap' }]);
    const after = captionClips(p);
    for (let i = 1; i < after.length; i++) expect(after[i].start).toBeGreaterThanOrEqual(after[i - 1].start + after[i - 1].duration - 1e-6);
    expect(p.tracks.filter((t) => t.role === 'captions')).toHaveLength(1);
  });
});
