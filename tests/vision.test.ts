import { describe, expect, it } from 'vitest';
import { seededRandom } from '@/core/easing';
import { makeVideo } from '@/core/factory';
import { createProject } from '@/core/project';
import { reframeProject, setFocusProvider } from '@/core/reframe';
import type { MediaAsset, VisualClip } from '@/core/types';
import { evalCamera, smoothCameraPath, type FocusSample } from '@/vision/algo/camera';
import { compileGrade, gradePixels, labStats, matchColors, statDistance } from '@/vision/algo/color';
import { cutScore, detectCuts, frameDifference, frameFeatures, type FrameStat } from '@/vision/algo/scenes';
import { TemplateTracker, cleanTrack, reduceKeyframes, type GrayFrame } from '@/vision/algo/tracker';

// ---------------------------------------------------------------------------------------------
// Camera path
// ---------------------------------------------------------------------------------------------

function samples(fn: (t: number) => { x: number; y: number; conf?: number }, seconds = 10, fps = 5): FocusSample[] {
  const out: FocusSample[] = [];
  for (let i = 0; i <= seconds * fps; i++) {
    const t = i / fps;
    const v = fn(t);
    out.push({ t, x: v.x, y: v.y, conf: v.conf ?? 0.9 });
  }
  return out;
}

/** Sum of absolute frame-to-frame motion of the evaluated path (30 fps). */
function travel(keys: ReturnType<typeof smoothCameraPath>, t0: number, t1: number): { total: number; maxStep: number } {
  let total = 0;
  let maxStep = 0;
  let prev = evalCamera(keys, t0);
  for (let t = t0 + 1 / 30; t <= t1 + 1e-9; t += 1 / 30) {
    const p = evalCamera(keys, t);
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    total += d;
    maxStep = Math.max(maxStep, d);
    prev = p;
  }
  return { total, maxStep };
}

describe('auto-reframe camera path', () => {
  it('holds still on a jittery but stationary subject', () => {
    const rnd = seededRandom(7);
    const keys = smoothCameraPath(samples(() => ({ x: 0.3 + (rnd() - 0.5) * 0.04, y: 0.45 + (rnd() - 0.5) * 0.04 })));
    expect(keys.length).toBeLessThanOrEqual(4);
    for (const k of keys) {
      expect(Math.abs(k.x - 0.3)).toBeLessThan(0.03);
      expect(Math.abs(k.y - 0.45)).toBeLessThan(0.03);
    }
    expect(travel(keys, 0, 10).total).toBeLessThan(0.04);
  });

  it('pans smoothly when the subject moves, without overshoot', () => {
    const rnd = seededRandom(3);
    const keys = smoothCameraPath(samples((t) => ({ x: (t < 5 ? 0.25 : 0.75) + (rnd() - 0.5) * 0.03, y: 0.5 })));
    const a = evalCamera(keys, 2);
    const b = evalCamera(keys, 8.5);
    expect(Math.abs(a.x - 0.25)).toBeLessThan(0.05);
    expect(Math.abs(b.x - 0.75)).toBeLessThan(0.05);
    const { maxStep } = travel(keys, 0, 10);
    expect(maxStep).toBeLessThan(0.05); // ≤ 5 % of the frame per video frame: no jump cut
    let prev = evalCamera(keys, 0).x;
    for (let t = 0; t <= 10; t += 1 / 30) {
      const x = evalCamera(keys, t).x;
      expect(x).toBeGreaterThanOrEqual(prev - 0.004); // monotonic: no wobble back
      expect(x).toBeLessThanOrEqual(0.78);
      prev = x;
    }
    // The move starts and ends at rest.
    const moving = keys.filter((k) => k.ease !== 'linear');
    expect(moving.length).toBeGreaterThan(0);
  });

  it('ignores single-sample detection spikes and low-confidence samples', () => {
    const keys = smoothCameraPath(
      samples((t) => {
        if (Math.abs(t - 3) < 0.01) return { x: 0.95, y: 0.1 };
        if (t > 6 && t < 7) return { x: 0.9, y: 0.9, conf: 0.05 };
        return { x: 0.4, y: 0.5 };
      }),
    );
    for (let t = 0; t <= 10; t += 0.1) {
      const p = evalCamera(keys, t);
      expect(Math.abs(p.x - 0.4)).toBeLessThan(0.03);
      expect(Math.abs(p.y - 0.5)).toBeLessThan(0.03);
    }
  });

  it('follows a steady pan within tolerance', () => {
    const keys = smoothCameraPath(samples((t) => ({ x: 0.2 + t * 0.06, y: 0.5 })));
    for (let t = 2; t <= 8; t += 0.5) expect(Math.abs(evalCamera(keys, t).x - (0.2 + t * 0.06))).toBeLessThan(0.06);
    expect(keys.length).toBeLessThan(12);
  });
});

describe('reframe with the focus provider', () => {
  const asset: MediaAsset = { id: 'v', kind: 'video', name: 'v.mp4', source: { type: 'file', path: 'C:/v.mp4' }, duration: 10, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false, size: 1, addedAt: 0 };
  const project = (edit?: (c: VisualClip) => void) => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    p.assets.v = asset;
    const video = makeVideo(asset);
    video.trackId = p.tracks[0].id;
    edit?.(video);
    p.clips[video.id] = video;
    return { p, id: video.id };
  };

  it('uses the per-key easing and maps focus through flips', () => {
    const { p, id } = project((c) => (c.flipH = true));
    setFocusProvider(() => [
      { t: 0, x: 0.2, y: 0.5, ease: 'easeIn' },
      { t: 5, x: 0.8, y: 0.5, ease: 'linear' },
    ]);
    const r = reframeProject(p, 1080, 1920);
    setFocusProvider(null);
    const xs = r.clips[id].keyframes!.x!;
    // Mirrored: a subject on the left of the source is on the right of the layer.
    expect(xs[0].v).toBeLessThan(0);
    expect(xs[1].v).toBeGreaterThan(0);
    expect(xs[0].ease).toBe('easeIn');
    expect(r.clips[id].keyframes!.y).toBeUndefined(); // no vertical room → no y keys
  });

  it('accounts for the crop when panning', () => {
    // Crop away the left half: source x = 0.75 is the centre of what is shown.
    const { p, id } = project((c) => (c.crop = { l: 0.5, t: 0, r: 0, b: 0 }));
    setFocusProvider(() => [
      { t: 0, x: 0.75, y: 0.5 },
      { t: 5, x: 0.75, y: 0.5 },
    ]);
    const r = reframeProject(p, 1080, 1920);
    setFocusProvider(null);
    expect(Math.abs((r.clips[id] as VisualClip).transform.x)).toBeLessThan(1);
    expect(r.clips[id].keyframes?.x).toBeUndefined(); // constant → static value, no keyframes
  });
});

// ---------------------------------------------------------------------------------------------
// Scene cuts
// ---------------------------------------------------------------------------------------------

function syntheticStats(n: number, fps: number, cuts: Record<number, [number, number]>, seed = 1, noise = 1): FrameStat[] {
  const rnd = seededRandom(seed);
  const out: FrameStat[] = [];
  for (let i = 0; i < n; i++) {
    const c = cuts[i];
    out.push({
      t: i / fps,
      hist: i === 0 ? 0 : c ? c[0] : (0.01 + rnd() * 0.05) * noise,
      edge: i === 0 ? 0 : c ? c[1] : (0.05 + rnd() * 0.2) * noise,
      luma: 0.5,
    });
  }
  return out;
}

describe('scene detection', () => {
  it('finds hard cuts and enforces the minimum shot length', () => {
    const stats = syntheticStats(300, 30, { 50: [0.7, 0.8], 120: [0.6, 0.7], 122: [0.65, 0.75], 200: [0.45, 0.6] });
    const cuts = detectCuts(stats, { sensitivity: 0.5, minShot: 0.5 });
    expect(cuts.map((c) => c.index)).toEqual([50, 122, 200]);
    expect(cuts[0].t).toBeCloseTo(50 / 30, 6);
  });

  it('adapts the threshold to busy footage', () => {
    // A moderate jump is a cut in calm footage but not in shaky footage with the same jump.
    const calm = syntheticStats(200, 30, { 100: [0.3, 0.45] }, 4, 1);
    const busy = syntheticStats(200, 30, { 100: [0.3, 0.45] }, 4, 4.5);
    expect(detectCuts(calm, { sensitivity: 0.5 }).map((c) => c.index)).toEqual([100]);
    expect(detectCuts(busy, { sensitivity: 0.5 })).toEqual([]);
  });

  it('sensitivity trades recall for precision', () => {
    const stats = syntheticStats(240, 30, { 60: [0.75, 0.8], 160: [0.2, 0.3] }, 9);
    expect(detectCuts(stats, { sensitivity: 0.1 }).map((c) => c.index)).toEqual([60]);
    expect(detectCuts(stats, { sensitivity: 0.95 }).map((c) => c.index)).toEqual([60, 160]);
  });

  it('measures frame differences from pixels', () => {
    const w = 64;
    const h = 36;
    const img = (fn: (x: number, y: number) => [number, number, number]): Uint8ClampedArray => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const [r, g, b] = fn(x, y);
          d.set([r, g, b, 255], (y * w + x) * 4);
        }
      return d;
    };
    const disc = (cx: number): Uint8ClampedArray => img((x, y) => (Math.hypot(x - cx, y - 18) < 9 ? [240, 60, 40] : [30, 40, 90]));
    const a = frameFeatures(disc(20), w, h);
    const b = frameFeatures(disc(22), w, h); // small motion
    const c = frameFeatures(img((x) => (x < 32 ? [250, 240, 30] : [20, 200, 80])), w, h); // other shot
    const same = frameDifference(a, a);
    const motion = frameDifference(a, b);
    const cut = frameDifference(a, c);
    expect(same.hist).toBe(0);
    expect(same.edge).toBe(0);
    expect(cutScore(motion)).toBeLessThan(0.2);
    expect(cutScore(cut)).toBeGreaterThan(0.6);
  });
});

// ---------------------------------------------------------------------------------------------
// Colour match
// ---------------------------------------------------------------------------------------------

function randomPixels(n: number, seed: number): Float32Array {
  const rnd = seededRandom(seed);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // A plausible scene: a luminance ramp with moderately saturated colours.
    const l = Math.pow(rnd(), 0.9);
    const hue = rnd() * Math.PI * 2;
    const sat = rnd() * 0.25;
    out[i * 3] = Math.min(1, Math.max(0, l + Math.cos(hue) * sat));
    out[i * 3 + 1] = Math.min(1, Math.max(0, l + Math.cos(hue + 2.1) * sat));
    out[i * 3 + 2] = Math.min(1, Math.max(0, l + Math.cos(hue + 4.2) * sat));
  }
  return out;
}

describe('colour match', () => {
  it('the CPU grade port matches known reference values', () => {
    const px = new Float32Array([0.5, 0.5, 0.5]);
    expect(Array.from(gradePixels(px, [compileGrade({ exposure: 1 })]))).toEqual([1, 1, 1]);
    const warm = gradePixels(px, [compileGrade({ temperature: 1 })]);
    expect(warm[0]).toBeCloseTo(0.61, 5);
    expect(warm[2]).toBeCloseTo(0.39, 5);
    const flat = gradePixels(new Float32Array([0.2, 0.8, 0.4]), [compileGrade({ saturation: -1 })]);
    expect(flat[0]).toBeCloseTo(flat[1], 5);
  });

  it('recovers a known grade from statistics', () => {
    const source = randomPixels(5000, 11);
    const known = { exposure: 0.45, temperature: 0.35, saturation: -0.3, contrast: 0.12 };
    const target = gradePixels(randomPixels(5000, 12), [compileGrade(known)]);
    const res = matchColors({ source, target });
    expect(res.distanceBefore).toBeGreaterThan(1);
    expect(res.distanceAfter).toBeLessThan(0.25);
    expect(res.adjust.temperature!).toBeGreaterThan(0.15);
    expect(res.adjust.saturation!).toBeLessThan(-0.1);
    expect(res.adjust.exposure! + (res.adjust.gamma ?? 0) * 0.5).toBeGreaterThan(0.15);
  });

  it('keeps the other Adjust fields and respects the clip filter', () => {
    const source = randomPixels(4000, 21);
    const target = gradePixels(randomPixels(4000, 22), [compileGrade({ exposure: -0.5, tint: 0.4 })]);
    const filter = { saturation: 0.3, temperature: -0.2 };
    const res = matchColors({ source, target, baseAdjust: { vignette: 0.4, hue: 10 }, filter });
    expect(res.adjust.vignette).toBe(0.4);
    expect(res.adjust.hue).toBe(10);
    const rendered = labStats(gradePixels(source, [compileGrade(res.adjust), compileGrade(filter)]));
    expect(statDistance(rendered, labStats(target))).toBeLessThan(0.35);
  });

  it('partial strength lands between the two looks', () => {
    const source = randomPixels(3000, 31);
    const target = gradePixels(randomPixels(3000, 32), [compileGrade({ exposure: 0.8 })]);
    const full = matchColors({ source, target });
    const half = matchColors({ source, target, strength: 0.5 });
    expect(half.after.meanL).toBeGreaterThan(full.before.meanL + 2);
    expect(half.after.meanL).toBeLessThan(full.after.meanL - 2);
  });
});

// ---------------------------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------------------------

function noiseFrame(w: number, h: number, seed: number): Uint8Array {
  const rnd = seededRandom(seed);
  const d = new Uint8Array(w * h);
  // Smooth-ish background texture (low-pass noise) so correlation is meaningful.
  const coarse = new Float32Array(Math.ceil(w / 8) * Math.ceil(h / 8)).map(() => rnd());
  const cw = Math.ceil(w / 8);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = 60 + coarse[Math.floor(y / 8) * cw + Math.floor(x / 8)] * 80 + rnd() * 10;
  return d;
}

function pattern(size: number, seed: number): Uint8Array {
  const rnd = seededRandom(seed);
  const p = new Uint8Array(size * size);
  const cells = 5;
  const vals = Array.from({ length: cells * cells }, () => (rnd() > 0.5 ? 230 : 20));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) p[y * size + x] = vals[Math.floor((y * cells) / size) * cells + Math.floor((x * cells) / size)];
  return p;
}

/** Background + a textured square of side `size·scale` centred at (cx, cy), optionally occluded. */
function compose(bg: Uint8Array, w: number, h: number, pat: Uint8Array, size: number, cx: number, cy: number, scale = 1, occlude = false, seed = 0): GrayFrame {
  const d = bg.slice();
  const s = size * scale;
  const rnd = seededRandom(seed + 1);
  for (let y = Math.floor(cy - s / 2); y < cy + s / 2; y++) {
    for (let x = Math.floor(cx - s / 2); x < cx + s / 2; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const u = Math.min(size - 1, Math.max(0, Math.floor(((x - (cx - s / 2)) / s) * size)));
      const v = Math.min(size - 1, Math.max(0, Math.floor(((y - (cy - s / 2)) / s) * size)));
      d[y * w + x] = occlude ? 128 : Math.min(255, Math.max(0, pat[v * size + u] + (rnd() - 0.5) * 12));
    }
  }
  return { data: d, w, h };
}

describe('motion tracker', () => {
  const W = 320;
  const H = 180;
  const bg = noiseFrame(W, H, 5);
  const pat = pattern(30, 9);
  const path = (i: number): { x: number; y: number } => ({ x: 80 + i * 2.2, y: 90 + Math.sin(i / 9) * 30 });

  it('follows a moving pattern with sub-2px error', () => {
    const p0 = path(0);
    const tracker = new TemplateTracker(compose(bg, W, H, pat, 30, p0.x, p0.y), { cx: p0.x, cy: p0.y, w: 30, h: 30 });
    let maxErr = 0;
    for (let i = 1; i < 70; i++) {
      const p = path(i);
      const r = tracker.update(compose(bg, W, H, pat, 30, p.x, p.y, 1, false, i));
      expect(r.lost).toBe(false);
      maxErr = Math.max(maxErr, Math.hypot(r.cx - p.x, r.cy - p.y));
    }
    expect(maxErr).toBeLessThan(2);
  });

  it('handles a scale change', () => {
    const tracker = new TemplateTracker(compose(bg, W, H, pat, 30, 160, 90), { cx: 160, cy: 90, w: 30, h: 30 });
    let r = tracker.current;
    for (let i = 1; i <= 40; i++) {
      const s = 1 + i * 0.012; // grows to 1.48×
      const res = tracker.update(compose(bg, W, H, pat, 30, 160 + i, 90, s, false, i));
      expect(Math.hypot(res.cx - (160 + i), res.cy - 90)).toBeLessThan(2.5);
      r = res;
    }
    expect(r.w / 30).toBeGreaterThan(1.3);
    expect(r.w / 30).toBeLessThan(1.65);
  });

  it('reports low confidence while occluded and re-acquires afterwards', () => {
    const p0 = path(0);
    const tracker = new TemplateTracker(compose(bg, W, H, pat, 30, p0.x, p0.y), { cx: p0.x, cy: p0.y, w: 30, h: 30 });
    const confs: number[] = [];
    let lastErr = 0;
    for (let i = 1; i < 60; i++) {
      const p = path(i);
      const occluded = i >= 25 && i < 31;
      const r = tracker.update(compose(bg, W, H, pat, 30, p.x, p.y, 1, occluded, i));
      confs.push(r.conf);
      if (i > 36) lastErr = Math.max(lastErr, Math.hypot(r.cx - p.x, r.cy - p.y));
    }
    expect(Math.min(...confs.slice(24, 30))).toBeLessThan(0.45);
    expect(lastErr).toBeLessThan(2.5);
  });

  it('cleans and simplifies a track into sparse keyframes', () => {
    const raw = Array.from({ length: 90 }, (_, i) => ({ t: i / 30, x: 100 + i * 3 + (i % 2 ? 0.3 : -0.3), y: 50, conf: i === 40 ? 0.1 : 0.9 }));
    raw[40].x = 400; // a glitch with low confidence
    const clean = cleanTrack(raw);
    expect(Math.abs(clean[40].x - (100 + 40 * 3))).toBeLessThan(1);
    const keys = reduceKeyframes(clean, 0.75);
    expect(keys.length).toBeLessThan(8);
    expect(keys[0].t).toBe(0);
    expect(keys[keys.length - 1].t).toBeCloseTo(89 / 30, 6);
  });
});
