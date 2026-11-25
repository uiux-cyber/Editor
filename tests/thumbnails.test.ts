import { describe, expect, it } from 'vitest';
import { commitView, resolveEditPath } from '@/core/compound';
import { makeImage, makeText } from '@/core/factory';
import { createProject, parseProjectFile, serializeProject } from '@/core/project';
import { createThumbnail, duplicateThumbnail, frameLayer, nextThumbnailName, thumbnailOfPath, thumbnailPathId, thumbnailProject } from '@/core/thumbnails';
import type { MediaAsset, Project } from '@/core/types';

const frame: MediaAsset = {
  id: 'as_frame',
  kind: 'image',
  name: 'Frame',
  source: { type: 'file', path: 'C:/Kinora/Thumbnails/frame.png' },
  duration: 0,
  width: 1280,
  height: 720,
  fps: 0,
  hasVideo: true,
  hasAudio: false,
  size: 1000,
  addedAt: 0,
};

function withThumbnail(): Project {
  const p = createProject({ width: 1280, height: 720, fps: 30 });
  p.assets[frame.id] = frame;
  const video = makeText('MAIN', { duration: 4 });
  video.trackId = p.tracks.find((t) => t.kind === 'visual')!.id;
  p.clips[video.id] = video;
  p.thumbnails = [createThumbnail(p, { asset: frame, time: 2 })];
  return p;
}

describe('thumbnails', () => {
  it('names variants A, B, C… skipping names in use', () => {
    expect(nextThumbnailName(undefined)).toBe('Thumbnail A');
    const p = withThumbnail();
    expect(nextThumbnailName(p.thumbnails)).toBe('Thumbnail B');
    p.thumbnails![0].name = 'Thumbnail B';
    expect(nextThumbnailName(p.thumbnails)).toBe('Thumbnail A');
  });

  it('starts with the captured frame covering the picture', () => {
    const p = withThumbnail();
    const th = p.thumbnails![0];
    const clips = Object.values(th.sequence.clips);
    expect(clips).toHaveLength(1);
    expect(clips[0].type === 'image' && clips[0].assetId === frame.id).toBe(true);
    expect(th.frameAssetId).toBe(frame.id);
    expect(th.frameTime).toBe(2);
    // A square picture covers a 16:9 frame (scaled up, not letterboxed).
    const square = frameLayer(p, { ...frame, width: 500, height: 500 }, 'tr');
    expect(square.transform.scaleX).toBeCloseTo(1280 / 720, 3);
  });

  it('opens through the edit path and writes edits back into the thumbnail', () => {
    const p = withThumbnail();
    const th = p.thumbnails![0];
    const path = [thumbnailPathId(th.id)];
    expect(thumbnailOfPath(path)).toBe(th.id);
    const { view, path: valid } = resolveEditPath(p, path);
    expect(valid).toEqual(path);
    expect(Object.keys(view.clips)).toEqual(Object.keys(th.sequence.clips));
    expect(view.thumbnails).toBeUndefined();
    // Edit the view: add a title.
    const title = makeText('BIG WORDS', { duration: 5 });
    title.trackId = view.tracks[0].id;
    const edited: Project = { ...view, clips: { ...view.clips, [title.id]: title } };
    const root = commitView(p, path, edited);
    expect(Object.keys(root.thumbnails![0].sequence.clips)).toHaveLength(2);
    // The video timeline is untouched.
    expect(root.clips).toBe(p.clips);
  });

  it('falls back to the video when the open thumbnail is gone', () => {
    const p = withThumbnail();
    const r = resolveEditPath(p, [thumbnailPathId('missing')]);
    expect(r.path).toEqual([]);
    expect(r.view).toBe(p);
    expect(commitView(p, [thumbnailPathId('missing')], p)).toBe(p);
  });

  it('duplicates with new ids for the thumbnail and its layers', () => {
    const p = withThumbnail();
    const a = p.thumbnails![0];
    const extra = makeImage(frame, { duration: 5 });
    extra.trackId = a.sequence.tracks[0].id;
    a.sequence.clips[extra.id] = extra;
    const b = duplicateThumbnail(p, a);
    expect(b.id).not.toBe(a.id);
    expect(b.name).toBe('Thumbnail B');
    expect(Object.keys(b.sequence.clips)).toHaveLength(2);
    for (const id of Object.keys(b.sequence.clips)) expect(a.sequence.clips[id]).toBeUndefined();
    // Independent copies.
    Object.values(b.sequence.clips)[0].name = 'changed';
    expect(Object.values(a.sequence.clips).some((c) => c.name === 'changed')).toBe(false);
  });

  it('renders as a project with the document settings and media', () => {
    const p = withThumbnail();
    const view = thumbnailProject(p, p.thumbnails![0]);
    expect(view.settings).toBe(p.settings);
    expect(view.assets).toBe(p.assets);
    expect(view.thumbnails).toBeUndefined();
  });

  it('is saved and loaded with the project, sanitised', () => {
    const p = withThumbnail();
    const text = serializeProject(p);
    const back = parseProjectFile(text);
    expect(back.thumbnails).toHaveLength(1);
    const th = back.thumbnails![0];
    expect(th.name).toBe('Thumbnail A');
    expect(th.frameAssetId).toBe(frame.id);
    expect(Object.keys(th.sequence.clips)).toHaveLength(1);
    expect(th.sequence.tracks.some((t) => t.kind === 'visual')).toBe(true);

    // Broken entries are dropped; clips without their media are dropped; missing frames are forgotten.
    const raw = JSON.parse(text);
    raw.project.thumbnails.push({ id: 7 }, { id: 'th_x', name: '', sequence: { tracks: 'no', clips: { a: { id: 'a', type: 'image', assetId: 'gone', trackId: 'x', start: 0, duration: 1 } } }, time: -3, frameAssetId: 'gone' });
    const loaded = parseProjectFile(JSON.stringify(raw));
    expect(loaded.thumbnails).toHaveLength(2);
    const x = loaded.thumbnails![1];
    expect(x.name).toBe('Thumbnail');
    expect(x.time).toBe(0);
    expect(x.frameAssetId).toBeUndefined();
    expect(Object.keys(x.sequence.clips)).toHaveLength(0);
    expect(x.sequence.tracks.length).toBeGreaterThan(0);
  });

  it('leaves projects without thumbnails unchanged', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    expect(parseProjectFile(serializeProject(p)).thumbnails).toBeUndefined();
  });
});
