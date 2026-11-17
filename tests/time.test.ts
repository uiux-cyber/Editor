import { describe, expect, it } from 'vitest';
import { breakApart, commitView, createCompound, instanceView, resolveEditPath } from '@/core/compound';
import { easeIntegral, applySpeed, consumedAt, curveAverage, curveToRamp, localTimeAtSource, maxDurationFor, maxStartExtension, rampIntegral, rampInverse, RAMP_PRESETS, retimeClip, sourceSpan, sourceTimeAt, speedAt } from '@/core/timemap';
import { kf, makeAudio, makeImage, makeText, makeVideo } from '@/core/factory';
import { pictureRefsAt, soundsAt, mediaInstances } from '@/core/nested';
import { addTrack, createProject, parseProjectFile, serializeProject, setTransition, splitClipAt } from '@/core/project';
import { getAudioClips, getSceneItems } from '@/core/scene';
import type { Clip, CompoundClip, Keyframe, MediaAsset, Project, TextClip, VideoClip } from '@/core/types';
import { Ease } from '@/core/easing';
import { Wsola, resample, stretchConstant } from '@/engine/audio/stretch';
import { useProjectStore } from '@/store/project';

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

/** Numerical ∫₀ᵗ speed(u) du with a fine midpoint rule. */
function numericIntegral(frames: Keyframe[], t: number): number {
  const n = 20000;
  const h = t / n;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const clip = { trimIn: 0, speed: 1, speedRamp: frames, duration: t };
    acc += speedAt(clip, (i + 0.5) * h) * h;
  }
  return acc;
}

describe('time remapping', () => {
  it('integrates eases exactly', () => {
    for (const id of ['linear', 'easeIn', 'easeInOut', 'easeOutCubic', 'easeInOutExpo'] as const) {
      // Midpoint rule reference.
      const n = 4000;
      let ref = 0;
      for (let i = 0; i < n; i++) ref += Ease[id]((i + 0.5) / n) / n;
      expect(easeIntegral(id, 1)).toBeCloseTo(ref, 6);
    }
    expect(easeIntegral('hold', 0.7)).toBe(0);
  });

  it('maps a constant speed', () => {
    const clip = { trimIn: 2, speed: 2, duration: 3 };
    expect(sourceTimeAt(clip, 1.5)).toBeCloseTo(5, 9);
    expect(sourceSpan(clip)).toBeCloseTo(6, 9);
    expect(localTimeAtSource(clip, 5)).toBeCloseTo(1.5, 9);
  });

  it('integrates a speed ramp and inverts it', () => {
    const ramp = [kf(0, 0.5, 'easeInOut'), kf(1.2, 4, 'easeInCubic'), kf(2.5, 1, 'linear'), kf(4, 2, 'easeOutExpo')];
    for (const t of [0.3, 1, 1.9, 3.3, 4, 5.5]) {
      expect(rampIntegral(ramp, t)).toBeCloseTo(numericIntegral(ramp, t), 4);
      expect(rampInverse(ramp, rampIntegral(ramp, t))).toBeCloseTo(t, 8);
    }
    // Held before the first keyframe: s() extends linearly into negative time (transition handles).
    expect(rampIntegral(ramp, -1)).toBeCloseTo(-0.5, 9);
    const clip = { trimIn: 1, speed: 1, speedRamp: ramp, duration: 4 };
    expect(sourceTimeAt(clip, 0)).toBeCloseTo(1, 9);
    expect(sourceTimeAt(clip, 4)).toBeCloseTo(1 + rampIntegral(ramp, 4), 9);
    expect(speedAt(clip, 1.2)).toBeCloseTo(4, 9);
    // Monotonic.
    let last = -Infinity;
    for (let t = 0; t <= 4; t += 0.01) {
      const s = consumedAt(clip, t);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
  });

  it('keeps the source content when a curve changes the duration', () => {
    const a = asset();
    const clip = makeVideo(a, { duration: 4 });
    clip.trimIn = 2;
    const span = sourceSpan(clip);
    const preset = RAMP_PRESETS.find((p) => p.id === 'hero')!;
    applySpeed(clip, preset.points, { assetDuration: a.duration, fps: 30 });
    expect(clip.speedRamp?.length).toBe(preset.points.length);
    expect(clip.duration).toBeCloseTo(span / curveAverage(preset.points), 1);
    expect(Math.abs(sourceSpan(clip) - span)).toBeLessThan(0.05);
    expect(clip.speedRamp![clip.speedRamp!.length - 1].t).toBeCloseTo(clip.duration, 6);
    // Media limit: a slow curve on a clip that already uses the whole asset is clamped.
    const all = makeVideo(a, { duration: 20 });
    applySpeed(all, 0.5, { assetDuration: a.duration, fps: 30, room: 25 });
    expect(all.duration).toBeCloseTo(25, 6);
    expect(maxDurationFor(all, { [a.id]: a })).toBeCloseTo(40, 6);
  });

  it('maps reverse and freeze', () => {
    const clip = { trimIn: 3, speed: 2, reverse: true, duration: 2 };
    expect(sourceTimeAt(clip, 0)).toBeCloseTo(7, 9);
    expect(sourceTimeAt(clip, 2)).toBeCloseTo(3, 9);
    expect(localTimeAtSource(clip, 5)).toBeCloseTo(1, 9);
    const ramped = { trimIn: 1, speed: 1, reverse: true, duration: 3, speedRamp: curveToRamp([{ u: 0, v: 0.5 }, { u: 1, v: 3 }], 3) };
    expect(sourceTimeAt(ramped, 3)).toBeCloseTo(1, 9);
    expect(sourceTimeAt(ramped, 0)).toBeCloseTo(1 + sourceSpan(ramped), 9);
    const frozen = { trimIn: 4.2, speed: 1, freeze: true, duration: 2 };
    expect(sourceTimeAt(frozen, 0)).toBe(4.2);
    expect(sourceTimeAt(frozen, 1.7)).toBe(4.2);
    expect(speedAt(frozen, 1)).toBe(0);
  });

  it('limits trims by the media around reversed clips', () => {
    const a = asset({ duration: 10 });
    const clip = makeVideo(a, { duration: 4 });
    clip.trimIn = 3;
    clip.reverse = true;
    // Start shows source 7; the end can run down to source 0, the start up to source 10.
    expect(maxDurationFor(clip, { [a.id]: a })).toBeCloseTo(7, 9);
    expect(maxStartExtension(clip, { [a.id]: a })).toBeCloseTo(3, 9);
    // Right trim keeps the first frame: retiming re-anchors trimIn.
    const orig = structuredClone(clip);
    retimeClip(clip, orig, 0, 2);
    expect(sourceTimeAt(clip, 0)).toBeCloseTo(7, 9);
    expect(clip.trimIn).toBeCloseTo(5, 9);
  });

  it('splits ramped and reversed clips seamlessly', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    const a = asset();
    p.assets[a.id] = a;
    const track = p.tracks.find((t) => t.kind === 'visual')!;
    for (const reverse of [false, true]) {
      const clip = makeVideo(a, { duration: 6 });
      clip.trimIn = 1;
      clip.reverse = reverse;
      clip.speedRamp = curveToRamp(RAMP_PRESETS[0].points, 6);
      clip.trackId = track.id;
      p.clips[clip.id] = clip;
      const before = structuredClone(clip);
      const rightId = splitClipAt(p, clip.id, 2.5, 30)!;
      const left = p.clips[clip.id] as VideoClip;
      const right = p.clips[rightId] as VideoClip;
      for (const t of [0, 1, 2.4]) expect(sourceTimeAt(left, t)).toBeCloseTo(sourceTimeAt(before, t), 6);
      for (const t of [0, 1, 3.4]) expect(sourceTimeAt(right, t)).toBeCloseTo(sourceTimeAt(before, t + 2.5), 6);
      delete p.clips[clip.id];
      delete p.clips[rightId];
    }
  });

  it('survives save and reopen', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    const a = asset();
    p.assets[a.id] = a;
    const clip = makeVideo(a, { duration: 4 });
    clip.trackId = p.tracks[0].id;
    clip.speedRamp = [kf(0, 2), kf(2, 0.5), { t: 3, v: 99, ease: 'easeOutBack' }];
    clip.reverse = true;
    clip.preservePitch = true;
    p.clips[clip.id] = clip;
    const back = parseProjectFile(serializeProject(p)).clips[clip.id] as VideoClip;
    expect(back.reverse).toBe(true);
    expect(back.preservePitch).toBe(true);
    expect(back.speedRamp?.length).toBe(3);
    // Out of range / overshooting values are made safe.
    expect(back.speedRamp![2].v).toBe(16);
    expect(back.speedRamp![2].ease).toBe('easeInOut');
  });
});

describe('WSOLA time-stretch', () => {
  const sr = 48000;
  const sine = (freq: number, seconds: number): Float32Array => {
    const out = new Float32Array(Math.round(seconds * sr));
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sr);
    return out;
  };
  /** Frequency from positive-going zero crossings in the middle of a signal. */
  const frequency = (x: Float32Array): number => {
    const a = Math.floor(x.length * 0.2);
    const b = Math.floor(x.length * 0.8);
    let first = -1;
    let last = -1;
    let count = 0;
    for (let i = a + 1; i < b; i++) {
      if (x[i - 1] < 0 && x[i] >= 0) {
        if (first < 0) first = i;
        last = i;
        count++;
      }
    }
    return ((count - 1) * sr) / (last - first);
  };

  it('changes the length but keeps the pitch', () => {
    const input = sine(440, 2);
    for (const speed of [2, 0.5, 1.37]) {
      const [out] = stretchConstant([input], speed);
      expect(out.length).toBe(Math.round(input.length / speed));
      expect(Math.abs(frequency(out) - 440)).toBeLessThan(440 * 0.01);
      // No dropouts: RMS of the middle stays close to the input's.
      let rms = 0;
      const mid = out.subarray(Math.floor(out.length * 0.2), Math.floor(out.length * 0.8));
      for (const v of mid) rms += v * v;
      expect(Math.sqrt(rms / mid.length)).toBeGreaterThan(0.3);
    }
  });

  it('streams seamlessly across calls', () => {
    const input = sine(330, 2);
    const whole = stretchConstant([input], 1.5);
    const w = new Wsola(1);
    const parts = [new Float32Array(whole[0].length)];
    let at = 0;
    for (const size of [7000, 13000, 2500, 40000]) {
      const n = Math.min(size, whole[0].length - at);
      const tmp = [new Float32Array(n)];
      w.render(at, n, { start: 0, channels: [input] }, (k) => k * 1.5, tmp);
      parts[0].set(tmp[0], at);
      at += n;
    }
    const rest = [new Float32Array(whole[0].length - at)];
    w.render(at, rest[0].length, { start: 0, channels: [input] }, (k) => k * 1.5, rest);
    parts[0].set(rest[0], at);
    let maxDiff = 0;
    for (let i = 0; i < whole[0].length; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[0][i] - parts[0][i]));
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it('resamples through a ramp like tape', () => {
    const input = sine(200, 1);
    const n = 24000;
    const pos = new Float64Array(n);
    for (let i = 0; i < n; i++) pos[i] = 2 * i; // 2× speed
    const out = [new Float32Array(n)];
    resample({ start: 0, channels: [input] }, pos, out);
    expect(Math.abs(frequency(out[0]) - 400)).toBeLessThan(4);
  });
});

// ---------------------------------------------------------------------------------------------
// Compound clips
// ---------------------------------------------------------------------------------------------

function editProject(): { p: Project; v1: string; v2: string; t: string; au: string; img: string } {
  const p = createProject({ width: 1920, height: 1080, fps: 30 });
  const a = asset();
  const i = asset({ id: 'as_img', kind: 'image', duration: 0, hasAudio: false });
  const s = asset({ id: 'as_snd', kind: 'audio', width: 0, height: 0, hasVideo: false });
  p.assets[a.id] = a;
  p.assets[i.id] = i;
  p.assets[s.id] = s;
  const base = p.tracks.find((t) => t.kind === 'visual')!;
  const top = addTrack(p, 'visual');
  const audioTrack = p.tracks.find((t) => t.kind === 'audio')!;
  const v1 = makeVideo(a, { start: 1, duration: 3 });
  const v2 = makeVideo(a, { start: 4, duration: 2 });
  v2.trimIn = 5;
  const txt = makeText('Title', { start: 2, duration: 3 });
  const img = makeImage(i, { start: 8, duration: 2 });
  const au = makeAudio(s, { start: 1.5, duration: 4 });
  for (const c of [v1, v2, img]) c.trackId = base.id;
  txt.trackId = top.id;
  au.trackId = audioTrack.id;
  for (const c of [v1, v2, txt, img, au] as Clip[]) p.clips[c.id] = c;
  setTransition(p, v1.id, v2.id, 'fade', 0.6);
  return { p, v1: v1.id, v2: v2.id, t: txt.id, au: au.id, img: img.id };
}

const snapshot = (p: Project, ids: string[]): unknown[] =>
  ids
    .map((id) => p.clips[id])
    .map((c) => ({ type: c.type, start: +c.start.toFixed(6), duration: +c.duration.toFixed(6), track: p.tracks.findIndex((t) => t.id === c.trackId), trimIn: 'trimIn' in c ? +c.trimIn.toFixed(6) : 0 }));

describe('compound clips', () => {
  it('creates a compound that keeps timing and layering, and breaks it apart again', () => {
    const { p, v1, v2, t, au, img } = editProject();
    const before = snapshot(p, [v1, v2, t, au]);
    const trackOrder = (ids: string[]): number[] => ids.map((id) => p.tracks.findIndex((tr) => tr.id === p.clips[id].trackId));
    const order = trackOrder([v1, t]);
    const id = createCompound(p, [v1, v2, t, au])!;
    const cp = p.clips[id] as CompoundClip;
    expect(cp.type).toBe('compound');
    expect(cp.start).toBeCloseTo(1, 6);
    expect(cp.duration).toBeCloseTo(5, 6);
    expect(Object.keys(cp.sequence.clips)).toHaveLength(4);
    expect(Object.keys(cp.sequence.transitions)).toHaveLength(1);
    expect(p.clips[v1]).toBeUndefined();
    expect(p.clips[img]).toBeDefined();
    // Nested timing is relative to the compound start.
    expect(cp.sequence.clips[v1].start).toBeCloseTo(0, 6);
    expect(cp.sequence.clips[t].start).toBeCloseTo(1, 6);

    const restored = breakApart(p, id);
    expect(restored.sort()).toEqual([v1, v2, t, au].sort());
    expect(snapshot(p, [v1, v2, t, au]).map((c) => ({ ...(c as object), track: 0 }))).toEqual(before.map((c) => ({ ...(c as object), track: 0 })));
    const after = trackOrder([v1, t]);
    // The title is still above the video.
    expect(after[1] < after[0]).toBe(order[1] < order[0]);
    expect(Object.values(p.transitions)).toHaveLength(1);
  });

  it('breaks apart only the visible part of a trimmed compound', () => {
    const { p, v1, v2, t, au } = editProject();
    const id = createCompound(p, [v1, v2, t, au])!;
    const cp = p.clips[id] as CompoundClip;
    // Show nested 1.5 … 3.5 at timeline 10.
    cp.start = 10;
    cp.trimIn = 1.5;
    cp.duration = 2;
    const ids = breakApart(p, id);
    const v = p.clips[v1] as VideoClip;
    expect(ids).toContain(v1);
    expect(v.start).toBeCloseTo(10, 6);
    expect(v.duration).toBeCloseTo(1.5, 6);
    expect(v.trimIn).toBeCloseTo(1.5, 6);
    // v2 starts at nested 3: only its first half second is visible.
    const w = p.clips[v2] as VideoClip;
    expect(w.start).toBeCloseTo(11.5, 6);
    expect(w.duration).toBeCloseTo(0.5, 6);
    expect(w.trimIn).toBeCloseTo(5, 6);
  });

  it('evaluates nested scenes, sound and media instances', () => {
    const { p, v1, v2, t, au } = editProject();
    const id = createCompound(p, [v1, v2, t, au])!;
    const cp = p.clips[id] as CompoundClip;
    // Root scene: the compound is one layer.
    const items = getSceneItems(p, 2.5);
    expect(items.some((it) => it.kind === 'layer' && it.layer.clip.id === id)).toBe(true);
    // Nested evaluation at root 2.5 → nested 1.5: video v1 (local 1.5) and the title.
    const refs = pictureRefsAt(p, 2.5);
    expect(refs).toHaveLength(1);
    expect(refs[0].clip.id).toBe(`${id}/${v1}`);
    expect(refs[0].localTime).toBeCloseTo(1.5, 6);
    // Inside the nested transition window both sides are needed.
    expect(pictureRefsAt(p, 4).map((r) => r.clip.id).sort()).toEqual([`${id}/${v1}`, `${id}/${v2}`].sort());
    const view = instanceView(p, cp);
    expect(instanceView(p, cp)).toBe(view);
    expect(Object.keys(view.transitions)[0].startsWith(`${id}/`)).toBe(true);
    // Sound: nested audio and the nested video's own sound, scaled by the compound volume.
    cp.volume = 0.5;
    const heard = soundsAt(p, 3);
    expect(heard.map((s) => s.clip.id).sort()).toEqual([`${id}/${v1}`, `${id}/${au}`].sort());
    expect(heard[0].gain).toBeCloseTo(0.5, 6);
    expect(getAudioClips(p).length).toBeGreaterThanOrEqual(3);
    const inst = mediaInstances(p).find((m) => m.clip.id === `${id}/${au}`)!;
    expect(inst.origin).toBeCloseTo(1.5, 6);
    expect(inst.from).toBeCloseTo(1.5, 6);
    expect(inst.to).toBeCloseTo(5.5, 6);
    // Freeze frames are silent.
    (cp.sequence.clips[v1] as VideoClip).freeze = true;
    const p2 = { ...p, clips: { ...p.clips, [id]: { ...cp, sequence: { ...cp.sequence } } } };
    expect(soundsAt(p2, 3).some((s) => s.clip.id === `${id}/${v1}`)).toBe(false);
  });

  it('edits a nested sequence through a view and writes it back', () => {
    const { p, v1, v2, t, au } = editProject();
    const id = createCompound(p, [v1, v2, t, au])!;
    const { view, path } = resolveEditPath(p, [id]);
    expect(path).toEqual([id]);
    expect(Object.keys(view.clips)).toHaveLength(4);
    // Lengthen the last nested clip: the compound (which showed everything) follows.
    const edited: Project = { ...view, clips: { ...view.clips, [t]: { ...view.clips[t], duration: 6 } } };
    const root = commitView(p, path, edited);
    expect((root.clips[id] as CompoundClip).duration).toBeCloseTo(7, 6);
    expect((root.clips[id] as CompoundClip).sequence.clips[t].duration).toBe(6);
    // A missing compound drops the path.
    expect(resolveEditPath(createProject({ width: 1920, height: 1080, fps: 30 }), [id]).path).toEqual([]);
  });

  it('survives save and reopen with nested sequences', () => {
    const { p, v1, v2, t, au } = editProject();
    const id = createCompound(p, [v1, v2, t, au])!;
    // Nest it again.
    const outer = createCompound(p, [id])!;
    const back = parseProjectFile(serializeProject(p));
    const o = back.clips[outer] as CompoundClip;
    expect(o.type).toBe('compound');
    const inner = o.sequence.clips[id] as CompoundClip;
    expect(Object.keys(inner.sequence.clips)).toHaveLength(4);
    expect(Object.keys(inner.sequence.transitions)).toHaveLength(1);
    expect(pictureRefsAt(back, 2.5)[0].clip.id).toBe(`${outer}/${id}/${v1}`);
    // Splitting a compound keeps both halves showing the right nested time.
    const right = splitClipAt(back, outer, 3, 30)!;
    expect((back.clips[right] as CompoundClip).trimIn).toBeCloseTo(2, 6);
  });
});

describe('compound editing context', () => {
  it('edits a nested sequence through the store with one shared undo history', () => {
    const { p, v1, v2, t, au } = editProject();
    const id = createCompound(p, [v1, v2, t, au])!;
    const store = useProjectStore.getState();
    store.load(p, null, true);
    useProjectStore.getState().setEditPath([id]);
    let s = useProjectStore.getState();
    expect(s.editPath).toEqual([id]);
    expect(Object.keys(s.project.clips).sort()).toEqual([v1, v2, t, au].sort());
    // An edit inside writes into the document and is one undo step.
    s.update((d) => void ((d.clips[t] as TextClip).transform.opacity = 0.25));
    s = useProjectStore.getState();
    expect((s.root.clips[id] as CompoundClip).sequence.clips[t].type).toBe('text');
    expect(((s.root.clips[id] as CompoundClip).sequence.clips[t] as Clip & { transform: { opacity: number } }).transform.opacity).toBe(0.25);
    expect(s.past).toHaveLength(1);
    expect(s.root).not.toBe(s.savedRef);
    s.undo();
    s = useProjectStore.getState();
    expect(s.editPath).toEqual([id]);
    expect((s.project.clips[t] as Clip & { transform: { opacity: number } }).transform.opacity).toBe(1);
    s.redo();
    expect((useProjectStore.getState().project.clips[t] as Clip & { transform: { opacity: number } }).transform.opacity).toBe(0.25);
    // A gesture inside the compound is one step and can be cancelled.
    useProjectStore.getState().begin();
    useProjectStore.getState().update((d) => void (d.clips[t].start = 2));
    useProjectStore.getState().cancel();
    expect(useProjectStore.getState().project.clips[t].start).toBeCloseTo(1, 6);
    // Closing returns to the document, which kept the edit.
    useProjectStore.getState().setEditPath([]);
    s = useProjectStore.getState();
    expect(s.project).toBe(s.root);
    expect(s.project.clips[id].type).toBe('compound');
  });
});
