import { describe, expect, it } from 'vitest';
import { parseSubtitles, toSrt, toVtt } from '@/core/captions';
import { makeShape, makeText, makeTrack, makeVideo } from '@/core/factory';
import { createProject, parseProjectFile, serializeProject } from '@/core/project';
import type { MediaAsset, Project } from '@/core/types';
import { exportCaptionCues, withoutBurnedCaptions } from '@/engine/export/captions';
import type { ExportProgress, ExportSettings } from '@/engine/export/exporter';
import { PLATFORM_PRESETS, aspectName, frameFor, getPreset, presetSettings, presetSpec, sameAspect } from '@/engine/export/presets';
import { EMPTY_QUEUE, isBusy, nextJob, reduceQueue, totalProgress, type ExportJob, type QueueState } from '@/engine/export/queueState';
import { clearInOut, defaultRangeMode, markedRange, resolveRange, setInPoint, setOutPoint, shiftInOut } from '@/engine/export/range';
import { defaultCustom, outputName, planTarget, type ExportOptions } from '@/engine/export/targets';

const exportCues = exportCaptionCues;

function project(w = 1920, h = 1080, fps = 30): Project {
  const p = createProject({ width: w, height: h, fps });
  const shape = makeShape('rect', { start: 0, duration: 10, width: 400, height: 300 });
  shape.trackId = p.tracks.find((t) => t.kind === 'visual')!.id;
  p.clips[shape.id] = shape;
  return p;
}

function withCaptions(p: Project): Project {
  const track = { ...makeTrack('visual', 'Captions'), role: 'captions' as const };
  p.tracks.unshift(track);
  for (const [text, start, duration] of [
    ['First line', 0.5, 1.5],
    ['Second line', 2.5, 2],
    ['Third line', 6, 2],
  ] as const) {
    const c = makeText(text, { start, duration });
    c.trackId = track.id;
    p.clips[c.id] = c;
  }
  return p;
}

const opts = (over: Partial<ExportOptions> = {}): ExportOptions => ({ range: { start: 0, end: 10 }, time: 0, audio: true, burnInCaptions: true, sidecars: [], embedSubtitles: false, ...over });

// ---------------------------------------------------------------------------------------------

describe('platform presets', () => {
  it('maps every preset to complete export settings', () => {
    const p = project();
    for (const preset of PLATFORM_PRESETS) {
      const s = presetSettings(preset, p.settings, { start: 1, end: 4 });
      expect(s.width % 2, preset.id).toBe(0);
      expect(s.height % 2, preset.id).toBe(0);
      expect(s.fps, preset.id).toBeLessThanOrEqual(preset.fpsCap);
      expect(s.container).toBe(preset.container);
      expect(s.videoCodec).toBe(preset.videoCodec);
      expect(s.audioBitrate).toBe(preset.audioBitrate);
      expect(s.videoBitrate, preset.id).toBeGreaterThan(0);
      expect([s.start, s.end]).toEqual([1, 4]);
      expect(presetSpec(preset, p.settings)).toMatch(/^\d+ × \d+ · \d+ fps · H\.264 · [\d.]+ Mbps$/);
    }
  });

  it('uses each platform’s frame, frame-rate cap and bitrates', () => {
    const p60 = project(1920, 1080, 60);
    const shorts = presetSettings(getPreset('youtube-shorts')!, p60.settings, { start: 0, end: 5 });
    expect([shorts.width, shorts.height, shorts.fps, shorts.videoBitrate]).toEqual([1080, 1920, 60, 15_000_000]);
    const reels = presetSettings(getPreset('instagram-reels')!, p60.settings, { start: 0, end: 5 });
    expect([reels.width, reels.height, reels.fps]).toEqual([1080, 1920, 30]);
    const feed = presetSettings(getPreset('instagram-portrait')!, p60.settings, { start: 0, end: 5 });
    expect([feed.width, feed.height]).toEqual([1080, 1350]);
    expect(aspectName(feed.width, feed.height)).toBe('4:5');
    const square = presetSettings(getPreset('instagram-square')!, p60.settings, { start: 0, end: 5 });
    expect(aspectName(square.width, square.height)).toBe('1:1');
    const yt4k = presetSettings(getPreset('youtube-4k')!, project(1920, 1080, 30).settings, { start: 0, end: 5 });
    expect([yt4k.width, yt4k.height, yt4k.fps, yt4k.videoBitrate]).toEqual([3840, 2160, 30, 40_000_000]);
    const x = getPreset('x')!;
    expect(x.maxDuration).toBe(140);
  });

  it('keeps the project aspect for the master and web presets', () => {
    const vertical = project(1080, 1920, 25);
    const master = presetSettings(getPreset('master')!, vertical.settings, { start: 0, end: 1 });
    expect([master.width, master.height, master.fps, master.quality]).toEqual([1080, 1920, 25, 'best']);
    expect(master.videoBitrate).toBeGreaterThan(12_000_000);
    const small = presetSettings(getPreset('web-small')!, vertical.settings, { start: 0, end: 1 });
    expect([small.width, small.height, small.fps]).toEqual([720, 1280, 25]);
    expect(small.fastStart).toBe(true);
  });

  it('computes frames for aspects', () => {
    const p = project();
    expect(frameFor('9:16', p.settings)).toEqual({ width: 1080, height: 1920 });
    expect(frameFor('1:1', p.settings, 720)).toEqual({ width: 720, height: 720 });
    expect(frameFor('source', p.settings, 720)).toEqual({ width: 1280, height: 720 });
    expect(sameAspect(3840, 2160, p.settings)).toBe(true);
    expect(sameAspect(1080, 1350, p.settings)).toBe(false);
  });
});

describe('targets', () => {
  it('reframes the project only for other aspects', () => {
    const p = project();
    const yt = planTarget(p, 'youtube-1080p', defaultCustom(p), opts())!;
    expect(yt.reframed).toBe(false);
    expect(yt.project).toBe(p);
    const tiktok = planTarget(p, 'tiktok', defaultCustom(p), opts())!;
    expect(tiktok.reframed).toBe(true);
    expect([tiktok.project.settings.width, tiktok.project.settings.height]).toEqual([1080, 1920]);
    expect(tiktok.aspect).toBe('9:16');
    expect(p.settings.width).toBe(1920); // the source project is untouched
    expect(tiktok.settings).toMatchObject({ width: 1080, height: 1920, start: 0, end: 10 });
  });

  it('plans custom, transparent and sequence outputs', () => {
    const p = project();
    const c = { ...defaultCustom(p), transparent: true, formatId: 'webm-alpha' };
    const t = planTarget(p, 'custom', c, opts())!;
    expect(t.settings).toMatchObject({ container: 'webm', videoCodec: 'vp9', transparent: true });
    const seq = planTarget(p, 'custom', { ...c, formatId: 'png-sequence' }, opts())!;
    expect(seq.kind).toBe('folder');
    expect(seq.settings.container).toBe('png-sequence');
    // Transparency falls back to an alpha-capable format.
    const forced = planTarget(p, 'custom', { ...defaultCustom(p), transparent: true, formatId: 'mp4-avc' }, opts())!;
    expect(forced.settings.container).toBe('webm');
    expect(forced.settings.transparent).toBe(true);
    // The still frame uses the playhead, not the range.
    const still = planTarget(p, 'custom', { ...defaultCustom(p), formatId: 'png' }, opts({ time: 3.5 }))!;
    expect([still.settings.start, still.settings.end]).toEqual([3.5, 3.5]);
    expect(planTarget(p, 'nope', defaultCustom(p), opts())).toBeNull();
  });

  it('names outputs', () => {
    const p = project();
    const custom = planTarget(p, 'custom', defaultCustom(p), opts())!;
    expect(outputName('Trip', custom, false)).toBe('Trip.mp4');
    const shorts = planTarget(p, 'youtube-shorts', defaultCustom(p), opts())!;
    expect(outputName('Trip', shorts, true)).toBe('Trip - YouTube Shorts 9x16.mp4');
    const master = planTarget(p, 'master', defaultCustom(p), opts())!;
    expect(outputName('Trip', master, true)).toBe('Trip - Master 16x9.mp4');
    const feed = planTarget(p, 'instagram-portrait', defaultCustom(p), opts())!;
    expect(outputName('Trip', feed, true)).toBe('Trip - Instagram feed 4x5.mp4');
    const seq = planTarget(p, 'custom', { ...defaultCustom(p), formatId: 'png-sequence' }, opts())!;
    expect(outputName('Trip', seq, false)).toBe('Trip - PNG sequence');
  });

  it('passes caption options through', () => {
    const p = withCaptions(project());
    const t = planTarget(p, 'youtube-1080p', defaultCustom(p), opts({ burnInCaptions: false, sidecars: ['srt', 'vtt'], embedSubtitles: true }))!;
    expect(t.settings).toMatchObject({ burnInCaptions: false, sidecars: ['srt', 'vtt'], embedSubtitles: true });
  });
});

describe('export range', () => {
  it('resolves the whole project, the In–Out section and the selection', () => {
    const p = project();
    expect(resolveRange(p, 'all')).toMatchObject({ start: 0, end: 10, valid: true });
    expect(resolveRange(p, 'inout').valid).toBe(false);
    expect(defaultRangeMode(p)).toBe('all');

    p.inPoint = 2;
    expect(resolveRange(p, 'inout')).toMatchObject({ start: 2, end: 10, valid: true });
    p.outPoint = 5.5;
    expect(resolveRange(p, 'inout')).toMatchObject({ start: 2, end: 5.5, valid: true });
    expect(defaultRangeMode(p)).toBe('inout');
    delete p.inPoint;
    expect(markedRange(p)).toEqual({ start: 0, end: 5.5 });
    // Marks past the end are clamped to the project.
    p.outPoint = 99;
    expect(resolveRange(p, 'inout')).toMatchObject({ start: 0, end: 10 });

    const v = makeShape('ellipse', { start: 3, duration: 2, width: 200, height: 200 });
    v.trackId = p.tracks[0].id;
    p.clips[v.id] = v;
    expect(resolveRange(p, 'selection', [v.id])).toMatchObject({ start: 3, end: 5, valid: true });
    expect(resolveRange(p, 'selection', []).valid).toBe(false);
    expect(resolveRange(p, 'selection', ['missing']).valid).toBe(false);
  });

  it('marks In / Out on the frame grid and keeps them ordered', () => {
    const p = project();
    setInPoint(p, 2.01);
    expect(p.inPoint).toBe(2);
    setOutPoint(p, 6.5);
    expect([p.inPoint, p.outPoint]).toEqual([2, 6.5]);
    // An In after the Out clears the Out (and vice versa).
    setInPoint(p, 7);
    expect([p.inPoint, p.outPoint]).toEqual([7, undefined]);
    setOutPoint(p, 3);
    expect([p.inPoint, p.outPoint]).toEqual([undefined, 3]);
    p.inPoint = 1;
    shiftInOut(p, { start: 1, end: 3 }, 20, 10);
    expect([p.inPoint, p.outPoint]).toEqual([8, 10]);
    shiftInOut(p, { start: 8, end: 10 }, -20, 10);
    expect([p.inPoint, p.outPoint]).toEqual([0, 2]);
    clearInOut(p);
    expect(resolveRange(p, 'inout').valid).toBe(false);
  });

  it('persists In / Out in the project file', () => {
    const p = project();
    p.inPoint = 1.5;
    p.outPoint = 4;
    const back = parseProjectFile(serializeProject(p));
    expect([back.inPoint, back.outPoint]).toEqual([1.5, 4]);
    const none = parseProjectFile(serializeProject(project()));
    expect('inPoint' in none).toBe(false);
  });
});

describe('caption range re-basing', () => {
  it('limits cues to the range and re-bases them on its start', () => {
    const p = withCaptions(project());
    const cues = exportCues(p, { start: 2, end: 7 });
    expect(cues).toEqual([
      { start: 0.5, end: 2.5, text: 'Second line' },
      { start: 4, end: 5, text: 'Third line' },
    ]);
    const srt = toSrt(cues);
    expect(srt).toContain('00:00:00,500 --> 00:00:02,500');
    expect(srt).toContain('00:00:04,000 --> 00:00:05,000');
    const vtt = toVtt(cues);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(parseSubtitles(vtt)).toEqual(cues);
    // A range that cuts a cue keeps only the overlapping part.
    expect(exportCues(p, { start: 1, end: 3 })).toEqual([
      { start: 0, end: 1, text: 'First line' },
      { start: 1.5, end: 2, text: 'Second line' },
    ]);
    // The whole project keeps the timeline times.
    expect(exportCues(p, { start: 0, end: 10 }).map((c) => c.start)).toEqual([0.5, 2.5, 6]);
  });

  it('ignores text clips outside caption tracks and hidden caption tracks', () => {
    const p = withCaptions(project());
    const other = makeText('Title', { start: 0, duration: 10 });
    other.trackId = p.tracks.find((t) => t.kind === 'visual' && t.role !== 'captions')!.id;
    p.clips[other.id] = other;
    expect(exportCues(p, { start: 0, end: 10 })).toHaveLength(3);
    // Burn-in off hides the caption track in the render copy only.
    const render = withoutBurnedCaptions(p);
    expect(render.tracks.find((t) => t.role === 'captions')!.hidden).toBe(true);
    expect(p.tracks[0].hidden).toBe(false);
    expect(render.clips).toBe(p.clips);
    const plain = project();
    expect(withoutBurnedCaptions(plain)).toBe(plain);
    p.tracks[0].hidden = true;
    expect(exportCues(p, { start: 0, end: 10 })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------

const progress = (ratio: number, speed = 30, eta = 1): ExportProgress => ({ phase: 'rendering', ratio, frame: Math.round(ratio * 100), totalFrames: 100, speed, eta });

function job(id: string, weight = 100): ExportJob {
  return {
    id,
    batch: 0,
    label: id,
    detail: '',
    aspect: '16:9',
    output: { path: `C:/out/${id}.mp4`, kind: 'file' },
    project: project(),
    settings: {} as ExportSettings,
    weight,
    status: 'queued',
    progress: null,
    attempts: 0,
    createdAt: 0,
  };
}

describe('export queue state machine', () => {
  const run = (s: QueueState, ...actions: Parameters<typeof reduceQueue>[1][]): QueueState => actions.reduce(reduceQueue, s);
  const status = (s: QueueState): string[] => s.jobs.map((j) => `${j.id}:${j.status}`);

  it('runs jobs one after another', () => {
    let s = run(EMPTY_QUEUE, { type: 'add', jobs: [job('a'), job('b', 300)] });
    expect(s.batch).toBe(1);
    expect(isBusy(s)).toBe(true);
    expect(nextJob(s)?.id).toBe('a');
    // Only the next job may start.
    expect(run(s, { type: 'start', id: 'b' })).toBe(s);
    s = run(s, { type: 'start', id: 'a' });
    expect(status(s)).toEqual(['a:running', 'b:queued']);
    expect(nextJob(s)).toBeUndefined();
    s = run(s, { type: 'progress', id: 'a', progress: progress(0.5) });
    expect(totalProgress(s).ratio).toBeCloseTo(50 / 400);
    // ETA covers the running job and the queued work at the measured speed.
    expect(totalProgress(s).eta).toBeCloseTo(1 + 300 / 30);
    s = run(s, { type: 'complete', id: 'a', result: { seconds: 2, frames: 100, bytes: 1000, extraFiles: [] } });
    expect(status(s)).toEqual(['a:done', 'b:queued']);
    expect(totalProgress(s)).toMatchObject({ ratio: 0.25, finished: 1, total: 2 });
    s = run(s, { type: 'start', id: 'b' }, { type: 'fail', id: 'b', error: 'Disk full' });
    expect(status(s)).toEqual(['a:done', 'b:failed']);
    expect(s.jobs[1].error).toBe('Disk full');
    expect(isBusy(s)).toBe(false);
    expect(totalProgress(s).ratio).toBe(1);
  });

  it('cancels queued and running jobs', () => {
    let s = run(EMPTY_QUEUE, { type: 'add', jobs: [job('a'), job('b')] }, { type: 'start', id: 'a' });
    s = run(s, { type: 'cancel', id: 'b' });
    expect(status(s)).toEqual(['a:running', 'b:cancelled']);
    s = run(s, { type: 'cancel', id: 'a' });
    expect(status(s)).toEqual(['a:cancelling', 'b:cancelled']);
    // Progress is ignored while cancelling; the runner then confirms.
    expect(run(s, { type: 'progress', id: 'a', progress: progress(0.9) })).toBe(s);
    s = run(s, { type: 'cancelled', id: 'a' });
    expect(status(s)).toEqual(['a:cancelled', 'b:cancelled']);
    expect(isBusy(s)).toBe(false);
    // Cancelling a finished job does nothing.
    expect(run(s, { type: 'cancel', id: 'a' })).toBe(s);
  });

  it('retries failed and cancelled jobs at the back of the queue', () => {
    let s = run(EMPTY_QUEUE, { type: 'add', jobs: [job('a'), job('b')] }, { type: 'start', id: 'a' }, { type: 'fail', id: 'a', error: 'x' });
    s = run(s, { type: 'retry', id: 'a' });
    expect(status(s)).toEqual(['b:queued', 'a:queued']);
    expect(s.jobs[1].error).toBeUndefined();
    expect(nextJob(s)?.id).toBe('b');
    s = run(s, { type: 'start', id: 'b' }, { type: 'complete', id: 'b', result: { seconds: 1, frames: 1, bytes: 1, extraFiles: [] } }, { type: 'start', id: 'a' });
    expect(s.jobs[1].attempts).toBe(2);
    // Done jobs cannot be retried.
    expect(run(s, { type: 'retry', id: 'b' })).toBe(s);
  });

  it('removes finished jobs but never a running one', () => {
    let s = run(EMPTY_QUEUE, { type: 'add', jobs: [job('a'), job('b'), job('c')] }, { type: 'start', id: 'a' });
    expect(run(s, { type: 'remove', id: 'a' })).toBe(s);
    s = run(s, { type: 'remove', id: 'c' });
    expect(status(s)).toEqual(['a:running', 'b:queued']);
    s = run(s, { type: 'complete', id: 'a', result: { seconds: 1, frames: 1, bytes: 1, extraFiles: [] } }, { type: 'clearFinished' });
    expect(status(s)).toEqual(['b:queued']);
  });

  it('starts a new batch for jobs added while idle', () => {
    let s = run(EMPTY_QUEUE, { type: 'add', jobs: [job('a')] });
    s = run(s, { type: 'add', jobs: [job('b')] });
    expect(s.jobs.map((j) => j.batch)).toEqual([1, 1]);
    s = run(s, { type: 'start', id: 'a' }, { type: 'complete', id: 'a', result: { seconds: 1, frames: 1, bytes: 1, extraFiles: [] } }, { type: 'start', id: 'b' }, { type: 'complete', id: 'b', result: { seconds: 1, frames: 1, bytes: 1, extraFiles: [] } });
    s = run(s, { type: 'add', jobs: [job('c')] });
    expect(s.batch).toBe(2);
    expect(totalProgress(s)).toMatchObject({ ratio: 0, finished: 0, total: 1 });
    // Cancelled jobs do not hold the total back.
    s = run(s, { type: 'add', jobs: [job('d')] }, { type: 'cancel', id: 'd' }, { type: 'start', id: 'c' }, { type: 'complete', id: 'c', result: { seconds: 1, frames: 1, bytes: 1, extraFiles: [] } });
    expect(totalProgress(s)).toMatchObject({ ratio: 1, finished: 1, total: 1 });
  });
});

// Keep the sample video asset helper used by other suites in sync with the model.
describe('reframed snapshots', () => {
  it('fills a vertical frame with landscape footage', () => {
    const asset: MediaAsset = { id: 'v', kind: 'video', name: 'v.mp4', source: { type: 'file', path: 'C:/v.mp4' }, duration: 10, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false, size: 1, addedAt: 0 };
    const p = project();
    p.assets.v = asset;
    const clip = makeVideo(asset, { start: 0 });
    clip.trackId = p.tracks.find((t) => t.kind === 'visual')!.id;
    p.clips[clip.id] = clip;
    const t = planTarget(p, 'instagram-reels', defaultCustom(p), opts())!;
    const v = t.project.clips[clip.id] as typeof clip;
    // Contain-fit in 9:16 is width-bound; filling needs ~3.16× (16/9 ÷ 9/16).
    expect(v.transform.scaleX).toBeCloseTo((16 / 9) * (16 / 9), 1);
  });
});
