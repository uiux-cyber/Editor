import { seededRandom } from '@/core/easing';
import type { SoundDef } from '../types';
import { toBuffer } from './lib/dsp';
import { cached, chain, crusher, env, filt, noise, noiseHit, oneShot, osc, panner, pluck, shape, tone, vca, type Pt } from './lib/synth';

const def = oneShot('glitch');

const sounds: SoundDef[] = [
  def('glitch-digital-stutter', 'Digital Stutter', 0.78, ['glitch', 'stutter', 'digital', 'repeat', 'buffer', 'skip'], 0.841, (ctx, out) => {
    // A buzzy chord chopped into grains that get shorter and closer, then a final grain that dives.
    const grains: [number, number][] = [];
    let t = 0;
    let gap = 0.085;
    while (t < 0.5) {
      grains.push([t, gap * 0.62]);
      t += gap;
      gap = Math.max(0.022, gap * 0.86);
    }
    const last = t;
    grains.push([last, 0.2]);
    const gatePts: Pt[] = [];
    const panPts: Pt[] = [];
    grains.forEach(([start, len], i) => {
      gatePts.push([start, 0], [start + 0.002, 1], [start + len - 0.004, 1], [start + len, 0]);
      panPts.push([start, i === grains.length - 1 ? 0 : i % 2 ? 0.55 : -0.55, 'set']);
    });
    const gate = vca(ctx);
    env(gate.gain, gatePts);
    const pan = panner(ctx, 0);
    env(pan.pan, panPts);
    const body = filt(ctx, 'bandpass', 1300, 0.6);
    chain(body, crusher(ctx, 6), filt(ctx, 'highpass', 90, 0.7), filt(ctx, 'lowpass', 5200, 0.7), gate, pan, out);
    for (const [type, f, level] of [['sawtooth', 220, 0.4], ['square', 330.5, 0.22], ['sawtooth', 441, 0.22]] as const) {
      const o = osc(ctx, type, f, 0, 0.76);
      env(o.detune, [[last, 0], [last + 0.2, -2400]]);
      o.connect(vca(ctx, level)).connect(body);
    }
  }),

  def('glitch-data-burst', 'Data Burst', 0.58, ['glitch', 'data', 'digital', 'computer', 'transmission', 'bleep'], 0.938, (ctx, out) => {
    const rnd = seededRandom(5150);
    const o = osc(ctx, 'square', 1000, 0, 0.56);
    const g = vca(ctx);
    const pan = panner(ctx, 0);
    const step = 0.017;
    const count = 30;
    for (let i = 0; i < count; i++) {
      const t = i * step;
      o.frequency.setValueAtTime(500 * Math.pow(2, Math.floor(rnd() * 20) / 7), t);
      g.gain.setTargetAtTime(rnd() < 0.78 ? 0.35 + rnd() * 0.25 : 0, t, 0.0012);
      pan.pan.setValueAtTime((rnd() - 0.5) * 1.3, t);
      if (rnd() < 0.14) noiseHit(ctx, out, { t, seed: 700 + i, f: 3000, q: 0.8, a: 0.0005, d: 0.02, gain: 0.5 });
    }
    g.gain.setTargetAtTime(0, count * step, 0.003);
    chain(o, g, filt(ctx, 'bandpass', 2200, 0.45), filt(ctx, 'lowpass', 5500, 0.7), pan, out);
  }),

  def('glitch-static-zap', 'Static Zap', 0.46, ['glitch', 'zap', 'static', 'electric', 'spark', 'shock'], 0.584, (ctx, out) => {
    const o = osc(ctx, 'sawtooth', 2600, 0, 0.42);
    env(o.frequency, [[0, 2600], [0.28, 90, 'exp']]);
    // Random amplitude chopping turns the sweep into a crackle.
    const chop = vca(ctx, 0.5);
    chain(noise(ctx, 731, 0, 0.42), filt(ctx, 'lowpass', 900, 0.7), vca(ctx, 7)).connect(chop.gain);
    const bp = filt(ctx, 'bandpass', 3000, 1.5);
    env(bp.frequency, [[0, 3000], [0.28, 400, 'exp']]);
    const g = vca(ctx);
    env(g.gain, [[0, 0], [0.003, 0.8], [0.3, 0.0008, 'exp'], [0.32, 0]]);
    chain(o, chop, bp, g, out);
    noiseHit(ctx, out, { t: 0, seed: 732, f: [[0, 4000], [0.25, 700, 'exp']], q: 1.2, a: 0.001, d: 0.28, gain: 1.2 });
    tone(ctx, out, { t: 0, f: [[0, 180], [0.05, 60, 'exp']], a: 0.002, d: 0.09, gain: 0.4 });
  }),

  def('glitch-bitcrush-sweep', 'Bit-Crush Sweep', 1.0, ['glitch', 'bitcrush', 'lofi', '8-bit', 'digital', 'sweep'], 2.32, (ctx, out) => {
    // Falling tone, sampled-and-held at a falling rate and rounded to a few amplitude steps.
    const buffer = cached(ctx, 'glitch-bitcrush-sweep', () => {
      const sr = ctx.sampleRate;
      const n = Math.floor(0.95 * sr);
      const data = new Float32Array(n);
      let phase = 0;
      let held = 0;
      let counter = 1;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        phase += (1400 * Math.pow(90 / 1400, x)) / sr;
        const sig = 0.6 * Math.sin(2 * Math.PI * phase) + 0.4 * (2 * (phase % 1) - 1);
        counter += (9000 * Math.pow(700 / 9000, x)) / sr;
        if (counter >= 1) {
          counter -= 1;
          held = Math.round(sig * 6) / 6;
        }
        data[i] = held;
      }
      return toBuffer(ctx, [data]);
    });
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = vca(ctx);
    env(g.gain, [[0, 0], [0.005, 0.7], [0.7, 0.6], [0.93, 0]]);
    chain(src, filt(ctx, 'lowpass', 6500, 0.7), g, out);
    src.start(0);
    src.stop(0.96);
  }),

  def('glitch-tape-stop', 'Tape Stop', 1.3, ['glitch', 'tape', 'stop', 'slow down', 'vinyl', 'brake'], 1.2, (ctx, out) => {
    // Everything is tied to one "motor speed" curve: pitch, pulse rate, brightness and level.
    const speed = (x: number): number => (x < 0.2 ? 1 : Math.max(0.02, Math.pow(1 - (x - 0.2) / 0.8, 1.7)));
    const lp = filt(ctx, 'lowpass', 2600, 0.7);
    shape(lp.frequency, 0, 1.2, (x) => 300 + 2300 * speed(x));
    const pulse = vca(ctx, 0.75);
    const lfo = osc(ctx, 'sine', 8, 0, 1.25);
    shape(lfo.frequency, 0, 1.2, (x) => 8 * speed(x));
    lfo.connect(vca(ctx, 0.25)).connect(pulse.gain);
    const g = vca(ctx);
    shape(g.gain, 0, 1.2, (x) => Math.sqrt(speed(x)) * (x < 0.01 ? x / 0.01 : x > 0.95 ? (1 - x) / 0.05 : 1), 0.8);
    chain(lp, pulse, g, out);
    for (const [type, f, level] of [['triangle', 110, 0.5], ['sawtooth', 220, 0.22], ['sawtooth', 277.18, 0.2], ['sawtooth', 329.63, 0.2], ['sawtooth', 440, 0.14]] as const) {
      const o = osc(ctx, type, f, 0, 1.25);
      shape(o.frequency, 0, 1.2, (x) => f * speed(x));
      o.connect(vca(ctx, level)).connect(lp);
    }
  }),

  def('glitch-power-down', 'Power Down', 1.6, ['glitch', 'power down', 'shutdown', 'off', 'fail', 'machine'], 1.45, (ctx, out) => {
    const lp = filt(ctx, 'lowpass', 3800, 4);
    env(lp.frequency, [[0, 3800], [1.3, 180, 'exp']]);
    const whirr = vca(ctx, 0.7);
    const lfo = osc(ctx, 'sine', 30, 0, 1.5);
    env(lfo.frequency, [[0, 30], [1.3, 3, 'exp']]);
    lfo.connect(vca(ctx, 0.3)).connect(whirr.gain);
    const g = vca(ctx);
    env(g.gain, [[0, 0], [0.01, 0.5], [0.9, 0.42], [1.4, 0]]);
    chain(lp, whirr, g, out);
    for (const [type, cents, level] of [['square', 0, 0.3], ['sawtooth', -9, 0.35], ['sawtooth', 8, 0.35]] as const) {
      const o = osc(ctx, type, 520, 0, 1.45, cents);
      env(o.frequency, [[0, 520], [1.3, 28, 'exp']]);
      o.connect(vca(ctx, level)).connect(lp);
    }
    tone(ctx, out, { t: 1.3, f: [[0, 80], [0.08, 38, 'exp']], a: 0.004, d: 0.18, gain: 0.5 });
  }),

  def('glitch-radio-tuning', 'Radio Tuning', 1.9, ['glitch', 'radio', 'tuning', 'static', 'frequency', 'signal', 'dial'], 0.819, (ctx, out) => {
    const band = filt(ctx, 'bandpass', 1700, 0.5);
    chain(band, filt(ctx, 'highpass', 400, 0.7), out);
    // Static whose level wanders, ducking while a "station" drifts through.
    const wander = vca(ctx, 0.6);
    chain(noise(ctx, 771, 0, 1.88), filt(ctx, 'lowpass', 14, 0.7), vca(ctx, 22)).connect(wander.gain);
    const stat = vca(ctx);
    env(stat.gain, [[0, 0], [0.02, 0.9], [0.7, 0.9], [0.85, 0.25], [1.15, 0.25], [1.3, 0.9], [1.8, 0.7], [1.87, 0]]);
    chain(noise(ctx, 772, 0, 1.88), wander, stat, band);
    // Heterodyne whistles while the dial moves.
    const whistle = (pts: readonly Pt[], level: number): void => {
      const t0 = pts[0][0];
      const t1 = pts[pts.length - 1][0];
      const o = osc(ctx, 'sine', pts[0][1], t0, t1 + 0.02);
      env(o.frequency, pts);
      const g = vca(ctx);
      env(g.gain, [[t0, 0], [t0 + 0.03, level], [t1 - 0.04, level], [t1, 0]]);
      o.connect(g).connect(band);
    };
    whistle([[0.03, 2600], [0.25, 900, 'exp'], [0.5, 3000, 'exp'], [0.74, 600, 'exp']], 0.13);
    whistle([[1.2, 500], [1.5, 2800, 'exp'], [1.82, 1200, 'exp']], 0.1);
    // The station: a few plucked notes heard through the narrow band.
    [0, 4, 7, 12].forEach((semi, i) => pluck(ctx, band, { t: 0.82 + i * 0.085, f: 440 * Math.pow(2, semi / 12), d: 0.2, gain: 0.5, bright: 5 }));
    const rnd = seededRandom(1933);
    for (let i = 0; i < 10; i++) noiseHit(ctx, out, { t: 0.05 + rnd() * 1.7, seed: 780 + i, type: 'highpass', f: 2500, q: 0.7, a: 0.0005, d: 0.008, gain: 0.25 + rnd() * 0.3, pan: rnd() - 0.5 });
  }),

  def('glitch-interference', 'Signal Interference', 0.9, ['glitch', 'interference', 'signal', 'error', 'buzz', 'distortion', 'broken'], 0.937, (ctx, out) => {
    const rnd = seededRandom(2718);
    // Ring modulation: a saw multiplied by a fast sine gives clangorous, inharmonic sidebands.
    const ring = vca(ctx, 0);
    osc(ctx, 'sine', 1730, 0, 0.88).connect(ring.gain);
    osc(ctx, 'sawtooth', 110, 0, 0.88).connect(ring);
    const gate = vca(ctx);
    let t = 0;
    let on = true;
    while (t < 0.82) {
      gate.gain.setTargetAtTime(on ? 0.5 + rnd() * 0.3 : rnd() < 0.5 ? 0 : 0.08, t, 0.002);
      t += 0.025 + rnd() * 0.07;
      on = !on;
    }
    gate.gain.setTargetAtTime(0, 0.84, 0.004);
    chain(ring, crusher(ctx, 5), filt(ctx, 'bandpass', 1500, 0.4), filt(ctx, 'lowpass', 6000, 0.7), gate, out);
    chain(osc(ctx, 'square', 110, 0, 0.88), filt(ctx, 'lowpass', 600, 0.7), vca(ctx, 0.12), gate);
    for (let i = 0; i < 5; i++) tone(ctx, out, { t: 0.05 + rnd() * 0.7, f: 3900 + rnd() * 600, a: 0.001, d: 0.035, gain: 0.1, pan: rnd() - 0.5 });
  }),
];

export default sounds;
