import { describe, expect, it } from 'vitest';
import { makeAudio, makeText, makeVideo } from '@/core/factory';
import {
  clampEdit,
  expandSelection,
  groupClips,
  insertOnMain,
  linkClips,
  mainInsertionCut,
  packMainTrack,
  rippleTrim,
  rollEdit,
  slideClip,
  slipClip,
  splitClipsAt,
  trimClip,
  ungroupClips,
  unlinkClips,
} from '@/core/editing';
import { addTrack, createProject, detachAudio, insertClipsAt, mainTrackId, parseProjectFile, pruneEmptyTracks, removeClips, serializeProject } from '@/core/project';
import { clipEnd } from '@/core/time';
import type { MediaAsset, Project } from '@/core/types';

const FPS = 30;

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

/** A project with video clips on V1 given as [start, duration, trimIn?]. */
function setup(clips: [number, number, number?][], opts: { magnetic?: boolean } = {}): { p: Project; ids: string[]; v1: string; a1: string } {
  const p = createProject({ width: 1920, height: 1080, fps: FPS });
  p.magneticMain = !!opts.magnetic;
  const a = asset();
  p.assets[a.id] = a;
  const v1 = p.tracks.find((t) => t.kind === 'visual')!.id;
  const a1 = p.tracks.find((t) => t.kind === 'audio')!.id;
  const ids = clips.map(([start, duration, trimIn = 0]) => {
    const clip = makeVideo(a, { start, duration });
    clip.trimIn = trimIn;
    clip.trackId = v1;
    p.clips[clip.id] = clip;
    return clip.id;
  });
  return { p, ids, v1, a1 };
}

const span = (p: Project, id: string): [number, number] => [+p.clips[id].start.toFixed(4), +p.clips[id].duration.toFixed(4)];
const trimIn = (p: Project, id: string): number => {
  const c = p.clips[id];
  return c.type === 'video' || c.type === 'audio' ? +c.trimIn.toFixed(4) : NaN;
};

describe('plain trims', () => {
  it('trim the head: start, duration and in-point move together, limited by the previous clip', () => {
    const { p, ids } = setup([[0, 4], [5, 4, 2]]);
    expect(trimClip(p, ids[1], 'l', 1, FPS)).toBeCloseTo(1);
    expect(span(p, ids[1])).toEqual([6, 3]);
    expect(trimIn(p, ids[1])).toBeCloseTo(3);
    // Extending left is limited by the gap (1 s to the previous clip end at 4) and the media.
    expect(trimClip(p, ids[1], 'l', -5, FPS)).toBeCloseTo(-2);
    expect(span(p, ids[1])).toEqual([4, 5]);
  });

  it('trim the tail: limited by the media length', () => {
    const { p, ids } = setup([[0, 4, 14]]);
    expect(trimClip(p, ids[0], 'r', 10, FPS)).toBeCloseTo(2); // 20 s of media, in-point at 14
    expect(span(p, ids[0])).toEqual([0, 6]);
  });

  it('never shortens a clip below one frame', () => {
    const { p, ids } = setup([[0, 1]]);
    trimClip(p, ids[0], 'r', -5, FPS);
    expect(p.clips[ids[0]].duration).toBeCloseTo(1 / FPS);
  });
});

describe('ripple trim', () => {
  it('shortening the tail pulls later clips left', () => {
    const { p, ids } = setup([[0, 4], [4, 4], [10, 2]]);
    expect(rippleTrim(p, ids[0], 'r', -1, FPS)).toBeCloseTo(-1);
    expect(span(p, ids[0])).toEqual([0, 3]);
    expect(span(p, ids[1])).toEqual([3, 4]);
    expect(span(p, ids[2])).toEqual([9, 2]);
  });

  it('extending the tail pushes later clips right', () => {
    const { p, ids } = setup([[0, 4], [4, 4]]);
    rippleTrim(p, ids[0], 'r', 2, FPS);
    expect(span(p, ids[0])).toEqual([0, 6]);
    expect(span(p, ids[1])).toEqual([6, 4]);
  });

  it('trimming the head keeps the clip start and closes the gap behind it', () => {
    const { p, ids } = setup([[0, 4], [4, 4, 1], [8, 4]]);
    rippleTrim(p, ids[1], 'l', 1.5, FPS);
    expect(span(p, ids[1])).toEqual([4, 2.5]);
    expect(trimIn(p, ids[1])).toBeCloseTo(2.5);
    expect(span(p, ids[2])).toEqual([6.5, 4]);
    // Extending the head is limited by the media in-point (2.5 s left).
    expect(rippleTrim(p, ids[1], 'l', -4, FPS)).toBeCloseTo(-2.5);
    expect(span(p, ids[2])).toEqual([9, 4]);
  });

  it('linked partners trim in sync and their track ripples too', () => {
    const { p, ids, a1 } = setup([[0, 4], [4, 4]]);
    const au = detachAudio(p, ids[0])!;
    const au2 = detachAudio(p, ids[1])!;
    expect(p.clips[au].trackId).toBe(a1);
    rippleTrim(p, ids[0], 'r', -1, FPS);
    expect(span(p, au)).toEqual([0, 3]);
    expect(span(p, au2)).toEqual([3, 4]);
  });
});

describe('roll', () => {
  it('moves the cut: one clip grows, the other shrinks, the total stays', () => {
    const { p, ids } = setup([[0, 4], [4, 4, 3]]);
    expect(rollEdit(p, ids[0], ids[1], 1, FPS)).toBeCloseTo(1);
    expect(span(p, ids[0])).toEqual([0, 5]);
    expect(span(p, ids[1])).toEqual([5, 3]);
    expect(trimIn(p, ids[1])).toBeCloseTo(4);
    expect(clipEnd(p.clips[ids[1]])).toBeCloseTo(8);
  });

  it('respects the media available to the incoming clip', () => {
    const { p, ids } = setup([[0, 4], [4, 4, 1]]);
    expect(rollEdit(p, ids[0], ids[1], -3, FPS)).toBeCloseTo(-1); // only 1 s of handle before the in-point
    expect(span(p, ids[0])).toEqual([0, 3]);
    expect(trimIn(p, ids[1])).toBeCloseTo(0);
  });

  it('respects the media available to the outgoing clip', () => {
    const { p, ids } = setup([[0, 4, 15], [4, 4]]);
    expect(rollEdit(p, ids[0], ids[1], 3, FPS)).toBeCloseTo(1); // 20 s asset, out-point at 19
  });

  it('rolls linked audio at the same cut', () => {
    const { p, ids } = setup([[0, 4], [4, 4, 2]]);
    const a = detachAudio(p, ids[0])!;
    const b = detachAudio(p, ids[1])!;
    rollEdit(p, ids[0], ids[1], 0.5, FPS);
    expect(span(p, a)).toEqual([0, 4.5]);
    expect(span(p, b)).toEqual([4.5, 3.5]);
  });
});

describe('slip', () => {
  it('shifts the source in / out while position and length stay', () => {
    const { p, ids } = setup([[2, 4, 5]]);
    expect(slipClip(p, ids[0], -2, FPS)).toBeCloseTo(-2); // dragging left shows later material
    expect(span(p, ids[0])).toEqual([2, 4]);
    expect(trimIn(p, ids[0])).toBeCloseTo(7);
    expect(slipClip(p, ids[0], 20, FPS)).toBeCloseTo(7); // cannot go before the first frame
    expect(trimIn(p, ids[0])).toBeCloseTo(0);
    expect(slipClip(p, ids[0], -40, FPS)).toBeCloseTo(-16); // nor past the last one (20 s asset)
    expect(trimIn(p, ids[0])).toBeCloseTo(16);
  });

  it('slips linked audio in sync', () => {
    const { p, ids } = setup([[0, 4, 5]]);
    const a = detachAudio(p, ids[0])!;
    slipClip(p, ids[0], 1, FPS);
    expect(trimIn(p, a)).toBeCloseTo(4);
  });
});

describe('slide', () => {
  it('moves the clip between its neighbours, which compensate', () => {
    const { p, ids } = setup([[0, 4], [4, 2], [6, 4, 3]]);
    expect(slideClip(p, ids[1], 1, FPS)).toBeCloseTo(1);
    expect(span(p, ids[0])).toEqual([0, 5]);
    expect(span(p, ids[1])).toEqual([5, 2]);
    expect(span(p, ids[2])).toEqual([7, 3]);
    expect(trimIn(p, ids[2])).toBeCloseTo(4);
  });

  it('is limited by the neighbours and their media', () => {
    const { p, ids } = setup([[0, 4], [4, 2], [6, 4, 0.5]]);
    expect(slideClip(p, ids[1], -10, FPS)).toBeCloseTo(-0.5); // next clip has 0.5 s of handle
    expect(span(p, ids[0])).toEqual([0, 3.5]);
    // The next clip grew to 4.5 s; sliding right can take all of it but one frame.
    expect(slideClip(p, ids[1], 10, FPS)).toBeCloseTo(4.5 - 1 / FPS);
    expect(p.clips[ids[2]].duration).toBeCloseTo(1 / FPS);
  });

  it('can slide into a gap when there is no neighbour', () => {
    const { p, ids } = setup([[0, 2], [5, 2]]);
    expect(slideClip(p, ids[1], -10, FPS)).toBeCloseTo(-3);
    expect(span(p, ids[1])).toEqual([2, 2]);
  });
});

describe('clampEdit', () => {
  it('returns deltas on the frame grid', () => {
    const { p, ids } = setup([[0, 4], [4, 4, 3]]);
    const d = clampEdit(p, { kind: 'roll', leftId: ids[0], rightId: ids[1] }, 0.51, FPS);
    expect(Math.abs(d * FPS - Math.round(d * FPS))).toBeLessThan(1e-9);
  });
});

describe('magnetic main track', () => {
  it('packs the main track without gaps', () => {
    const { p, ids } = setup([[1, 2], [5, 3]], { magnetic: true });
    expect(packMainTrack(p)).toBe(true);
    expect(span(p, ids[0])).toEqual([0, 2]);
    expect(span(p, ids[1])).toEqual([2, 3]);
    expect(packMainTrack(p)).toBe(false);
  });

  it('closes the gap left by a deleted clip, keeping linked audio in sync', () => {
    const { p, ids } = setup([[0, 2], [2, 3], [5, 4]], { magnetic: true });
    const a3 = detachAudio(p, ids[2])!;
    removeClips(p, [ids[1]]);
    packMainTrack(p);
    expect(span(p, ids[2])).toEqual([2, 4]);
    expect(span(p, a3)).toEqual([2, 4]);
  });

  it('inserts at the nearest cut and pushes later clips', () => {
    const { p, ids, v1 } = setup([[0, 4], [4, 4]], { magnetic: true });
    expect(mainInsertionCut(p, 3.1)).toBe(4);
    expect(mainInsertionCut(p, 1.9)).toBe(0);
    const t = makeText('hi', { duration: 2 });
    t.trackId = v1;
    t.start = 3.5;
    p.clips[t.id] = t;
    expect(insertOnMain(p, [t.id], 3.5)).toBe(4);
    expect(span(p, ids[0])).toEqual([0, 4]);
    expect(span(p, t.id)).toEqual([4, 2]);
    expect(span(p, ids[1])).toEqual([6, 4]);
  });

  it('moves a clip within the main track by reinserting it', () => {
    const { p, ids } = setup([[0, 2], [2, 2], [4, 2]], { magnetic: true });
    // Drag the first clip so its start passes the middle of the last one.
    insertOnMain(p, [ids[0]], 3.1);
    expect(span(p, ids[1])).toEqual([0, 2]);
    expect(span(p, ids[2])).toEqual([2, 2]);
    expect(span(p, ids[0])).toEqual([4, 2]);
  });

  it('ripples trims on the main track automatically', () => {
    const { p, ids } = setup([[0, 4], [4, 4]], { magnetic: true });
    trimClip(p, ids[0], 'r', -1, FPS);
    expect(span(p, ids[1])).toEqual([3, 4]);
    trimClip(p, ids[1], 'l', 1, FPS);
    expect(span(p, ids[1])).toEqual([3, 3]);
  });

  it('is the bottom visual track and survives pruning when empty', () => {
    const p = createProject({ width: 1920, height: 1080, fps: FPS });
    const main = mainTrackId(p)!;
    const top = addTrack(p, 'visual');
    const t = makeText('x', { duration: 2 });
    t.trackId = top.id;
    p.clips[t.id] = t;
    pruneEmptyTracks(p);
    expect(p.tracks.some((tr) => tr.id === main)).toBe(true);
    expect(mainTrackId(p)).toBe(main);
  });

  it('is on for new projects, off for older files, and survives save → reopen', () => {
    const p = createProject({ width: 1920, height: 1080, fps: FPS });
    expect(p.magneticMain).toBe(true);
    expect(parseProjectFile(serializeProject(p)).magneticMain).toBe(true);
    const old = JSON.parse(serializeProject(p));
    delete old.project.magneticMain;
    expect(parseProjectFile(JSON.stringify(old)).magneticMain).toBeUndefined();
  });
});

describe('groups', () => {
  it('group, expand the selection to the group, ungroup', () => {
    const { p, ids } = setup([[0, 2], [2, 2], [4, 2]]);
    const g = groupClips(p, [ids[0], ids[2]]);
    expect(g).toBeTruthy();
    expect(expandSelection(p, [ids[0]]).sort()).toEqual([ids[0], ids[2]].sort());
    expect(expandSelection(p, [ids[0]], { groups: false })).toEqual([ids[0]]);
    ungroupClips(p, [ids[0], ids[2]]);
    expect(p.clips[ids[0]].groupId).toBeUndefined();
  });

  it('a group needs two clips; deleting down to one dissolves it', () => {
    const { p, ids } = setup([[0, 2], [2, 2]]);
    expect(groupClips(p, [ids[0]])).toBeNull();
    groupClips(p, ids);
    removeClips(p, [ids[1]]);
    expect(p.clips[ids[0]].groupId).toBeUndefined();
  });

  it('copies of a group form a new group of their own', () => {
    const { p, ids } = setup([[0, 2], [2, 2]]);
    const g = groupClips(p, ids)!;
    const copies = insertClipsAt(p, ids.map((id) => p.clips[id]), 10);
    const ng = p.clips[copies[0]].groupId;
    expect(ng).toBeTruthy();
    expect(ng).not.toBe(g);
    expect(p.clips[copies[1]].groupId).toBe(ng);
  });

  it('groups and links survive save → reopen', () => {
    const { p, ids } = setup([[0, 2], [2, 2]]);
    groupClips(p, ids);
    const au = detachAudio(p, ids[0])!;
    p.tracks[0].height = 90;
    const back = parseProjectFile(serializeProject(p));
    expect(back.clips[ids[0]].groupId).toBe(p.clips[ids[0]].groupId);
    expect(back.clips[au].linkId).toBe(p.clips[ids[0]].linkId);
    expect(back.tracks[0].height).toBe(90);
  });
});

describe('links', () => {
  it('detaching audio links the two clips', () => {
    const { p, ids } = setup([[0, 4]]);
    const au = detachAudio(p, ids[0])!;
    expect(p.clips[au].linkId).toBeTruthy();
    expect(p.clips[au].linkId).toBe(p.clips[ids[0]].linkId);
    expect(expandSelection(p, [au]).sort()).toEqual([ids[0], au].sort());
    expect(detachAudio(p, ids[0])).toBeNull(); // already detached
  });

  it('splitting a linked clip splits its partner; each half pair stays linked', () => {
    const { p, ids } = setup([[0, 4]]);
    const au = detachAudio(p, ids[0])!;
    const right = splitClipsAt(p, [ids[0]], 2, FPS);
    expect(right).toHaveLength(2);
    const [r1, r2] = right;
    expect(p.clips[r1].linkId).toBeTruthy();
    expect(p.clips[r1].linkId).toBe(p.clips[r2].linkId);
    expect(p.clips[r1].linkId).not.toBe(p.clips[ids[0]].linkId);
    expect(p.clips[ids[0]].linkId).toBe(p.clips[au].linkId);
  });

  it('link and unlink any clips', () => {
    const { p, ids } = setup([[0, 4]]);
    const a = makeAudio(asset({ id: 'as_audio', kind: 'audio', hasVideo: false }), { start: 0, duration: 4 });
    p.assets.as_audio = asset({ id: 'as_audio', kind: 'audio', hasVideo: false });
    a.trackId = p.tracks.find((t) => t.kind === 'audio')!.id;
    p.clips[a.id] = a;
    expect(linkClips(p, [ids[0], a.id])).toBeTruthy();
    expect(expandSelection(p, [a.id])).toContain(ids[0]);
    unlinkClips(p, [ids[0], a.id]);
    expect(p.clips[a.id].linkId).toBeUndefined();
  });

  it('copying only one side of a link drops the link on the copy', () => {
    const { p, ids } = setup([[0, 4]]);
    detachAudio(p, ids[0]);
    const [copy] = insertClipsAt(p, [p.clips[ids[0]]], 10);
    expect(p.clips[copy].linkId).toBeUndefined();
  });

  it('a slide moves linked audio and its neighbours too', () => {
    const { p, ids } = setup([[0, 4], [4, 2], [6, 4, 3]]);
    const audio = ids.map((id) => detachAudio(p, id)!);
    slideClip(p, ids[1], 1, FPS);
    expect(span(p, audio[0])).toEqual([0, 5]);
    expect(span(p, audio[1])).toEqual([5, 2]);
    expect(span(p, audio[2])).toEqual([7, 3]);
  });
});

describe('history', () => {
  it('labels steps, derives labels, and jumps several steps at once', async () => {
    const { useProjectStore } = await import('@/store/project');
    const { p, ids } = setup([[0, 2], [2, 2]]);
    const s = (): ReturnType<typeof useProjectStore.getState> => useProjectStore.getState();
    s().load(p, null);
    s().update((d) => void (d.clips[ids[0]].duration = 1), { label: 'Trim clip' });
    s().update((d) => {
      const c = d.clips[ids[1]];
      if (c.type === 'video') c.transform.opacity = 0.5;
    });
    s().begin();
    s().update((d) => void (d.clips[ids[1]].start = 5));
    s().commit('Move clip');
    expect(s().pastMeta.map((m) => m.label)).toEqual(['Trim clip', 'Change opacity', 'Move clip']);
    s().goTo(0);
    expect(s().project).toBe(p);
    expect(s().futureMeta.map((m) => m.label)).toEqual(['Trim clip', 'Change opacity', 'Move clip']);
    s().goTo(2);
    expect(s().past.length).toBe(2);
    expect(s().project.clips[ids[1]].start).toBe(2);
    s().redo();
    expect(s().project.clips[ids[1]].start).toBe(5);
    s().undo();
    expect(s().pastMeta.map((m) => m.label)).toEqual(['Trim clip', 'Change opacity']);
  });

  it('keeps the magnetic main track packed on every update', async () => {
    const { useProjectStore } = await import('@/store/project');
    const { p, ids } = setup([[0, 2], [2, 2], [4, 2]], { magnetic: true });
    useProjectStore.getState().load(p, null);
    useProjectStore.getState().update((d) => removeClips(d, [ids[1]]));
    expect(useProjectStore.getState().project.clips[ids[2]].start).toBe(2);
    expect(useProjectStore.getState().pastMeta.at(-1)?.label).toBe('Delete video');
  });
});
