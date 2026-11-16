import { describe, expect, it } from 'vitest';
import { collectCaptionCues, parseSubtitles, toSrt, toVtt } from '@/core/captions';
import { makeShape, makeText, makeTrack, makeVideo } from '@/core/factory';
import { createProject, designSize } from '@/core/project';
import { reframeProject, setFocusProvider } from '@/core/reframe';
import type { MediaAsset, VisualClip } from '@/core/types';

describe('captions', () => {
  it('collects caption clips from caption tracks and round-trips SRT / VTT', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    const track = { ...makeTrack('visual', 'Captions'), role: 'captions' as const };
    p.tracks.unshift(track);
    const a = makeText('Hello there', { start: 1, duration: 1.5 });
    const b = makeText('General Kenobi', { start: 3, duration: 2 });
    a.trackId = b.trackId = track.id;
    p.clips[a.id] = a;
    p.clips[b.id] = b;
    const other = makeText('Not a caption', { start: 0, duration: 9 });
    other.trackId = p.tracks.find((t) => t.kind === 'visual' && t.id !== track.id)!.id;
    p.clips[other.id] = other;

    const cues = collectCaptionCues(p);
    expect(cues.map((c) => c.text)).toEqual(['Hello there', 'General Kenobi']);
    const srt = toSrt(cues);
    expect(srt).toContain('00:00:01,000 --> 00:00:02,500');
    expect(parseSubtitles(srt)).toEqual(cues);
    expect(parseSubtitles(toVtt(cues))).toEqual(cues);
    expect(collectCaptionCues(p, { start: 2, end: 4 })).toEqual([
      { start: 0, end: 0.5, text: 'Hello there' },
      { start: 1, end: 2, text: 'General Kenobi' },
    ]);
  });
});

describe('reframe', () => {
  const asset: MediaAsset = {
    id: 'v',
    kind: 'video',
    name: 'v.mp4',
    source: { type: 'file', path: 'C:/v.mp4' },
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: false,
    size: 1,
    addedAt: 0,
  };

  it('fills a vertical frame with full-frame footage and keeps overlays inside', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    p.assets.v = asset;
    const track = p.tracks[0];
    const video = makeVideo(asset);
    video.trackId = track.id;
    p.clips[video.id] = video;
    const title = makeShape('rect', { width: 800, height: 200, x: 500, y: 300 });
    title.trackId = track.id;
    title.start = 20;
    p.clips[title.id] = title;

    const r = reframeProject(p, 1080, 1920);
    const { cw, ch } = designSize(r.settings);
    expect([cw, ch]).toEqual([1080, 1920]);
    // 16:9 footage contain-fits a 9:16 frame at 1080 wide; covering 1920 tall needs ×3.16.
    expect((r.clips[video.id] as VisualClip).transform.scaleX).toBeCloseTo(1920 / 607.5, 2);
    expect(Math.abs((r.clips[title.id] as VisualClip).transform.x)).toBeLessThan(cw / 2);
    expect(p.settings.width).toBe(1920); // input untouched
  });

  it('pans toward the subject reported by the focus provider', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    p.assets.v = asset;
    const video = makeVideo(asset);
    video.trackId = p.tracks[0].id;
    p.clips[video.id] = video;
    setFocusProvider(() => [
      { t: 0, x: 0.2, y: 0.5 },
      { t: 5, x: 0.8, y: 0.5 },
    ]);
    const r = reframeProject(p, 1080, 1920);
    setFocusProvider(null);
    const xs = r.clips[video.id].keyframes!.x!;
    expect(xs[0].v).toBeGreaterThan(0); // subject on the left → layer moves right
    expect(xs[1].v).toBeLessThan(0);
  });
});
