import { describe, expect, it } from 'vitest';
import { Ease } from '@/core/easing';
import { kf, makeShape, makeSlot, makeText, makeTrack, makeVideo } from '@/core/factory';
import { evalKeyframes, propAt, withKeyframe, withoutKeyframe } from '@/core/keyframes';
import {
  cleanupTransitions,
  createProject,
  designSize,
  fillSlot,
  insertTemplateLayers,
  nearestFreeStart,
  parseProjectFile,
  rippleDelete,
  serializeProject,
  setTransition,
  splitClipAt,
} from '@/core/project';
import { formatTimecode, snapToFrame } from '@/core/time';
import type { MediaAsset, Project, VideoClip } from '@/core/types';

const asset = (over: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'as_video',
  kind: 'video',
  name: 'clip.mp4',
  source: { type: 'file', path: 'C:/media/clip.mp4' },
  duration: 20,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 1000,
  addedAt: 0,
  ...over,
});

function projectWithVideos(...starts: [number, number][]): { p: Project; ids: string[] } {
  const p = createProject({ width: 1920, height: 1080, fps: 30 });
  const a = asset();
  p.assets[a.id] = a;
  const track = p.tracks.find((t) => t.kind === 'visual')!;
  const ids = starts.map(([start, duration]) => {
    const clip = makeVideo(a, { start, duration });
    clip.trackId = track.id;
    p.clips[clip.id] = clip;
    return clip.id;
  });
  return { p, ids };
}

describe('time', () => {
  it('snaps to the frame grid', () => {
    expect(snapToFrame(1.01, 30)).toBeCloseTo(1, 6);
    expect(snapToFrame(1.02, 30)).toBeCloseTo(31 / 30, 6);
  });
  it('formats timecode', () => {
    expect(formatTimecode(61.5, 30)).toBe('01:01:15');
    expect(formatTimecode(3661, 25)).toBe('01:01:01:00');
  });
});

describe('easing and keyframes', () => {
  it('every easing curve maps 0 → 0 and 1 → 1', () => {
    for (const [name, fn] of Object.entries(Ease)) {
      if (name === 'hold') continue;
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
  });
  it('interpolates keyframes and clamps outside the range', () => {
    const frames = [kf(0, 0, 'linear'), kf(2, 100, 'linear')];
    expect(evalKeyframes(frames, -1, 5)).toBe(0);
    expect(evalKeyframes(frames, 1, 5)).toBeCloseTo(50);
    expect(evalKeyframes(frames, 9, 5)).toBe(100);
    expect(evalKeyframes(undefined, 1, 5)).toBe(5);
  });
  it('adds, replaces and removes keyframes', () => {
    let frames = withKeyframe(undefined, 1, 10);
    frames = withKeyframe(frames, 0, 0);
    frames = withKeyframe(frames, 1, 20);
    expect(frames.map((f) => [f.t, f.v])).toEqual([
      [0, 0],
      [1, 20],
    ]);
    expect(withoutKeyframe(frames, 1)).toHaveLength(1);
  });
});

describe('timeline operations', () => {
  it('splits a media clip keeping source continuity and keyframe values', () => {
    const { p, ids } = projectWithVideos([2, 6]);
    const clip = p.clips[ids[0]] as VideoClip;
    clip.trimIn = 1;
    clip.keyframes = { opacity: [kf(0, 0, 'linear'), kf(6, 1, 'linear')] };
    const right = splitClipAt(p, clip.id, 5, 30)!;
    const r = p.clips[right] as VideoClip;
    expect(clip.duration).toBeCloseTo(3);
    expect(r.start).toBeCloseTo(5);
    expect(r.duration).toBeCloseTo(3);
    expect(r.trimIn).toBeCloseTo(4);
    // The opacity at the cut (3 s into a 0 → 1 ramp over 6 s) is preserved on both halves.
    expect(propAt(clip, 'opacity', 3)).toBeCloseTo(0.5);
    expect(propAt(r, 'opacity', 0)).toBeCloseTo(0.5);
    expect(propAt(r, 'opacity', 3)).toBeCloseTo(1);
  });

  it('refuses to split at the very edge of a clip', () => {
    const { p, ids } = projectWithVideos([0, 4]);
    expect(splitClipAt(p, ids[0], 0, 30)).toBeNull();
    expect(splitClipAt(p, ids[0], 4, 30)).toBeNull();
  });

  it('ripple delete closes the gap', () => {
    const { p, ids } = projectWithVideos([0, 2], [2, 3], [5, 1]);
    rippleDelete(p, [ids[1]]);
    expect(p.clips[ids[2]].start).toBeCloseTo(2);
  });

  it('finds the nearest free slot on a track', () => {
    const { p } = projectWithVideos([0, 2], [3, 2]);
    const track = p.tracks.find((t) => t.kind === 'visual')!;
    expect(nearestFreeStart(p, track.id, 1, 1)).toBeCloseTo(2);
    expect(nearestFreeStart(p, track.id, 2.5, 2)).toBeCloseTo(5);
  });

  it('only keeps transitions between touching clips and clamps their length', () => {
    const { p, ids } = projectWithVideos([0, 2], [2, 0.5]);
    const tr = setTransition(p, ids[0], ids[1], 'fade', 3)!;
    expect(tr.duration).toBeCloseTo(0.5);
    p.clips[ids[1]].start = 2.5;
    cleanupTransitions(p);
    expect(Object.keys(p.transitions)).toHaveLength(0);
    expect(setTransition(p, ids[0], ids[1], 'fade', 1)).toBeNull();
  });

  it('places template layers on new tracks in stacking order', () => {
    const p = createProject({ width: 1080, height: 1920, fps: 30 });
    const bg = makeShape('rect', { width: 100, height: 100, duration: 5 });
    const a = makeText('A', { start: 0, duration: 2 });
    const b = makeText('B', { start: 2, duration: 3 });
    const top = makeShape('star', { width: 50, height: 50, duration: 5 });
    const ids = insertTemplateLayers(p, [bg, a, b, top], 1, 30);
    expect(ids).toHaveLength(4);
    const order = p.tracks.map((t) => t.id);
    const trackOf = (i: number): number => order.indexOf(p.clips[ids[i]].trackId);
    // Index 0 renders on top: the star must sit above the texts, which sit above the background.
    expect(trackOf(3)).toBeLessThan(trackOf(1));
    expect(trackOf(1)).toBeLessThan(trackOf(0));
    // The two texts never overlap in time, so they share one track.
    expect(trackOf(1)).toBe(trackOf(2));
    expect(p.clips[ids[0]].start).toBeCloseTo(1);
    expect(new Set(ids.map((id) => p.clips[id].groupId)).size).toBe(1);
  });

  it('fills a media placeholder, cropping the media to cover it', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    const track = makeTrack('visual', 'V2');
    p.tracks.unshift(track);
    const slot = makeSlot({ width: 600, height: 600, x: 100, duration: 4, start: 1, radius: 40 });
    slot.trackId = track.id;
    p.clips[slot.id] = slot;
    const a = asset();
    p.assets[a.id] = a;
    const id = fillSlot(p, slot.id, a)!;
    const clip = p.clips[id] as VideoClip;
    expect(p.clips[slot.id]).toBeUndefined();
    expect(clip.type).toBe('video');
    expect(clip.start).toBe(1);
    expect(clip.transform.x).toBe(100);
    // A 16:9 picture in a square slot loses width on both sides.
    expect(clip.crop!.l).toBeCloseTo((1 - 9 / 16) / 2, 4);
    const { cw, ch } = designSize(p.settings);
    expect(cw).toBe(1920);
    expect(ch).toBe(1080);
  });
});

describe('placeholders with motion', () => {
  it('scales a placeholder’s scale keyframes (a slow push in) with the media', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    const track = makeTrack('visual', 'V2');
    p.tracks.unshift(track);
    const slot = makeSlot({ width: 600, height: 400, duration: 4, keyframes: { scaleX: [kf(0, 1), kf(4, 1.1)], scaleY: [kf(0, 1), kf(4, 1.1)] } });
    slot.trackId = track.id;
    p.clips[slot.id] = slot;
    const a = asset();
    p.assets[a.id] = a;
    const clip = p.clips[fillSlot(p, slot.id, a)!] as VideoClip;
    // The keyframes keep their relative motion on top of the fitted size.
    expect(clip.keyframes!.scaleX![0].v).toBeCloseTo(clip.transform.scaleX, 6);
    expect(clip.keyframes!.scaleX![1].v).toBeCloseTo(clip.transform.scaleX * 1.1, 6);
    expect(clip.keyframes!.scaleY![1].v).toBeCloseTo(clip.transform.scaleY * 1.1, 6);
    expect(clip.transform.scaleX).toBeLessThan(1);
  });
});

describe('project files', () => {
  it('round-trips through serialise / parse', () => {
    const { p } = projectWithVideos([0, 2], [2, 3]);
    const again = parseProjectFile(serializeProject(p));
    expect(Object.keys(again.clips).sort()).toEqual(Object.keys(p.clips).sort());
    expect(again.settings).toEqual(p.settings);
  });

  it('rejects files that are not projects or come from a newer version', () => {
    expect(() => parseProjectFile('not json')).toThrow();
    expect(() => parseProjectFile(JSON.stringify({ app: 'other' }))).toThrow();
    expect(() => parseProjectFile(JSON.stringify({ app: 'kinora', version: 999, project: {} }))).toThrow(/newer version/);
  });

  it('drops clips whose media is gone and repairs track order', () => {
    const { p, ids } = projectWithVideos([0, 2]);
    delete p.assets['as_video'];
    p.tracks.reverse();
    const again = parseProjectFile(JSON.stringify({ app: 'kinora', version: 1, project: p }));
    expect(again.clips[ids[0]]).toBeUndefined();
    expect(again.tracks[0].kind).toBe('visual');
    expect(again.tracks[again.tracks.length - 1].kind).toBe('audio');
  });
});
