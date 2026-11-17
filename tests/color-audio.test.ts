import { describe, expect, it } from 'vitest';
import { CubeParseError, formatCube, parseCube, sampleCube } from '@shared/cube';
import { BUILTIN_LUTS, generateBuiltinLut } from '@/core/color/builtinLuts';
import {
  addCurvePoint,
  applyCurvesLut,
  curvesLut,
  curveTable,
  identityCurves,
  isIdentityCurves,
  monotoneCubic,
  moveCurvePoint,
  removeCurvePoint,
  sanitizeCurve,
} from '@/core/color/curves';
import { applyWheels, hueToScopeAngle, isNeutralWheels, luma709, neutralWheels, rgbToCbCr, scopeAngleToHue, wheelChroma, wheelUniforms } from '@/core/color/wheels';
import { COMPRESSOR_PRESETS, kneeFor, KneeCurve, makeupStageDb, nodeAutoMakeupDb, sanitizeCompressor, staticCurveDb } from '@/core/audiofx/compressor';
import { bandResponseDb, EQ_PRESETS, eqResponseDb, isNeutralEq, logFrequencies, nodeQ, sanitizeEq } from '@/core/audiofx/eq';
import { computeScopes } from '@/engine/scopes/analyze';

// ---------------------------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------------------------

describe('curves', () => {
  it('identity curves bake to an identity table', () => {
    const lut = curvesLut(identityCurves());
    for (let i = 0; i < 256; i++) {
      for (let c = 0; c < 4; c++) expect(lut[i * 4 + c]).toBeCloseTo(i / 255, 6);
    }
    expect(isIdentityCurves(identityCurves())).toBe(true);
  });

  it('passes exactly through its control points', () => {
    const pts: [number, number][] = [
      [0, 0.05],
      [0.25, 0.18],
      [0.5, 0.55],
      [0.8, 0.9],
      [1, 0.97],
    ];
    const f = monotoneCubic(pts);
    for (const [x, y] of pts) expect(f(x)).toBeCloseTo(y, 9);
  });

  it('is monotone between monotone points (no overshoot)', () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.1, 0.6],
      [0.15, 0.62],
      [0.9, 0.64],
      [1, 1],
    ];
    const t = curveTable(pts, 1024);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1] - 1e-7);
    // Flat segments stay flat (Fritsch–Carlson zeroes the tangents).
    const flat = monotoneCubic([
      [0, 0],
      [0.3, 0.5],
      [0.7, 0.5],
      [1, 1],
    ]);
    for (let x = 0.3; x <= 0.7; x += 0.05) expect(flat(x)).toBeCloseTo(0.5, 9);
  });

  it('composes channel curves after the master curve', () => {
    const curves = identityCurves();
    curves.master = [
      [0, 0],
      [0.5, 0.75],
      [1, 1],
    ];
    curves.r = [
      [0, 0],
      [1, 0.5],
    ];
    const lut = curvesLut(curves);
    const m = monotoneCubic(curves.master)(0.5);
    const out = applyCurvesLut(lut, [0.5, 0.5, 0.5]);
    expect(out[1]).toBeCloseTo(m, 3);
    expect(out[0]).toBeCloseTo(m * 0.5, 3);
  });

  it('sanitises broken data and keeps the endpoints', () => {
    expect(sanitizeCurve(null)).toEqual([
      [0, 0],
      [1, 1],
    ]);
    const s = sanitizeCurve([[0.5, 2], [NaN, 0], [0.2, -1], 'x']);
    expect(s[0][0]).toBe(0);
    expect(s[s.length - 1][0]).toBe(1);
    expect(s.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
    for (let i = 1; i < s.length; i++) expect(s[i][0]).toBeGreaterThan(s[i - 1][0]);
  });

  it('adds, moves and removes points within their neighbours', () => {
    let pts = identityCurves().master;
    const added = addCurvePoint(pts, 0.5, 0.7);
    expect(added.index).toBe(1);
    pts = added.points;
    pts = moveCurvePoint(pts, 1, 1.5, 0.2);
    expect(pts[1][0]).toBeLessThan(1);
    expect(pts[1][1]).toBeCloseTo(0.2);
    pts = moveCurvePoint(pts, 0, 0.4, 0.1);
    expect(pts[0]).toEqual([0, 0.1]);
    expect(removeCurvePoint(pts, 1).length).toBe(2);
    expect(removeCurvePoint(pts, 0)[0]).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------------------------

describe('colour wheels', () => {
  it('are an exact identity at their defaults', () => {
    const u = wheelUniforms(neutralWheels());
    expect(u.lift).toEqual([0, 0, 0]);
    expect(u.offset).toEqual([0, 0, 0]);
    expect(u.gain).toEqual([1, 1, 1]);
    expect(u.gamma).toEqual([1, 1, 1]);
    expect(isNeutralWheels(neutralWheels())).toBe(true);
    for (const v of [0, 0.001, 0.18, 0.5, 0.731, 1]) {
      const out = applyWheels([v, v * 0.5, 1 - v], u);
      expect(out[0]).toBe(v);
      expect(out[1]).toBe(v * 0.5);
      expect(out[2]).toBeCloseTo(1 - v, 12);
    }
    expect(applyWheels([0.3, 0.6, 0.9], wheelUniforms(undefined))).toEqual([0.3, 0.6, 0.9]);
  });

  it('chroma pushes do not change luma', () => {
    for (let h = 0; h < 360; h += 15) {
      const c = wheelChroma(h, 1);
      expect(Math.abs(luma709(c[0], c[1], c[2]))).toBeLessThan(1e-9);
      const [cb, cr] = rgbToCbCr(c[0], c[1], c[2]);
      expect(Math.hypot(cb, cr)).toBeCloseTo(0.5, 6);
    }
  });

  it('lays hues out like a vectorscope and inverts the mapping', () => {
    // Red sits up-left (~103°), blue just below the +Cb axis (~355°).
    expect(hueToScopeAngle(0)).toBeGreaterThan(95);
    expect(hueToScopeAngle(0)).toBeLessThan(110);
    expect(hueToScopeAngle(240)).toBeGreaterThan(350);
    for (let h = 0; h < 360; h += 7.5) expect(scopeAngleToHue(hueToScopeAngle(h))).toBeCloseTo(h, 1);
  });

  it('lift moves blacks, gain moves whites, gamma keeps both ends', () => {
    const w = neutralWheels();
    w.lift.luma = 0.5;
    let u = wheelUniforms(w);
    expect(applyWheels([0, 0, 0], u)[0]).toBeGreaterThan(0.1);
    expect(applyWheels([1, 1, 1], u)[0]).toBeCloseTo(1, 9);
    const w2 = neutralWheels();
    w2.gamma.luma = 0.5;
    u = wheelUniforms(w2);
    expect(applyWheels([0, 0, 0], u)[0]).toBe(0);
    expect(applyWheels([1, 1, 1], u)[0]).toBeCloseTo(1, 9);
    expect(applyWheels([0.5, 0.5, 0.5], u)[0]).toBeGreaterThan(0.55);
    const w3 = neutralWheels();
    w3.gain = { hue: 0, amount: 0.4, luma: 0 };
    u = wheelUniforms(w3);
    const out = applyWheels([0.6, 0.6, 0.6], u);
    expect(out[0]).toBeGreaterThan(0.6);
    expect(out[2]).toBeLessThan(0.6);
  });
});

// ---------------------------------------------------------------------------------------------
// .cube parsing
// ---------------------------------------------------------------------------------------------

function identity3d(n: number): string {
  const rows: string[] = [];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  return rows.join('\n');
}

describe('.cube parser', () => {
  it('parses a 3D LUT with title, comments, CRLF and a BOM', () => {
    const text = `﻿# Created by a test\r\nTITLE "My # Look"\r\n\r\nLUT_3D_SIZE 2 # trailing comment\r\n${identity3d(2).replace(/\n/g, '\r\n')}\r\n`;
    const lut = parseCube(text);
    expect(lut.title).toBe('My # Look');
    expect(lut.kind).toBe('3d');
    expect(lut.size).toBe(2);
    expect(lut.data.length).toBe(8 * 3);
    // Red changes fastest.
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0]);
    expect(sampleCube(lut, 0.25, 0.5, 0.75).map((v) => +v.toFixed(5))).toEqual([0.25, 0.5, 0.75]);
  });

  it('parses 1D LUTs, domains and scientific notation', () => {
    const lut = parseCube(['LUT_1D_SIZE 3', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', '0 0 0', '5e-1 0.5 0.5', '1.0E0 1 1'].join('\n'));
    expect(lut.kind).toBe('1d');
    expect(lut.domainMax).toEqual([2, 2, 2]);
    expect(sampleCube(lut, 1, 1, 1)).toEqual([0.5, 0.5, 0.5]);
    expect(sampleCube(lut, 4, 4, 4)).toEqual([1, 1, 1]);
    const ranged = parseCube(['LUT_3D_INPUT_RANGE -0.5 1.5', 'LUT_3D_SIZE 2', identity3d(2)].join('\n'));
    expect(ranged.domainMin).toEqual([-0.5, -0.5, -0.5]);
    expect(ranged.domainMax).toEqual([1.5, 1.5, 1.5]);
  });

  it('accepts a 65-point cube and ignores unknown keywords', () => {
    const lut = parseCube(`TITLE bare title\nLUT_IN_VIDEO_RANGE\nLUT_3D_SIZE 65\n${identity3d(65)}`);
    expect(lut.size).toBe(65);
    expect(lut.title).toBe('bare title');
    expect(lut.data.length).toBe(65 ** 3 * 3);
    const [r, g, b] = sampleCube(lut, 0.123, 0.456, 0.789);
    expect(r).toBeCloseTo(0.123, 5);
    expect(g).toBeCloseTo(0.456, 5);
    expect(b).toBeCloseTo(0.789, 5);
  });

  it('rejects malformed files with readable errors', () => {
    const bad = [
      '',
      'TITLE "x"',
      'LUT_3D_SIZE 2\n0 0 0\n1 1 1',
      'LUT_3D_SIZE 66\n0 0 0',
      'LUT_3D_SIZE 1\n0 0 0',
      '0 0 0\nLUT_3D_SIZE 2',
      `LUT_3D_SIZE 2\n${identity3d(2)}\n0 0 0`,
      'LUT_1D_SIZE 2\n0 0 zero\n1 1 1',
      'LUT_1D_SIZE 2\n0 0\n1 1 1',
      'LUT_1D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n0 0 0\n1 1 1',
      `LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n${identity3d(2)}`,
      `LUT_3D_SIZE 2\n${identity3d(2).split('\n').slice(0, 4).join('\n')}\nTITLE "late"\n${identity3d(2).split('\n').slice(4).join('\n')}`,
      'LUT_1D_SIZE 2\n%% junk\n0 0 0\n1 1 1',
    ];
    for (const text of bad) expect(() => parseCube(text), JSON.stringify(text.slice(0, 50))).toThrow(CubeParseError);
  });

  it('round-trips through formatCube', () => {
    const lut = generateBuiltinLut(BUILTIN_LUTS[0].id, 5)!;
    const back = parseCube(formatCube(lut));
    expect(back.size).toBe(5);
    for (let i = 0; i < lut.data.length; i++) expect(back.data[i]).toBeCloseTo(lut.data[i], 5);
  });
});

describe('built-in LUTs', () => {
  it('generate valid, in-range, non-identity tables', () => {
    expect(BUILTIN_LUTS.length).toBeGreaterThanOrEqual(4);
    expect(BUILTIN_LUTS.length).toBeLessThanOrEqual(6);
    for (const def of BUILTIN_LUTS) {
      const lut = generateBuiltinLut(def.id)!;
      expect(lut.size).toBe(33);
      let maxDiff = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < lut.data.length; i++) {
        lo = Math.min(lo, lut.data[i]);
        hi = Math.max(hi, lut.data[i]);
      }
      expect(lo, def.name).toBeGreaterThanOrEqual(0);
      expect(hi, def.name).toBeLessThanOrEqual(1);
      for (const c of [0.1, 0.4, 0.7]) {
        const o = sampleCube(lut, c, c * 0.8, c * 0.6);
        maxDiff = Math.max(maxDiff, Math.abs(o[0] - c), Math.abs(o[1] - c * 0.8), Math.abs(o[2] - c * 0.6));
      }
      expect(maxDiff, def.name).toBeGreaterThan(0.01);
      // Tasteful: no look moves a mid grey by more than ~15 %.
      const grey = sampleCube(lut, 0.5, 0.5, 0.5);
      for (const v of grey) expect(Math.abs(v - 0.5), def.name).toBeLessThan(0.15);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// EQ
// ---------------------------------------------------------------------------------------------

describe('EQ response', () => {
  const sr = 48000;
  it('bell bands hit their gain exactly at the centre frequency', () => {
    for (const gain of [-12, -3, 4.5, 12]) {
      expect(bandResponseDb({ type: 'peaking', frequency: 1000, gain, q: 1.4 }, 1000, sr)).toBeCloseTo(gain, 6);
    }
    // ... and fade out far away.
    expect(Math.abs(bandResponseDb({ type: 'peaking', frequency: 1000, gain: 6, q: 2 }, 50, sr))).toBeLessThan(0.1);
  });

  it('shelves reach their gain at the far end and 0 dB at the other', () => {
    expect(bandResponseDb({ type: 'lowshelf', frequency: 200, gain: 6, q: 1 }, 10, sr)).toBeCloseTo(6, 1);
    expect(bandResponseDb({ type: 'lowshelf', frequency: 200, gain: 6, q: 1 }, 18000, sr)).toBeCloseTo(0, 1);
    expect(bandResponseDb({ type: 'lowshelf', frequency: 200, gain: 6, q: 1 }, 200, sr)).toBeCloseTo(3, 1);
    expect(bandResponseDb({ type: 'highshelf', frequency: 4000, gain: -8, q: 1 }, 23900, sr)).toBeCloseTo(-8, 0);
    expect(bandResponseDb({ type: 'highshelf', frequency: 4000, gain: -8, q: 1 }, 20, sr)).toBeCloseTo(0, 2);
  });

  it('pass filters are -3 dB at the cutoff (Butterworth Q) and steep beyond it', () => {
    expect(bandResponseDb({ type: 'highpass', frequency: 100, gain: 0, q: Math.SQRT1_2 }, 100, sr)).toBeCloseTo(-3.01, 1);
    expect(bandResponseDb({ type: 'highpass', frequency: 100, gain: 0, q: Math.SQRT1_2 }, 25, sr)).toBeLessThan(-22);
    expect(bandResponseDb({ type: 'lowpass', frequency: 1000, gain: 0, q: Math.SQRT1_2 }, 20, sr)).toBeCloseTo(0, 2);
    expect(bandResponseDb({ type: 'lowpass', frequency: 1000, gain: 0, q: Math.SQRT1_2 }, 1000, sr)).toBeCloseTo(-3.01, 1);
    // Web Audio takes the Q of pass filters in dB.
    expect(nodeQ({ type: 'lowpass', frequency: 1000, gain: 0, q: Math.SQRT1_2 })).toBeCloseTo(-3.0103, 3);
    expect(nodeQ({ type: 'peaking', frequency: 1000, gain: 0, q: 2 })).toBe(2);
  });

  it('sums bands in dB and recognises neutral settings', () => {
    const bands = sanitizeEq([
      { type: 'peaking', frequency: 500, gain: 3, q: 1 },
      { type: 'peaking', frequency: 500, gain: 2, q: 1 },
    ]);
    expect(eqResponseDb(bands, [500], sr)[0]).toBeCloseTo(5, 6);
    expect(isNeutralEq([{ type: 'peaking', frequency: 500, gain: 0, q: 1 }])).toBe(true);
    expect(isNeutralEq([{ type: 'highpass', frequency: 80, gain: 0, q: 0.7 }])).toBe(false);
    expect(isNeutralEq(undefined)).toBe(true);
    const f = logFrequencies(5);
    expect(f[0]).toBeCloseTo(20);
    expect(f[4]).toBeCloseTo(20000);
  });

  it('ships the requested presets with sensible shapes', () => {
    const names = EQ_PRESETS.map((p) => p.name);
    for (const n of ['Voice clarity', 'Bass boost', 'De-mud', 'Telephone', 'Rumble cut', 'Bright']) expect(names).toContain(n);
    const resp = (id: string, f: number): number => eqResponseDb(EQ_PRESETS.find((p) => p.id === id)!.bands, [f], sr)[0];
    expect(resp('bass-boost', 50)).toBeGreaterThan(4);
    expect(resp('telephone', 100)).toBeLessThan(-15);
    expect(resp('telephone', 8000)).toBeLessThan(-15);
    expect(resp('rumble-cut', 30)).toBeLessThan(-25);
    expect(Math.abs(resp('rumble-cut', 1000))).toBeLessThan(0.1);
    expect(resp('bright', 12000)).toBeGreaterThan(4);
    expect(resp('de-mud', 300)).toBeLessThan(-4);
  });
});

// ---------------------------------------------------------------------------------------------
// Compressor
// ---------------------------------------------------------------------------------------------

describe('compressor', () => {
  it('reproduces the hard-knee static curve', () => {
    const curve = new KneeCurve(-24, 0, 4);
    const out = (db: number): number => 20 * Math.log10(curve.saturate(Math.pow(10, db / 20)));
    expect(out(-40)).toBeCloseTo(-40, 6);
    expect(out(-12)).toBeCloseTo(-24 + 12 / 4, 2);
    expect(out(0)).toBeCloseTo(-24 + 24 / 4, 2);
    // Auto make-up = 0.6 × the gain lost at 0 dBFS.
    expect(nodeAutoMakeupDb(-24, 0, 4)).toBeCloseTo(0.6 * 18, 1);
  });

  it('soft knee is continuous and monotone; make-up stage cancels the automatic gain', () => {
    const s = sanitizeCompressor({ threshold: -20, ratio: 3, makeup: 4 });
    let prev = -Infinity;
    for (let db = -60; db <= 0; db += 0.5) {
      const y = staticCurveDb(s, db);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
    // Below the knee the compressor is unity plus the user's make-up.
    expect(staticCurveDb(s, -50)).toBeCloseTo(-50 + 4, 3);
    expect(makeupStageDb(s)).toBeCloseTo(4 - nodeAutoMakeupDb(-20, kneeFor(3), 3), 9);
    expect(kneeFor(2)).toBe(6);
    expect(kneeFor(20)).toBe(0);
  });

  it('ships the requested presets', () => {
    expect(COMPRESSOR_PRESETS.map((p) => p.name)).toEqual(['Voice', 'Music glue', 'Podcast', 'Limiter']);
    for (const p of COMPRESSOR_PRESETS) expect(sanitizeCompressor(p.settings)).toEqual(p.settings);
  });
});

// ---------------------------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------------------------

describe('scope analysis', () => {
  it('bins a frame into waveform, parade, vectorscope and histogram', () => {
    const w = 4;
    const h = 2;
    const px = new Uint8Array(w * h * 4);
    const set = (i: number, r: number, g: number, b: number): void => {
      px.set([r, g, b, 255], i * 4);
    };
    for (let i = 0; i < 8; i++) set(i, 128, 128, 128);
    set(3, 255, 0, 0);
    const s = computeScopes(px, w, h, { columns: 4 });
    // Grey: 7 pixels at luma 128.
    expect(s.histogram.l[128]).toBe(7);
    expect(s.histogram.r[255]).toBe(1);
    // Waveform column 3 has a grey and a red pixel.
    expect(s.waveform[3 * 256 + 128]).toBe(1);
    expect(s.waveform[3 * 256 + Math.round(0.2126 * 255)]).toBe(1);
    // Grey sits in the middle of the vectorscope.
    const mid = (s.vectorSize >> 1) * s.vectorSize + (s.vectorSize >> 1);
    expect(s.vector[mid]).toBeGreaterThanOrEqual(7);
  });
});
