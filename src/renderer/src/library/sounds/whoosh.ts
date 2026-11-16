import type { SoundDef } from '../types';
import { autoPan, bump, chain, convReverb, env, filt, noise, oneShot, osc, reverb, shape, sweep, tone, vca } from './lib/synth';

const def = oneShot('whoosh');

const sounds: SoundDef[] = [
  def('whoosh-quick-swish', 'Quick Swish', 0.4, ['whoosh', 'swish', 'fast', 'swipe', 'transition'], 1.24, (ctx, out) => {
    sweep(ctx, out, {
      t: 0, dur: 0.38, seed: 101, q: 1.1, steep: true, gain: 1, peakAt: 0.4,
      f: [[0, 800], [0.14, 4000, 'exp'], [0.37, 1200, 'exp']],
      pan: [[0, -0.35], [0.37, 0.35]],
    });
    sweep(ctx, out, { t: 0.02, dur: 0.32, seed: 102, q: 0.8, gain: 0.3, peakAt: 0.42, f: [[0, 300], [0.14, 900, 'exp'], [0.3, 400, 'exp']] });
  }),

  def('whoosh-slow-swoosh', 'Slow Swoosh', 1.7, ['whoosh', 'swoosh', 'slow', 'transition', 'air', 'smooth'], 1.43, (ctx, out) => {
    sweep(ctx, out, {
      t: 0, dur: 1.66, seed: 111, q: 0.9, steep: true, gain: 1, peakAt: 0.5, sharp: 1.2,
      f: [[0, 220], [0.85, 1900, 'exp'], [1.65, 300, 'exp']],
      pan: [[0, -0.25], [1.65, 0.25]],
    });
    sweep(ctx, out, { t: 0, dur: 1.66, seed: 112, type: 'lowpass', q: 0.7, gain: 0.3, peakAt: 0.5, f: [[0, 180], [0.85, 420, 'exp'], [1.65, 160, 'exp']] });
  }),

  def('whoosh-deep', 'Deep Whoosh', 1.5, ['whoosh', 'deep', 'low', 'bass', 'transition', 'heavy'], 1.32, (ctx, out) => {
    sweep(ctx, out, {
      t: 0, dur: 1.46, seed: 121, type: 'lowpass', q: 1.3, steep: true, gain: 1, peakAt: 0.48, sharp: 1.1,
      f: [[0, 90], [0.7, 720, 'exp'], [1.45, 100, 'exp']],
    });
    sweep(ctx, out, { t: 0.1, dur: 1.2, seed: 122, q: 0.8, gain: 0.25, peakAt: 0.45, f: [[0, 500], [0.55, 1600, 'exp'], [1.2, 400, 'exp']] });
    // A sine swell underneath gives the pass real weight.
    const sub = vca(ctx);
    shape(sub.gain, 0, 1.4, bump(0.45, 1.2), 0.16);
    const o = osc(ctx, 'sine', 70, 0, 1.45);
    env(o.frequency, [[0, 70], [0.65, 56], [1.4, 46]]);
    o.connect(sub).connect(out);
  }),

  def('whoosh-airy-swipe', 'Airy Swipe', 0.65, ['whoosh', 'air', 'swipe', 'light', 'breath', 'soft'], 0.552, (ctx, out) => {
    const tame = filt(ctx, 'lowpass', 8500, 0.6);
    tame.connect(out);
    sweep(ctx, tame, {
      t: 0, dur: 0.62, seed: 131, type: 'highpass', q: 0.7, gain: 1, peakAt: 0.45,
      f: [[0, 1500], [0.3, 4200, 'exp'], [0.6, 2400, 'exp']],
      pan: [[0, 0.3], [0.6, -0.3]],
    });
    sweep(ctx, tame, { t: 0.03, dur: 0.55, seed: 132, q: 2, gain: 0.6, peakAt: 0.45, f: [[0, 2000], [0.27, 5200, 'exp'], [0.55, 3000, 'exp']] });
  }),

  def('whoosh-suck-in', 'Reverse Suck-In', 1.0, ['whoosh', 'reverse', 'suck', 'inhale', 'transition', 'build'], 0.831, (ctx, out) => {
    const rise = (x: number): number => (x < 0.94 ? Math.pow(x / 0.94, 3) : Math.cos(((x - 0.94) / 0.06) * (Math.PI / 2)));
    const src = noise(ctx, 141, 0, 0.95);
    const f1 = filt(ctx, 'bandpass', 300, 1.2);
    const f2 = filt(ctx, 'bandpass', 300, 1.2);
    for (const f of [f1, f2]) env(f.frequency, [[0, 300], [0.88, 6200, 'exp']]);
    const g = vca(ctx);
    shape(g.gain, 0, 0.93, rise, 1);
    chain(src, f1, f2, g, autoPan(ctx, [[0, -0.5], [0.45, 0.5], [0.9, 0]]), out);
    // Faint pitched component that rises with the noise.
    const tg = vca(ctx);
    shape(tg.gain, 0, 0.93, rise, 0.1);
    const o = osc(ctx, 'triangle', 180, 0, 0.95);
    env(o.frequency, [[0, 180], [0.9, 1400, 'exp']]);
    o.connect(tg).connect(out);
    // The "thup" where everything collapses.
    tone(ctx, out, { t: 0.9, f: [[0, 120], [0.05, 58, 'exp']], a: 0.003, d: 0.07, gain: 0.6 });
  }),

  def('whoosh-pass-by', 'Doppler Pass-By', 1.6, ['whoosh', 'doppler', 'pass', 'flyby', 'fast', 'vehicle'], 1.08, (ctx, out) => {
    const pan = autoPan(ctx, [[0, -0.9], [0.6, -0.5], [0.95, 0.5], [1.58, 0.9]]);
    pan.connect(out);
    // Pitch falls as the object passes: high on approach, low once it has gone by.
    const doppler = (hi: number, lo: number): [number, number, 'exp' | undefined][] => [
      [0, hi, undefined],
      [0.6, hi * 0.985, 'exp'],
      [0.95, lo * 1.02, 'exp'],
      [1.58, lo, 'exp'],
    ];
    const src = noise(ctx, 151, 0, 1.6);
    const res = filt(ctx, 'bandpass', 1200, 5);
    env(res.frequency, doppler(1250, 820));
    const body = filt(ctx, 'bandpass', 1600, 0.7);
    env(body.frequency, doppler(2400, 1300));
    const g = vca(ctx);
    shape(g.gain, 0, 1.58, bump(0.48, 2), 1);
    src.connect(res).connect(g);
    src.connect(body).connect(vca(ctx, 0.5)).connect(g);
    g.connect(pan);
    const hum = vca(ctx);
    shape(hum.gain, 0, 1.58, bump(0.48, 1.6), 0.16);
    const lp = filt(ctx, 'lowpass', 900, 0.7);
    for (const mult of [1, 1.5]) {
      const o = osc(ctx, 'sawtooth', 200, 0, 1.6);
      env(o.frequency, doppler(204 * mult, 158 * mult));
      o.connect(lp);
    }
    lp.connect(hum).connect(pan);
  }),

  def('whoosh-tonal', 'Tonal Swoosh', 2.0, ['whoosh', 'tonal', 'musical', 'shimmer', 'transition', 'magic'], 0.976, (ctx, out) => {
    const verb = reverb(ctx, { decay: 1.1, damp: 4800, pre: 0.01 });
    verb.output.connect(vca(ctx, 0.22)).connect(out);
    const bus = vca(ctx, 1);
    bus.connect(out);
    bus.connect(verb.input);
    sweep(ctx, bus, {
      t: 0, dur: 0.8, seed: 161, q: 1, steep: true, gain: 0.9, peakAt: 0.42,
      f: [[0, 400], [0.34, 3400, 'exp'], [0.8, 900, 'exp']],
      pan: [[0, -0.3], [0.8, 0.3]],
    });
    // A whistling resonance riding on the sweep, resolving into a soft fifth.
    sweep(ctx, bus, { t: 0, dur: 0.7, seed: 162, q: 9, gain: 0.5, peakAt: 0.45, f: [[0, 660], [0.33, 1320, 'exp'], [0.7, 1320]] });
    for (const [f, level] of [[660, 0.2], [990, 0.13], [1320, 0.07]] as const) {
      const g = vca(ctx);
      env(g.gain, [[0.22, 0], [0.36, level], [1.2, level * 0.001, 'exp'], [1.22, 0]]);
      osc(ctx, 'sine', f, 0.2, 1.25).connect(g).connect(bus);
    }
  }),

  def('whoosh-paper-swipe', 'Paper Swipe', 0.36, ['whoosh', 'paper', 'swipe', 'page', 'slide', 'card'], 0.556, (ctx, out) => {
    // High-passed noise whose level is roughened by slow random flutter, like a sheet dragged over a desk.
    const src = noise(ctx, 171, 0, 0.36);
    const hp = filt(ctx, 'highpass', 1700, 0.7);
    const bp = filt(ctx, 'bandpass', 3400, 0.6);
    env(bp.frequency, [[0, 2600], [0.15, 4200], [0.33, 2900]]);
    const rough = vca(ctx, 0.55);
    const flutter = noise(ctx, 172, 0, 0.36);
    chain(flutter, filt(ctx, 'lowpass', 110, 0.7), vca(ctx, 7)).connect(rough.gain);
    const g = vca(ctx);
    shape(g.gain, 0, 0.33, bump(0.4), 1);
    chain(src, hp, bp, filt(ctx, 'lowpass', 8000, 0.6), rough, g, autoPan(ctx, [[0, -0.3], [0.33, 0.3]]), out);
  }),

  def('whoosh-double', 'Double Whoosh', 0.95, ['whoosh', 'double', 'swish', 'back and forth', 'fast', 'combo'], 1.23, (ctx, out) => {
    sweep(ctx, out, {
      t: 0, dur: 0.42, seed: 181, q: 1.1, steep: true, gain: 0.85, peakAt: 0.42,
      f: [[0, 700], [0.17, 4200, 'exp'], [0.41, 1200, 'exp']],
      pan: [[0, -0.7], [0.41, 0.7]],
    });
    sweep(ctx, out, {
      t: 0.4, dur: 0.52, seed: 182, q: 1.1, steep: true, gain: 1, peakAt: 0.4,
      f: [[0, 520], [0.2, 3400, 'exp'], [0.51, 800, 'exp']],
      pan: [[0, 0.7], [0.51, -0.7]],
    });
  }),

  def('whoosh-cinematic-sweep', 'Cinematic Sweep', 2.8, ['whoosh', 'cinematic', 'sweep', 'trailer', 'long', 'epic'], 0.875, (ctx, out) => {
    const verb = convReverb(ctx, { decay: 1.5, tone: 3200, seed: 19 });
    verb.output.connect(vca(ctx, 0.55)).connect(out);
    const bus = vca(ctx, 1);
    bus.connect(out);
    bus.connect(verb.input);
    sweep(ctx, bus, {
      t: 0, dur: 2.0, seed: 191, q: 0.9, steep: true, gain: 1, peakAt: 0.62, sharp: 1.4,
      f: [[0, 150], [1.25, 2600, 'exp'], [2.0, 260, 'exp']],
      pan: [[0, -0.5], [2.0, 0.5]],
    });
    sweep(ctx, bus, { t: 0, dur: 2.0, seed: 192, type: 'lowpass', q: 1, gain: 0.35, peakAt: 0.62, sharp: 1.3, f: [[0, 120], [1.25, 600, 'exp'], [2.0, 130, 'exp']] });
    sweep(ctx, bus, { t: 0.6, dur: 1.2, seed: 193, type: 'highpass', q: 0.7, gain: 0.12, peakAt: 0.55, sharp: 2, f: [[0, 4000], [1.2, 6000]] });
    const sub = vca(ctx);
    shape(sub.gain, 0, 2.0, bump(0.62, 1.5), 0.12);
    osc(ctx, 'sine', 55, 0, 2.05).connect(sub).connect(out);
  }),

  def('whoosh-spin', 'Spin Swirl', 1.25, ['whoosh', 'spin', 'swirl', 'rotate', 'twirl', 'transition'], 0.894, (ctx, out) => {
    // One LFO drives both the tremolo and the auto-pan, speeding up and slowing down like a spin.
    const lfo = osc(ctx, 'sine', 6, 0, 1.25);
    env(lfo.frequency, [[0, 5], [0.6, 15], [1.2, 6]]);
    const trem = vca(ctx, 0.6);
    lfo.connect(vca(ctx, 0.4)).connect(trem.gain);
    const pan = ctx.createStereoPanner();
    const quad = osc(ctx, 'triangle', 6, 0, 1.25);
    env(quad.frequency, [[0, 2.5], [0.6, 7.5], [1.2, 3]]);
    quad.connect(vca(ctx, 0.8)).connect(pan.pan);
    trem.connect(pan).connect(out);
    sweep(ctx, trem, {
      t: 0, dur: 1.22, seed: 201, q: 1.2, steep: true, gain: 1.4, peakAt: 0.5,
      f: [[0, 500], [0.6, 2800, 'exp'], [1.2, 700, 'exp']],
    });
  }),
];

export default sounds;
