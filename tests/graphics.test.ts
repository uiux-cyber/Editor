import { describe, expect, it } from 'vitest';
import { buildTimeline, defaultAnimationClipDuration, frameIndexAt, lottieFrameAt, normalizeFrameDelay, validateLottie } from '@/core/animTiming';
import { DEFAULT_COUNTER, counterFromText, counterProgress, counterTemplate, counterTextAt, counterValueAt, formatCounter, sanitizeCounter } from '@/core/counter';
import { Ease } from '@/core/easing';
import { constrain45, cubicAt, cubicSegments, insertPoint, nearestOnPath, normalizePath, pathBounds, removePoint, toAbsolute, toggleSmooth, tracePath, type AbsPoint } from '@/core/path';
import type { CounterSettings } from '@/core/types';

const counter = (o: Partial<CounterSettings> = {}): CounterSettings => ({ ...DEFAULT_COUNTER, ...o });

describe('count-up formatting', () => {
  it('formats decimals, separators, prefix and suffix', () => {
    expect(formatCounter(counter({ separator: true }), 1234567)).toBe('1,234,567');
    expect(formatCounter(counter({ separator: false }), 1234567)).toBe('1234567');
    expect(formatCounter(counter({ decimals: 2 }), 1234.5)).toBe('1,234.50');
    expect(formatCounter(counter({ decimals: 1, prefix: '$', suffix: 'M' }), 12.345)).toBe('$12.3M');
    expect(formatCounter(counter({ suffix: '%' }), 99.6)).toBe('100%');
    expect(formatCounter(counter(), 999)).toBe('999');
    expect(formatCounter(counter(), 1000)).toBe('1,000');
  });

  it('handles negatives and never shows -0', () => {
    expect(formatCounter(counter(), -1500)).toBe('-1,500');
    expect(formatCounter(counter(), -0.2)).toBe('0');
    expect(formatCounter(counter({ decimals: 2 }), -0.001)).toBe('0.00');
    expect(formatCounter(counter({ decimals: 1, prefix: '€' }), -2.25)).toBe('€-2.3');
  });

  it('clamps decimals and sanitises settings', () => {
    expect(formatCounter(counter({ decimals: 12 }), 1)).toBe('1.000000');
    expect(formatCounter(counter({ decimals: -3 }), 1.7)).toBe('2');
    const s = sanitizeCounter({ from: NaN, to: 50, decimals: 2.6, ease: 'nope' as never, duration: -1 });
    expect(s).toEqual({ from: 0, to: 50, decimals: 3, prefix: '', suffix: '', separator: true, ease: 'easeOutCubic' });
  });
});

describe('count-up timing', () => {
  it('eases from → to over the whole clip by default', () => {
    const c = counter({ from: 0, to: 1000, ease: 'linear' });
    expect(counterValueAt(c, 4, 0)).toBe(0);
    expect(counterValueAt(c, 4, 1)).toBeCloseTo(250);
    expect(counterValueAt(c, 4, 4)).toBe(1000);
    expect(counterValueAt(c, 4, 9)).toBe(1000);
    expect(counterValueAt(c, 4, -1)).toBe(0);
  });

  it('uses the easing curve and an optional shorter duration', () => {
    const c = counter({ from: 100, to: 200, ease: 'easeOutCubic', duration: 2 });
    expect(counterProgress(c, 5, 1)).toBeCloseTo(0.5);
    expect(counterValueAt(c, 5, 1)).toBeCloseTo(100 + 100 * Ease.easeOutCubic(0.5));
    expect(counterValueAt(c, 5, 2)).toBe(200);
    expect(counterValueAt(c, 5, 4)).toBe(200);
    // A duration longer than the clip is capped to the clip.
    expect(counterProgress(counter({ duration: 10 }), 4, 2)).toBeCloseTo(0.5);
  });

  it('counts down as well as up and reports the text at a time', () => {
    const clip = { duration: 2, counter: counter({ from: 10, to: 0, ease: 'linear', suffix: 's' }) };
    expect(counterTextAt(clip, 0)).toBe('10s');
    expect(counterTextAt(clip, 1)).toBe('5s');
    expect(counterTextAt(clip, 2)).toBe('0s');
    expect(counterTextAt({ duration: 2 }, 1)).toBeNull();
  });

  it('derives settings from text that already shows a number', () => {
    expect(counterFromText('87%')).toMatchObject({ from: 0, to: 87, suffix: '%', prefix: '', decimals: 0 });
    expect(counterFromText('$1,250.50 raised')).toMatchObject({ to: 1250.5, prefix: '$', suffix: ' raised', decimals: 2, separator: true });
    expect(counterFromText('Score: -12')).toMatchObject({ to: -12, prefix: 'Score: ' });
    expect(counterFromText('Hello')).toEqual(DEFAULT_COUNTER);
    const c = counterFromText('12,500 views');
    expect(formatCounter(c, c.to)).toBe('12,500 views');
  });

  it('builds a template at least as wide as every value', () => {
    const c = counter({ from: 0, to: 12500, prefix: '$' });
    expect(counterTemplate(c)).toBe('$00,000');
    // Overshooting eases widen the template when they cross a digit boundary.
    expect(counterTemplate(counter({ from: 0, to: 990, ease: 'easeOutBack' }))).toBe('0,000');
    expect(counterTemplate(counter({ from: -50, to: 5 }))).toBe('-00');
    for (let t = 0; t <= 2; t += 0.05) {
      const text = formatCounter(c, counterValueAt(c, 2, t));
      expect(text.replace(/\d/g, '0').length).toBeLessThanOrEqual(counterTemplate(c).length);
    }
  });
});

describe('pen paths', () => {
  const pt = (x: number, y: number, inV: [number, number] | null = null, outV: [number, number] | null = null): AbsPoint => ({ x, y, in: inV ? { x: inV[0], y: inV[1] } : null, out: outV ? { x: outV[0], y: outV[1] } : null });

  it('bounds straight polygons exactly', () => {
    const tri = [pt(100, 50), pt(300, 250), pt(20, 200)];
    expect(pathBounds(tri, true)).toEqual({ x: 20, y: 50, w: 280, h: 200 });
  });

  it('bounds curves by their extrema, not their handles', () => {
    // A symmetric arch from (0,0) to (100,0) with handles pulled up by 100: the peak is at y = -75.
    const arch = [pt(0, 0, null, [0, -100]), pt(100, 0, [0, -100], null)];
    const b = pathBounds(arch, false);
    expect(b.x).toBeCloseTo(0);
    expect(b.w).toBeCloseTo(100);
    expect(b.y).toBeCloseTo(-75);
    expect(b.h).toBeCloseTo(75);
  });

  it('normalises to the box and round-trips through absolute coordinates', () => {
    const pts = [pt(200, 100, null, [40, 0]), pt(400, 300, [0, -60], [0, 60]), pt(100, 400)];
    const { box, path } = normalizePath(pts, true);
    expect(path.closed).toBe(true);
    for (const p of path.points) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(1 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(1 + 1e-6);
    }
    const back = toAbsolute(path, box.w, box.h).map((p) => ({ ...p, x: p.x + box.x, y: p.y + box.y }));
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(pts[i].x, 3);
      expect(p.y).toBeCloseTo(pts[i].y, 3);
      expect(p.out?.x ?? 0).toBeCloseTo(pts[i].out?.x ?? 0, 3);
      expect(p.in?.y ?? 0).toBeCloseTo(pts[i].in?.y ?? 0, 3);
    });
    // Corner points keep no handles.
    expect(path.points[2].inX).toBeUndefined();
    expect(path.points[1].inY).toBeLessThan(0);
  });

  it('gives degenerate lines a minimum thickness and never closes two points', () => {
    const { box, path } = normalizePath([pt(10, 50), pt(210, 50)], true, 2);
    expect(box).toEqual({ x: 10, y: 49, w: 200, h: 2 });
    expect(path.closed).toBe(false);
    expect(path.points[0].y).toBeCloseTo(0.5);
  });

  it('traces lines and curves', () => {
    const calls: string[] = [];
    const sink = {
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
      bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number, y: number) => calls.push(`C${x},${y}`),
      closePath: () => calls.push('Z'),
    };
    tracePath(sink, { closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0, inX: -0.2, inY: 0 }, { x: 1, y: 1 }] }, 100, 50);
    expect(calls).toEqual(['M0,0', 'C100,0', 'L100,50', 'L0,0', 'Z']);
  });

  it('inserts a point on a curve without changing its shape', () => {
    const pts = [pt(0, 0, null, [30, -80]), pt(200, 0, [-30, -80], null)];
    const before = cubicSegments(pts, false)[0];
    const near = nearestOnPath(pts, false, cubicAt(before, 0.3))!;
    expect(near.index).toBe(0);
    expect(near.t).toBeCloseTo(0.3, 3);
    expect(near.dist).toBeLessThan(1e-3);
    const split = insertPoint(pts, false, 0, 0.3);
    expect(split).toHaveLength(3);
    const segs = cubicSegments(split, false);
    // Points along both halves lie on the original curve.
    for (const [seg, t0, span] of [
      [segs[0], 0, 0.3],
      [segs[1], 0.3, 0.7],
    ] as const) {
      for (const u of [0.25, 0.5, 0.75]) {
        const a = cubicAt(seg, u);
        const b = cubicAt(before, t0 + span * u);
        expect(a.x).toBeCloseTo(b.x, 6);
        expect(a.y).toBeCloseTo(b.y, 6);
      }
    }
  });

  it('toggles smooth / corner points and removes points', () => {
    const square = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)];
    const smooth = toggleSmooth(square, true, 1);
    expect(smooth[1].in).not.toBeNull();
    expect(smooth[1].out).not.toBeNull();
    // Collinear, opposite handles.
    expect(smooth[1].in!.x * smooth[1].out!.y - smooth[1].in!.y * smooth[1].out!.x).toBeCloseTo(0);
    expect(toggleSmooth(smooth, true, 1)[1].in).toBeNull();
    const removed = removePoint(square, true, 0)!;
    expect(removed.points).toHaveLength(3);
    expect(removed.closed).toBe(true);
    expect(removePoint(removed.points, true, 0)!.closed).toBe(false);
    expect(removePoint([pt(0, 0), pt(1, 1)], false, 0)).toBeNull();
  });

  it('constrains to 45° steps', () => {
    const p = constrain45({ x: 0, y: 0 }, { x: 100, y: 12 });
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(100, 12));
    const d = constrain45({ x: 0, y: 0 }, { x: 50, y: 47 });
    expect(d.x).toBeCloseTo(d.y);
  });
});

describe('animated image timing', () => {
  it('normalises zero and tiny GIF delays to 100 ms', () => {
    expect(normalizeFrameDelay(0)).toBe(0.1);
    expect(normalizeFrameDelay(0.01)).toBe(0.1);
    expect(normalizeFrameDelay(0.02)).toBe(0.02);
    expect(normalizeFrameDelay(NaN)).toBe(0.1);
  });

  it('finds the frame at a time and loops', () => {
    const tl = buildTimeline([0.1, 0.2, 0.05, 0.15]);
    expect(tl.total).toBeCloseTo(0.5);
    expect(tl.starts).toEqual([0, 0.1, 0.30000000000000004, 0.35000000000000003]);
    expect(frameIndexAt(tl, 0)).toBe(0);
    expect(frameIndexAt(tl, 0.0999)).toBe(0);
    expect(frameIndexAt(tl, 0.1)).toBe(1);
    expect(frameIndexAt(tl, 0.29)).toBe(1);
    expect(frameIndexAt(tl, 0.3)).toBe(2);
    expect(frameIndexAt(tl, 0.36)).toBe(3);
    expect(frameIndexAt(tl, 0.5)).toBe(0);
    expect(frameIndexAt(tl, 0.65)).toBe(1);
    expect(frameIndexAt(tl, 0.82)).toBe(2);
    expect(frameIndexAt(tl, 10.12)).toBe(1);
    expect(frameIndexAt(tl, -0.05)).toBe(3);
    // Exact frame boundaries on a 30 fps grid.
    const even = buildTimeline(Array(10).fill(1 / 10));
    for (let i = 0; i < 30; i++) expect(frameIndexAt(even, i / 10)).toBe(i % 10);
    expect(frameIndexAt(buildTimeline([0.1]), 5)).toBe(0);
  });

  it('defaults a clip to one loop, at least 3 seconds', () => {
    expect(defaultAnimationClipDuration(1.2)).toBe(3);
    expect(defaultAnimationClipDuration(7.5)).toBe(7.5);
  });

  it('validates Lottie documents and maps time to frames', () => {
    const doc = { v: '5.7.0', fr: 30, ip: 0, op: 60, w: 512, h: 256, nm: 'Wave', layers: [{ ty: 4 }] };
    const info = validateLottie(doc);
    expect(typeof info).toBe('object');
    if (typeof info === 'string') throw new Error(info);
    expect(info).toMatchObject({ width: 512, height: 256, fps: 30, frames: 60, duration: 2, name: 'Wave' });
    expect(lottieFrameAt(info, 0.5)).toBeCloseTo(15);
    expect(lottieFrameAt(info, 2)).toBe(0);
    expect(lottieFrameAt(info, 2.5)).toBeCloseTo(15);
    expect(lottieFrameAt(info, 1.99999)).toBeLessThan(60);
    expect(typeof validateLottie({ hello: 'world' })).toBe('string');
    expect(typeof validateLottie({ ...doc, layers: [] })).toBe('string');
    expect(typeof validateLottie({ ...doc, op: 0 })).toBe('string');
    expect(typeof validateLottie([1, 2])).toBe('string');
  });
});
