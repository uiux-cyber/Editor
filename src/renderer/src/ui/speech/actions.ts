/**
 * Speech & audio actions used by the Smart tools, the Captions tab and the commands. Long work
 * runs as a single cancellable job with progress; every project change is one undo step.
 */

import { BEAT_COLOR, DOWNBEAT_COLOR, isBeatMarker } from './beats';
import { getCaptionPreset, presetTextStyle, captionY, captionMetrics, type CaptionPosition } from '@/core/captionStyles';
import { captionClips, collectCaptionCues, ensureCaptionTrack, parseSubtitles, placeCaptions, toSrt, toVtt } from '@/core/captions';
import { DEFAULT_TEXT_STYLE, uid } from '@/core/factory';
import { addTrack, clipsOnTrack, isFree, maxDurationFromSource, projectDuration, pruneEmptyTracks, splitClipAt } from '@/core/project';
import { getAudioClips } from '@/core/scene';
import {
  cleanWords,
  detectFillers,
  duckingKeyframes,
  groupCaptions,
  linkedTrackIds,
  rangesLength,
  retimeCaptionWords,
  rippleCutRanges,
  type TimeRange,
  type TranscriptWord,
} from '@/core/speech';
import { clipEnd, snapToFrame } from '@/core/time';
import type { AudioClip, CaptionHighlight, Clip, ID, MediaAsset, Project, TextClip, VideoClip } from '@/core/types';
import { engine } from '@/engine/engine';
import { importMediaFiles } from '@/engine/media/assets';
import { encodeWav } from '@/engine/media/sounds';
import { ExtractCancelled, decodeAsset, decodeClip, mixTimeline } from '@/engine/speech/audioExtract';
import { DspCancelled, analyseBeats, analyseSilence, analyseSpeech, denoiseAudio } from '@/engine/speech/dsp';
import { TranscriptionCancelled, languageName, transcribe } from '@/engine/speech/transcriber';
import { api } from '@/platform/api';
import type { FileInfo } from '@shared/ipc';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { speechPrefs, useSpeech, type JobKind, type Scope } from './store';

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

export interface JobControl {
  signal: AbortSignal;
  progress: (ratio: number, detail?: string) => void;
}

let jobCounter = 1;

const isCancel = (err: unknown): boolean =>
  err instanceof TranscriptionCancelled || err instanceof ExtractCancelled || err instanceof DspCancelled || (err instanceof DOMException && err.name === 'AbortError');

/** Run long work as the (single) speech job: progress, cancel, taskbar progress and toasts. */
export async function runJob<T>(kind: JobKind, label: string, fn: (ctl: JobControl) => Promise<T>): Promise<T | null> {
  const current = useSpeech.getState().job;
  if (current) {
    toast('info', `${current.label} is still running`, 'Wait for it to finish or cancel it first.');
    return null;
  }
  const controller = new AbortController();
  const id = jobCounter++;
  useSpeech.getState().set({ job: { id, kind, label, ratio: -1, controller } });
  void api.app.keepAwake(true);
  let lastBar = 0;
  const progress = (ratio: number, detail?: string): void => {
    const job = useSpeech.getState().job;
    if (!job || job.id !== id) return;
    useSpeech.getState().set({ job: { ...job, ratio, detail: detail ?? job.detail } });
    const now = performance.now();
    if (ratio >= 0 && now - lastBar > 250) {
      lastBar = now;
      void api.app.setProgress(ratio);
    }
  };
  try {
    return await fn({ signal: controller.signal, progress });
  } catch (err) {
    if (isCancel(err) || controller.signal.aborted) toast('info', `${label} cancelled`);
    else {
      console.warn(`[speech] ${kind} failed`, err);
      toast('error', `${label} failed`, err instanceof Error ? err.message : String(err));
    }
    return null;
  } finally {
    if (useSpeech.getState().job?.id === id) useSpeech.getState().set({ job: null });
    void api.app.setProgress(-1);
    void api.app.keepAwake(false);
  }
}

export function cancelJob(): void {
  useSpeech.getState().job?.controller.abort();
}

// ---------------------------------------------------------------------------------------------
// Scope & transcription
// ---------------------------------------------------------------------------------------------

type SoundClip = VideoClip | AudioClip;

/** Selected clips that carry sound (a video and the audio detached from it count once). */
export function selectedSoundClips(p: Project = getProject()): SoundClip[] {
  const sel = useUI.getState().selection.map((id) => p.clips[id]).filter((c): c is SoundClip => !!c && (c.type === 'video' || c.type === 'audio') && !!p.assets[c.assetId]?.hasAudio);
  const out: SoundClip[] = [];
  for (const c of sel.sort((a, b) => a.start - b.start)) {
    const twin = out.find((o) => o.assetId === c.assetId && Math.abs(o.start - c.start) < 1e-3 && Math.abs(o.trimIn - c.trimIn) < 1e-3);
    if (twin) {
      // Prefer the audible one.
      if (twin.muted && !c.muted) out[out.indexOf(twin)] = c;
      continue;
    }
    out.push(c);
  }
  return out;
}

export function hasTimelineAudio(p: Project = getProject()): boolean {
  return getAudioClips(p).length > 0;
}

/** The scope actually used: the selection when it has sound, else the whole timeline. */
export function effectiveScope(scope: Scope): Scope {
  return scope === 'selection' && selectedSoundClips().length > 0 ? 'selection' : 'timeline';
}

interface ScopeWords {
  words: TranscriptWord[];
  clipIds: ID[];
  trackIds: ID[];
  language: string;
}

function scopeSignature(p: Project, clips: SoundClip[] | null): string {
  // getAudioClips already leaves out muted clips and clips on muted tracks.
  const list = clips ?? getAudioClips(p);
  return list.map((c) => `${c.id}:${c.assetId}:${c.start.toFixed(3)}:${c.duration.toFixed(3)}:${c.trimIn.toFixed(3)}:${c.speed}:${c.volume}:${c.muted ? 1 : 0}`).join('|');
}

/** Words (timeline seconds) spoken in the scope. Reuses a cached transcript when nothing changed. */
export async function transcribeScope(scope: Scope, ctl: JobControl, share = 1, base = 0): Promise<ScopeWords> {
  const p = getProject();
  const prefs = speechPrefs();
  const clips = scope === 'selection' ? selectedSoundClips(p) : null;
  if (scope === 'timeline' && !hasTimelineAudio(p)) throw new Error('The timeline has no sound to transcribe.');
  const key = `${scope}|${prefs.language}|${scopeSignature(p, clips)}`;
  const trackIds = clips ? [...linkedTrackIds(p, clips.map((c) => c.id))] : p.tracks.filter((t) => !t.locked).map((t) => t.id);
  const cached = useSpeech.getState().transcripts.find((t) => t.key === key);
  if (cached) {
    ctl.progress(base + share);
    return { words: cached.words, clipIds: clips?.map((c) => c.id) ?? [], trackIds, language: cached.language };
  }

  const words: TranscriptWord[] = [];
  let language = prefs.language;
  const started = performance.now();
  let audioSeconds = 0;
  let device = '';
  const pieces: { start: number; duration: number; get: () => Promise<Float32Array> }[] = clips
    ? clips.map((c) => ({ start: c.start, duration: c.duration, get: async () => (await decodeClip(p, c, { sampleRate: 16000, channels: 1, signal: ctl.signal })).channels[0] }))
    : [{ start: 0, duration: projectDuration(p), get: async () => (await mixTimeline(p, 0, projectDuration(p), { sampleRate: 16000, channels: 1, signal: ctl.signal, onProgress: (r) => ctl.progress(base + share * 0.1 * r, 'Mixing the timeline sound…') })).channels[0] }];
  const total = pieces.reduce((s, x) => s + x.duration, 0) || 1;
  let done = 0;
  for (const piece of pieces) {
    const w = piece.duration / total;
    ctl.progress(base + share * done, 'Reading audio…');
    const audio = await piece.get();
    const res = await transcribe(audio, {
      language: prefs.language,
      device: prefs.device,
      signal: ctl.signal,
      onLoading: (r) => ctl.progress(base + share * done, `Loading the speech model… ${Math.round(r * 100)}%`),
      onProgress: (r) => ctl.progress(base + share * (done + w * (0.1 + 0.9 * r)), 'Transcribing…'),
    });
    // Trimmed tokens with punctuation attached to its word ("Um," not " Um" + ",").
    for (const word of cleanWords(res.words)) words.push({ text: word.text, start: piece.start + word.start, end: piece.start + word.end });
    language = res.language;
    audioSeconds += res.audioSeconds;
    device = res.device;
    done += w;
  }
  const seconds = (performance.now() - started) / 1000;
  useSpeech.getState().set({ lastRun: { device, seconds, audioSeconds, language }, transcripts: [{ key, words, language }, ...useSpeech.getState().transcripts].slice(0, 6) });
  return { words, clipIds: clips?.map((c) => c.id) ?? [], trackIds, language };
}

// ---------------------------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------------------------

export function captionMaxChars(p: Project = getProject()): number {
  return speechPrefs().maxChars ?? captionMetrics(p.settings).maxChars;
}

/** Transcribe and add captions to the captions track. Resolves with the number of captions. */
export function autoCaptions(scope: Scope): Promise<number | null> {
  const used = effectiveScope(scope);
  return runJob('captions', 'Auto captions', async (ctl) => {
    const { words, language } = await transcribeScope(used, ctl, 0.95);
    if (words.length === 0) {
      toast('info', 'No speech was found', used === 'selection' ? 'The selected clips seem to have no spoken words.' : 'The timeline seems to have no spoken words.');
      return 0;
    }
    const prefs = speechPrefs();
    const groups = groupCaptions(words, { maxCharsPerLine: captionMaxChars(), maxLines: prefs.maxLines });
    let ids: ID[] = [];
    updateProject((p) => {
      ids = placeCaptions(
        p,
        groups.map((g) => ({ start: g.start, end: g.end, text: g.text, words: g.words })),
        { presetId: prefs.captionPreset, position: prefs.captionPosition, replace: prefs.replaceCaptions },
      );
    });
    ctl.progress(1);
    const run = useSpeech.getState().lastRun;
    toast('success', `Added ${ids.length} caption${ids.length === 1 ? '' : 's'}`, `${languageName(language)}${run ? ` · ${run.audioSeconds.toFixed(0)} s of audio in ${run.seconds.toFixed(1)} s` : ''}`);
    return ids.length;
  });
}

/** Caption clips the Captions tab edits: all of them, or just `ids`. */
export function captionTargets(ids: ID[], all = speechPrefs().applyToAll): ID[] {
  return all ? captionClips(getProject()).map((c) => c.id) : ids;
}

function editCaptions(ids: ID[], recipe: (clip: TextClip, p: Project) => void, coalesce?: string): void {
  updateProject(
    (p) => {
      for (const id of ids) {
        const c = p.clips[id];
        if (c && c.type === 'text') recipe(c, p);
      }
    },
    coalesce ? { coalesce } : undefined,
  );
}

export function applyCaptionPreset(presetId: string, ids: ID[]): void {
  const preset = getCaptionPreset(presetId);
  if (!preset) return;
  editCaptions(ids, (c, p) => {
    const style = presetTextStyle(preset, p.settings, DEFAULT_TEXT_STYLE);
    // Keep the caption's own text, size changes made later are reset by design (presets define size).
    c.text = { ...style, content: c.text.content };
    c.caption = { words: c.caption?.words ?? retimeCaptionWords(c.text.content, undefined, c.duration), highlight: preset.highlight, highlightColor: preset.highlightColor };
  });
  useSpeech.getState().setPrefs({ captionPreset: presetId });
}

export function setCaptionHighlight(ids: ID[], patch: { highlight?: CaptionHighlight; highlightColor?: string }): void {
  editCaptions(
    ids,
    (c) => {
      c.caption = { highlight: 'none', highlightColor: '#ffd84d', ...c.caption, ...patch };
      if (!c.caption.words) c.caption.words = retimeCaptionWords(c.text.content, undefined, c.duration);
    },
    patch.highlightColor ? 'caption-highlight-color' : undefined,
  );
}

export function setCaptionPosition(ids: ID[], position: CaptionPosition): void {
  editCaptions(ids, (c, p) => {
    c.transform.y = captionY(p.settings, position);
    c.transform.x = 0;
  });
  useSpeech.getState().setPrefs({ captionPosition: position });
}

export function setCaptionY(ids: ID[], y: number): void {
  editCaptions(ids, (c) => void (c.transform.y = y), 'caption-y');
}

export function setCaptionFontSize(ids: ID[], size: number): void {
  editCaptions(
    ids,
    (c) => {
      const k = size / Math.max(1, c.text.fontSize);
      c.text.fontSize = size;
      if (c.text.stroke) c.text.stroke = { ...c.text.stroke, width: Math.max(1, Math.round(c.text.stroke.width * k)) };
    },
    'caption-size',
  );
}

export function setCaptionColor(ids: ID[], color: string): void {
  editCaptions(ids, (c) => void (c.text.fill = { type: 'solid', color }), 'caption-color');
}

/** Edit one caption's text; word timings are kept when the word count is unchanged. */
export function setCaptionText(id: ID, content: string): void {
  editCaptions(
    [id],
    (c) => {
      c.text.content = content;
      c.name = content.replace(/\s+/g, ' ').slice(0, 40) || 'Caption';
      c.caption = { highlight: 'none', highlightColor: '#ffd84d', ...c.caption, words: retimeCaptionWords(content, c.caption?.words, c.duration) };
    },
    `caption-text-${id}`,
  );
}

export async function importSubtitles(testPath?: string): Promise<number | null> {
  try {
    const file = await api.call<{ path: string; name: string; text: string } | null>('x:speech:openSubtitles', testPath);
    if (!file) return null;
    const cues = parseSubtitles(file.text);
    if (cues.length === 0) {
      toast('error', 'No captions found', `"${file.name}" does not contain SRT or WebVTT cues.`);
      return 0;
    }
    const prefs = speechPrefs();
    let ids: ID[] = [];
    updateProject((p) => {
      ids = placeCaptions(p, cues, { presetId: prefs.captionPreset, position: prefs.captionPosition, replace: prefs.replaceCaptions });
    });
    toast('success', `Imported ${ids.length} caption${ids.length === 1 ? '' : 's'}`, file.name);
    return ids.length;
  } catch (err) {
    toast('error', 'Could not import captions', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function exportSubtitles(format: 'srt' | 'vtt'): Promise<string | null> {
  const p = getProject();
  const range = p.inPoint !== undefined && p.outPoint !== undefined && p.outPoint > p.inPoint ? { start: p.inPoint, end: p.outPoint } : undefined;
  const cues = collectCaptionCues(p, range);
  if (cues.length === 0) {
    toast('info', 'There are no captions to export', 'Add captions with Auto captions or import a subtitle file first.');
    return null;
  }
  try {
    const path = await api.call<string | null>('x:speech:saveSubtitles', p.name || 'captions', format, format === 'vtt' ? toVtt(cues) : toSrt(cues));
    if (path) {
      useUI.getState().toast({ kind: 'success', message: `Exported ${cues.length} captions`, detail: path, action: { label: 'Show', run: () => void api.app.showItemInFolder(path) } });
    }
    return path;
  } catch (err) {
    toast('error', 'Could not export captions', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Select a caption clip and move the playhead into it. */
export function gotoCaption(id: ID): void {
  const c = getProject().clips[id];
  if (!c) return;
  useUI.getState().select([id]);
  engine.pause();
  engine.seek(c.start + Math.min(0.1, c.duration / 2));
}

// ---------------------------------------------------------------------------------------------
// Review playback
// ---------------------------------------------------------------------------------------------

let stopPreview: (() => void) | null = null;

/** Play `[start - lead, end + tail]` of the timeline once. */
export function previewRange(start: number, end: number, lead = 0.8, tail = 0.6): void {
  stopPreview?.();
  const stopAt = end + tail;
  engine.pause();
  engine.seek(Math.max(0, start - lead), { snap: false });
  engine.play();
  const off = engine.onTime((t) => {
    if (t >= stopAt || !engine.playing) {
      off();
      stopPreview = null;
      if (engine.playing) engine.pause();
    }
  });
  stopPreview = () => {
    off();
    stopPreview = null;
  };
}

// ---------------------------------------------------------------------------------------------
// Filler words
// ---------------------------------------------------------------------------------------------

export function findFillers(scope: Scope): Promise<number | null> {
  const used = effectiveScope(scope);
  return runJob('fillers', 'Filler word search', async (ctl) => {
    const { words, trackIds } = await transcribeScope(used, ctl);
    const candidates = detectFillers(words);
    useSpeech.getState().set({ fillers: { words, candidates, selected: candidates.map((c) => c.confidence >= 0.6), scope: used, trackIds } });
    if (candidates.length === 0) toast('info', 'No filler words found', words.length ? `Checked ${words.length} words.` : 'No speech was found.');
    return candidates.length;
  });
}

function cutTracks(base: ID[]): ID[] {
  const p = getProject();
  return speechPrefs().rippleAllTracks ? p.tracks.filter((t) => !t.locked).map((t) => t.id) : base;
}

export function removeSelectedFillers(): void {
  const review = useSpeech.getState().fillers;
  if (!review) return;
  const ranges = review.candidates.filter((_, i) => review.selected[i]).map((c) => ({ start: c.start, end: c.end }));
  if (ranges.length === 0) return;
  let removed = 0;
  updateProject((p) => {
    removed = rippleCutRanges(p, ranges, cutTracks(review.trackIds)).removed;
  });
  useSpeech.getState().set({ fillers: null, transcripts: [] });
  useUI.getState().clearSelection();
  toast('success', `Removed ${ranges.length} filler word${ranges.length === 1 ? '' : 's'}`, `${removed.toFixed(1)} s shorter`);
}

// ---------------------------------------------------------------------------------------------
// Silence
// ---------------------------------------------------------------------------------------------

export function detectSilence(scope: Scope): Promise<number | null> {
  const used = effectiveScope(scope);
  return runJob('silence', 'Silence detection', async (ctl) => {
    const p = getProject();
    const prefs = speechPrefs();
    const opts = { thresholdDb: prefs.silenceThreshold, minDuration: prefs.silenceMin, padding: prefs.silencePadding };
    let ranges: TimeRange[] = [];
    let trackIds: ID[];
    if (used === 'selection') {
      const clips = selectedSoundClips(p);
      trackIds = [...linkedTrackIds(p, clips.map((c) => c.id))];
      const total = clips.reduce((s, c) => s + c.duration, 0) || 1;
      let done = 0;
      for (const c of clips) {
        const audio = await decodeClip(p, c, { sampleRate: 16000, channels: 1, signal: ctl.signal, onProgress: (r) => ctl.progress((done + r * c.duration * 0.8) / total, 'Reading audio…') });
        const found = await analyseSilence(audio.channels[0], 16000, opts, ctl.signal);
        ranges.push(...found.map((r) => ({ start: c.start + r.start, end: Math.min(clipEnd(c), c.start + r.end) })));
        done += c.duration;
      }
    } else {
      if (!hasTimelineAudio(p)) throw new Error('The timeline has no sound to analyse.');
      trackIds = p.tracks.filter((t) => !t.locked).map((t) => t.id);
      const end = projectDuration(p);
      const audio = await mixTimeline(p, 0, end, { sampleRate: 16000, channels: 1, signal: ctl.signal, onProgress: (r) => ctl.progress(r * 0.9, 'Reading audio…') });
      ranges = await analyseSilence(audio.channels[0], 16000, opts, ctl.signal);
    }
    ranges = ranges.filter((r) => r.end - r.start > 0.05).sort((a, b) => a.start - b.start);
    useSpeech.getState().set({ silences: { ranges, selected: ranges.map(() => true), scope: used, trackIds } });
    ctl.progress(1);
    if (ranges.length === 0) toast('info', 'No silences found', 'Try a higher threshold or a shorter minimum length.');
    return ranges.length;
  });
}

export function removeSelectedSilences(): void {
  const review = useSpeech.getState().silences;
  if (!review) return;
  const ranges = review.ranges.filter((_, i) => review.selected[i]);
  if (ranges.length === 0) return;
  let removed = 0;
  updateProject((p) => {
    removed = rippleCutRanges(p, ranges, cutTracks(review.trackIds)).removed;
  });
  useSpeech.getState().set({ silences: null, transcripts: [] });
  useUI.getState().clearSelection();
  toast('success', `Removed ${ranges.length} silence${ranges.length === 1 ? '' : 's'}`, `${removed.toFixed(1)} s shorter`);
}

export const selectedLength = (ranges: TimeRange[], selected: boolean[]): number => rangesLength(ranges.filter((_, i) => selected[i]));

// ---------------------------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------------------------

/** The music clip to analyse: the selected audio clip, else the longest audio clip. */
export function musicClipForBeats(p: Project = getProject()): SoundClip | null {
  const sel = selectedSoundClips(p);
  if (sel.length) return sel[0];
  const audio = getAudioClips(p).filter((c) => c.type === 'audio');
  return audio.sort((a, b) => b.duration - a.duration)[0] ?? null;
}

export function detectBeatsFor(clipId?: ID, beatsPerBar = 4): Promise<{ bpm: number; beats: number } | null> {
  return runJob('beats', 'Beat detection', async (ctl) => {
    const p = getProject();
    const clip = clipId ? (p.clips[clipId] as SoundClip | undefined) : musicClipForBeats(p);
    if (!clip || (clip.type !== 'audio' && clip.type !== 'video')) throw new Error('Select a music clip first.');
    const audio = await decodeClip(p, clip, { sampleRate: 22050, channels: 1, signal: ctl.signal, onProgress: (r) => ctl.progress(r * 0.6, 'Reading audio…') });
    ctl.progress(0.65, 'Finding the beat…');
    const res = await analyseBeats(audio.channels[0], 22050, { beatsPerBar }, ctl.signal);
    if (res.beats.length < 2) throw new Error('No steady beat was found in this clip.');
    const down = new Set(res.downbeats.map((d) => d.toFixed(4)));
    updateProject((draft) => {
      const fps = draft.settings.fps;
      const a = clip.start;
      const b = clipEnd(clip);
      // Replace earlier beat markers in this clip's range; keep the user's own markers.
      draft.markers = draft.markers.filter((m) => !(isBeatMarker(m) && m.time >= a - 1e-6 && m.time <= b + 1e-6));
      let bar = 0;
      for (const t of res.beats) {
        const time = snapToFrame(a + t, fps);
        if (time < a || time > b) continue;
        const isDown = down.has(t.toFixed(4));
        if (isDown) bar++;
        if (draft.markers.some((m) => Math.abs(m.time - time) < 1e-4)) continue;
        draft.markers.push({ id: uid('mk_'), time, label: isDown ? `Bar ${bar}` : 'Beat', color: isDown ? DOWNBEAT_COLOR : BEAT_COLOR });
      }
      draft.markers.sort((x, y) => x.time - y.time);
    });
    ctl.progress(1);
    toast('success', `${Math.round(res.bpm)} BPM · ${res.beats.length} beats`, `${res.downbeats.length} bars marked on the timeline.`);
    return { bpm: res.bpm, beats: res.beats.length };
  });
}

export function clearBeatMarkers(): void {
  updateProject((p) => {
    p.markers = p.markers.filter((m) => !isBeatMarker(m));
  });
}

export function beatTimes(unit: 'beat' | 'bar', p: Project = getProject()): number[] {
  return p.markers.filter((m) => (unit === 'bar' ? m.color === DOWNBEAT_COLOR && isBeatMarker(m) : isBeatMarker(m))).map((m) => m.time).sort((a, b) => a - b);
}

const visualSelection = (p: Project): Clip[] =>
  useUI
    .getState()
    .selection.map((id) => p.clips[id])
    .filter((c): c is Clip => !!c && c.type !== 'audio' && !p.tracks.find((t) => t.id === c.trackId)?.locked);

/** Split the selected visual clips at every beat (or bar) inside them. */
export function splitAtBeats(unit: 'beat' | 'bar'): number {
  const p = getProject();
  const beats = beatTimes(unit, p);
  const clips = visualSelection(p);
  if (!beats.length) {
    toast('info', 'Detect the beat first', 'Run Beat detection on a music clip to place beat markers.');
    return 0;
  }
  if (!clips.length) {
    toast('info', 'Select the clips to cut', 'Select one or more video or image clips on the timeline.');
    return 0;
  }
  let cuts = 0;
  const created: ID[] = [];
  updateProject((draft) => {
    for (const c of clips) {
      let current = c.id;
      for (const t of beats) {
        const clip = draft.clips[current];
        if (!clip || t <= clip.start + 1e-6 || t >= clipEnd(clip) - 1e-6) continue;
        const right = splitClipAt(draft, current, t, draft.settings.fps);
        if (right) {
          cuts++;
          created.push(right);
          current = right;
        }
      }
    }
  });
  if (cuts) toast('success', `Cut at ${cuts} ${unit === 'bar' ? 'bar' : 'beat'}${cuts === 1 ? '' : 's'}`);
  else toast('info', 'No beats fall inside the selected clips');
  return cuts;
}

/** Lay the selected clips out one per beat (or bar), starting at the first beat at / after the earliest one. */
export function sequenceOnBeats(unit: 'beat' | 'bar', every = 1): number {
  const p = getProject();
  const beats = beatTimes(unit, p);
  const clips = visualSelection(p).sort((a, b) => a.start - b.start || p.tracks.findIndex((t) => t.id === a.trackId) - p.tracks.findIndex((t) => t.id === b.trackId));
  if (beats.length < 2) {
    toast('info', 'Detect the beat first', 'Run Beat detection on a music clip to place beat markers.');
    return 0;
  }
  if (!clips.length) {
    toast('info', 'Select the clips to arrange', 'Select the images or clips to place on the beat.');
    return 0;
  }
  const first = Math.max(0, beats.findIndex((t) => t >= clips[0].start - 1e-6));
  const slots: { start: number; end: number }[] = [];
  for (let i = first; i + every < beats.length && slots.length < clips.length; i += every) slots.push({ start: beats[i], end: beats[i + every] });
  if (!slots.length) {
    toast('info', 'Not enough beats after the selected clips');
    return 0;
  }
  const placed = Math.min(slots.length, clips.length);
  const ids = clips.slice(0, placed).map((c) => c.id);
  const moving = new Set(ids);
  updateProject((draft) => {
    const fps = draft.settings.fps;
    let track = draft.tracks.find((t) => t.id === clips[0].trackId)!;
    const fits = slots.slice(0, placed).every((s) => isFree(draft, track.id, s.start, s.end - s.start, moving));
    if (!fits) track = addTrack(draft, 'visual');
    ids.forEach((id, i) => {
      const c = draft.clips[id];
      const s = slots[i];
      c.trackId = track.id;
      c.start = snapToFrame(s.start, fps);
      const want = Math.max(1 / fps, snapToFrame(s.end, fps) - c.start);
      c.duration = Math.min(want, maxDurationFromSource(c, draft.assets));
    });
    pruneEmptyTracks(draft);
    if (draft.tracks.some((t) => t.role === 'captions')) ensureCaptionTrack(draft);
  });
  useUI.getState().select(ids);
  toast('success', `Placed ${placed} clip${placed === 1 ? '' : 's'} on the ${unit === 'bar' ? 'bars' : 'beat'}`);
  return placed;
}

// ---------------------------------------------------------------------------------------------
// Noise reduction
// ---------------------------------------------------------------------------------------------

/** The selected clip noise reduction works on. */
export function denoiseTarget(p: Project = getProject()): SoundClip | null {
  return selectedSoundClips(p)[0] ?? null;
}

/** Source range processed for a clip: what it uses plus a margin so it can still be trimmed. */
function denoiseRange(clip: SoundClip, asset: MediaAsset): { from: number; to: number } {
  const used0 = clip.trimIn;
  const used1 = clip.trimIn + clip.duration * clip.speed;
  return { from: Math.max(0, used0 - 5), to: Math.min(asset.duration, used1 + 5) };
}

export interface DenoisePreview {
  original: Float32Array[];
  cleaned: Float32Array[];
  sampleRate: number;
  /** Timeline time the preview starts at. */
  start: number;
}

/** Process ~8 s of the clip (around the playhead) for A/B listening. */
export function denoisePreview(strength: number): Promise<DenoisePreview | null> {
  return runJob('denoise', 'Noise reduction preview', async (ctl) => {
    const p = getProject();
    const clip = denoiseTarget(p);
    if (!clip) throw new Error('Select a clip with sound first.');
    const asset = p.assets[clip.assetId];
    const local = engine.time > clip.start && engine.time < clipEnd(clip) - 1 ? engine.time - clip.start : 0;
    const len = Math.min(8, clip.duration - local);
    const s0 = clip.trimIn + local * clip.speed;
    const s1 = s0 + len * clip.speed;
    const sr = 48000;
    // Learn the noise from a longer stretch than we listen to.
    const range = denoiseRange(clip, asset);
    const pf0 = Math.max(range.from, s0 - 20);
    const pf1 = Math.min(range.to, s1 + 20);
    const profile = await decodeAsset(asset, pf0, pf1, { sampleRate: sr, channels: 2, signal: ctl.signal, onProgress: (r) => ctl.progress(r * 0.5, 'Reading audio…') });
    const i0 = Math.round((s0 - pf0) * sr);
    const i1 = Math.round((s1 - pf0) * sr);
    const original = profile.channels.map((ch) => ch.slice(i0, i1));
    const cleaned = await denoiseAudio(original, { strength }, { signal: ctl.signal, profileFrom: profile.channels, onProgress: (r) => ctl.progress(0.5 + r * 0.5, 'Cleaning…') });
    return { original, cleaned, sampleRate: sr, start: clip.start + local };
  });
}

/** Clean the clip's sound, save it as a new WAV asset and swap it in (one undo step). */
export function applyDenoise(strength: number): Promise<boolean | null> {
  return runJob('denoise', 'Noise reduction', async (ctl) => {
    const p = getProject();
    const clip = denoiseTarget(p);
    if (!clip) throw new Error('Select a clip with sound first.');
    const asset = p.assets[clip.assetId];
    const range = denoiseRange(clip, asset);
    const decoded = await decodeAsset(asset, range.from, range.to, { sampleRate: 48000, channels: 2, signal: ctl.signal, onProgress: (r) => ctl.progress(r * 0.3, 'Reading audio…') });
    const cleaned = await denoiseAudio(decoded.channels, { strength }, { signal: ctl.signal, onProgress: (r) => ctl.progress(0.3 + r * 0.6, 'Removing noise…') });
    ctl.progress(0.92, 'Saving…');
    const wav = encodeWav(cleaned, decoded.sampleRate);
    const info = await api.call<FileInfo>('x:speech:saveAudio', 'denoise', `${asset.name.replace(/\.[^.]+$/, '')} (clean)`, new Uint8Array(await wav.arrayBuffer()));
    if (ctl.signal.aborted) throw new ExtractCancelled();
    const store = useProjectStore.getState();
    store.begin();
    try {
      const res = await importMediaFiles([info]);
      const clean = res.assets[0];
      if (!clean) throw new Error(res.failures[0]?.reason ?? 'The cleaned audio could not be imported.');
      updateProject((draft) => {
        draft.assets[clean.id] = { ...draft.assets[clean.id], name: `${asset.name.replace(/\.[^.]+$/, '')} (noise reduced).wav` };
        const c = draft.clips[clip.id] as SoundClip | undefined;
        if (!c) return;
        const trimIn = Math.max(0, c.trimIn - range.from);
        if (c.type === 'audio') {
          c.assetId = clean.id;
          c.trimIn = trimIn;
          return;
        }
        // A video keeps its picture: its sound moves to a linked audio clip with the clean asset.
        const linkId = c.linkId ?? uid('ln_');
        c.linkId = linkId;
        c.muted = true;
        const existing = Object.values(draft.clips).find((o): o is AudioClip => o.type === 'audio' && o.linkId === linkId);
        if (existing) {
          existing.assetId = clean.id;
          existing.trimIn = Math.max(0, existing.trimIn - range.from);
          return;
        }
        const audioTrack = draft.tracks.filter((t) => t.kind === 'audio' && !t.locked).find((t) => isFree(draft, t.id, c.start, c.duration)) ?? addTrack(draft, 'audio');
        const audio: AudioClip = { id: uid('au_'), trackId: audioTrack.id, type: 'audio', name: `${c.name} (clean)`, start: c.start, duration: c.duration, assetId: clean.id, trimIn, speed: c.speed, volume: c.volume, muted: false, fadeIn: c.fadeIn, fadeOut: c.fadeOut, linkId };
        if (c.keyframes?.volume) audio.keyframes = { volume: c.keyframes.volume };
        draft.clips[audio.id] = audio;
      });
      store.commit();
    } catch (err) {
      store.cancel();
      throw err;
    }
    ctl.progress(1);
    toast('success', 'Noise reduced', 'The clip now uses the cleaned sound. Undo restores the original.');
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------------------------

export interface Voice {
  name: string;
  culture: string;
  gender: string;
  age: string;
}

let voicesPromise: Promise<Voice[]> | null = null;

export function loadVoices(): Promise<Voice[]> {
  voicesPromise ??= api.call<Voice[]>('x:speech:voices').catch((err) => {
    voicesPromise = null;
    throw err;
  });
  return voicesPromise;
}

export async function synthesize(text: string, purpose: 'preview' | 'clip'): Promise<FileInfo> {
  const prefs = speechPrefs();
  return api.call<FileInfo>('x:speech:synthesize', { text, voice: prefs.ttsVoice || undefined, rate: prefs.ttsRate, volume: 100, purpose });
}

/** Speak `text` with the chosen voice and place it at the playhead (optionally captioned). */
export async function addSpeech(text: string): Promise<ID | null> {
  const prefs = speechPrefs();
  const clipId = await runJob('tts', 'Text to speech', async (ctl) => {
    ctl.progress(-1, 'Generating speech…');
    const onAbort = (): void => void api.call('x:speech:cancelSynthesis');
    ctl.signal.addEventListener('abort', onAbort);
    let info: FileInfo;
    try {
      info = await synthesize(text, 'clip');
    } finally {
      ctl.signal.removeEventListener('abort', onAbort);
    }
    if (ctl.signal.aborted) throw new ExtractCancelled();
    const store = useProjectStore.getState();
    store.begin();
    try {
      const res = await importMediaFiles([info]);
      const asset = res.assets[0];
      if (!asset) throw new Error(res.failures[0]?.reason ?? 'The speech could not be imported.');
      const voice = prefs.ttsVoice.replace(/^Microsoft\s+|\s+Desktop$/g, '') || 'Voice';
      let id: ID | null = null;
      updateProject((p) => {
        p.assets[asset.id] = { ...p.assets[asset.id], name: `${voice}: ${text.replace(/\s+/g, ' ').slice(0, 40)}` };
        const time = snapToFrame(engine.time, p.settings.fps);
        const track = p.tracks.filter((t) => t.kind === 'audio' && !t.locked).find((t) => isFree(p, t.id, time, asset.duration)) ?? addTrack(p, 'audio');
        const clip: AudioClip = { id: uid('au_'), trackId: track.id, type: 'audio', name: p.assets[asset.id].name, start: time, duration: Math.max(1 / p.settings.fps, snapToFrame(asset.duration, p.settings.fps)), assetId: asset.id, trimIn: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 };
        p.clips[clip.id] = clip;
        id = clip.id;
      });
      store.commit();
      return id;
    } catch (err) {
      store.cancel();
      throw err;
    }
  });
  if (!clipId) return null;
  useUI.getState().select([clipId]);
  if (prefs.ttsCaptions) await autoCaptions('selection');
  else toast('success', 'Speech added at the playhead');
  return clipId;
}

// ---------------------------------------------------------------------------------------------
// Auto-ducking
// ---------------------------------------------------------------------------------------------

/** Music clips to duck: the selected audio clips. */
export function duckTargets(p: Project = getProject()): AudioClip[] {
  return useUI
    .getState()
    .selection.map((id) => p.clips[id])
    .filter((c): c is AudioClip => !!c && c.type === 'audio');
}

export function autoDuck(trackId?: ID): Promise<number | null> {
  return runJob('duck', 'Auto-ducking', async (ctl) => {
    const p = getProject();
    const prefs = speechPrefs();
    const music = trackId ? clipsOnTrack(p, trackId).filter((c): c is AudioClip => c.type === 'audio') : duckTargets(p);
    if (!music.length) throw new Error('Select the music clips (or pick a music track) to duck.');
    const musicIds = new Set(music.map((m) => m.id));
    const voices = getAudioClips(p).filter((c) => !musicIds.has(c.id));
    if (!voices.length) throw new Error('There is no dialogue to duck under: add voice or video clips with sound.');
    const t0 = Math.min(...music.map((m) => m.start));
    const t1 = Math.max(...music.map(clipEnd));
    const audio = await mixTimeline(p, t0, t1, { sampleRate: 16000, channels: 1, only: new Set(voices.map((v) => v.id)), signal: ctl.signal, onProgress: (r) => ctl.progress(r * 0.8, 'Listening for speech…') });
    const regions = (await analyseSpeech(audio.channels[0], 16000, {}, ctl.signal)).map((r) => ({ start: t0 + r.start, end: t0 + r.end }));
    if (!regions.length) {
      toast('info', 'No speech found under the music', 'Nothing was changed.');
      return 0;
    }
    updateProject((draft) => {
      for (const m of music) {
        const c = draft.clips[m.id];
        if (!c || c.type !== 'audio') continue;
        // Ducking replaces the clip's volume automation (running it again does not stack).
        const frames = duckingKeyframes({ start: c.start, duration: c.duration, volume: c.volume }, regions, { depthDb: prefs.duckDepth, attack: prefs.duckAttack, release: prefs.duckRelease });
        c.keyframes = { ...(c.keyframes ?? {}), volume: frames };
      }
    });
    ctl.progress(1);
    toast('success', `Ducked ${music.length} music clip${music.length === 1 ? '' : 's'}`, `${regions.length} speech passage${regions.length === 1 ? '' : 's'} · −${prefs.duckDepth} dB`);
    return regions.length;
  });
}

export function clearDucking(ids: ID[]): void {
  updateProject((p) => {
    for (const id of ids) {
      const c = p.clips[id];
      if (c?.keyframes?.volume) delete c.keyframes.volume;
    }
  });
}
