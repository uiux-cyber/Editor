import type { SoundDef } from '../types';
import { chain, env, filt, kick, noise, oneShot, osc, panner, reverb, shape, vca, type Ctx } from './lib/synth';

const def = oneShot('riser');

/** Swell that grows as x^power and then drops away over the last `cut` fraction. */
const build =
  (power: number, cut = 0.04) =>
  (x: number): number =>
    x < 1 - cut ? Math.pow(x / (1 - cut), power) : Math.cos(((x - (1 - cut)) / cut) * (Math.PI / 2));

/** Dry bus plus a feedback-delay reverb send. */
function withVerb(ctx: Ctx, out: AudioNode, decay: number, wet: number): GainNode {
  const bus = vca(ctx, 1);
  const verb = reverb(ctx, { decay, damp: 5200 });
  bus.connect(out);
  bus.connect(verb.input);
  verb.output.connect(vca(ctx, wet)).connect(out);
  return bus;
}

const sounds: SoundDef[] = [
  def('riser-noise', 'Noise Riser', 3.2, ['riser', 'noise', 'build', 'sweep', 'uplifter', 'transition'], 0.867, (ctx, out) => {
    const src = noise(ctx, 401, 0, 3.15);
    const f1 = filt(ctx, 'bandpass', 250, 1.3);
    const f2 = filt(ctx, 'bandpass', 250, 1.3);
    for (const f of [f1, f2]) env(f.frequency, [[0, 250], [3.0, 6000, 'exp']]);
    const g = vca(ctx);
    shape(g.gain, 0, 3.1, build(2.2), 1);
    chain(src, f1, f2, g, out);
    // Wide, quieter band an octave below keeps the body while the top climbs.
    const low = filt(ctx, 'bandpass', 150, 0.8);
    env(low.frequency, [[0, 150], [3.0, 2400, 'exp']]);
    const lg = vca(ctx);
    shape(lg.gain, 0, 3.1, build(1.6), 0.35);
    chain(noise(ctx, 402, 0, 3.15), low, lg, out);
  }),

  def('riser-tonal', 'Tonal Riser', 3.1, ['riser', 'tonal', 'pitch', 'build', 'synth', 'tension'], 1.41, (ctx, out) => {
    const bus = withVerb(ctx, out, 0.9, 0.12);
    const lp = filt(ctx, 'lowpass', 400, 2);
    env(lp.frequency, [[0, 400], [2.9, 6000, 'exp']]);
    // Tremolo that speeds up towards the end.
    const trem = vca(ctx, 0.7);
    const lfo = osc(ctx, 'sine', 4, 0, 3.05);
    env(lfo.frequency, [[0, 4], [2.9, 18, 'exp']]);
    lfo.connect(vca(ctx, 0.3)).connect(trem.gain);
    const g = vca(ctx);
    shape(g.gain, 0, 3.0, build(1.6, 0.03), 0.6);
    chain(lp, trem, g, bus);
    for (const [mult, cents, level] of [[1, -12, 0.4], [1, 11, 0.4], [2, 5, 0.25], [0.5, 0, 0.3]] as const) {
      const o = osc(ctx, 'sawtooth', 110 * mult, 0, 3.05, cents);
      env(o.frequency, [[0, 110 * mult], [2.9, 440 * mult, 'exp']]);
      o.connect(vca(ctx, level)).connect(lp);
    }
  }),

  def('riser-tension', 'Tension Build', 4.2, ['riser', 'tension', 'suspense', 'strings', 'build', 'horror', 'drama'], 1.63, (ctx, out) => {
    const bus = withVerb(ctx, out, 1.2, 0.14);
    const lp = filt(ctx, 'lowpass', 500, 0.8);
    env(lp.frequency, [[0, 500], [4.0, 3400, 'exp']]);
    // Bowed-tremolo feel: a fast, deepening amplitude flutter.
    const trem = vca(ctx, 0.75);
    const lfo = osc(ctx, 'triangle', 9, 0, 4.15);
    const depth = vca(ctx, 0.05);
    env(depth.gain, [[0, 0.05], [4.0, 0.25]]);
    lfo.connect(depth).connect(trem.gain);
    const g = vca(ctx);
    shape(g.gain, 0, 4.1, build(1.1, 0.02), 0.8);
    chain(lp, trem, g, bus);
    // A cluster of close intervals (E3 F3 B3 C4) that slowly bends sharp.
    [164.81, 174.61, 246.94, 261.63].forEach((f, i) => {
      for (const cents of [-8, 7]) {
        const o = osc(ctx, 'sawtooth', f, 0, 4.15, cents);
        env(o.detune, [[0, cents], [4.0, cents + 70 + i * 12]]);
        o.connect(vca(ctx, 0.22)).connect(panner(ctx, (i - 1.5) * 0.4)).connect(lp);
      }
    });
    // Heartbeat that quickens.
    for (const t of [0, 0.8, 1.5, 2.1, 2.6, 3.0, 3.35, 3.65, 3.9]) kick(ctx, out, { t, gain: 0.14 + t * 0.03, f0: 120, f1: 55, sweep: 0.05, d: 0.28, click: 0.1, seed: 411 });
  }),

  def('riser-reverse-cymbal', 'Reverse Cymbal', 2.6, ['riser', 'reverse', 'cymbal', 'swell', 'crash', 'transition'], 0.906, (ctx, out) => {
    const swell = (x: number): number => (x < 0.965 ? Math.exp(5.2 * (x / 0.965 - 1)) : Math.cos(((x - 0.965) / 0.035) * (Math.PI / 2)));
    const top = filt(ctx, 'lowpass', 9500, 0.6);
    const g = vca(ctx);
    shape(g.gain, 0, 2.52, swell, 1);
    chain(top, g, out);
    // Metallic cluster of inharmonic square waves under a bed of bright noise.
    const metal = filt(ctx, 'highpass', 4200, 0.7);
    for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) osc(ctx, 'square', f * 1.52, 0, 2.55).connect(vca(ctx, 0.07)).connect(metal);
    metal.connect(filt(ctx, 'bandpass', 7200, 0.5)).connect(top);
    chain(noise(ctx, 431, 0, 2.55), filt(ctx, 'highpass', 5200, 0.7), vca(ctx, 0.5), top);
    chain(noise(ctx, 432, 0, 2.55), filt(ctx, 'bandpass', 3000, 0.6), vca(ctx, 0.6), top);
  }),

  def('riser-downlifter', 'Downlifter', 2.6, ['riser', 'downlifter', 'fall', 'sweep', 'drop', 'transition'], 0.836, (ctx, out) => {
    const bus = withVerb(ctx, out, 1.0, 0.12);
    const fall = (x: number): number => (x < 0.012 ? x / 0.012 : Math.pow(1 - (x - 0.012) / 0.988, 1.6));
    const src = noise(ctx, 441, 0, 2.5);
    const f1 = filt(ctx, 'bandpass', 8000, 1.2);
    const f2 = filt(ctx, 'bandpass', 8000, 1.2);
    for (const f of [f1, f2]) env(f.frequency, [[0, 8000], [2.4, 180, 'exp']]);
    const g = vca(ctx);
    shape(g.gain, 0, 2.45, fall, 1);
    chain(src, f1, f2, g, bus);
    const tg = vca(ctx);
    shape(tg.gain, 0, 2.3, fall, 0.2);
    const o = osc(ctx, 'sine', 900, 0, 2.35);
    env(o.frequency, [[0, 900], [2.2, 50, 'exp']]);
    o.connect(tg).connect(bus);
  }),

  def('riser-pitch-drop', 'Pitch Drop', 1.8, ['riser', 'pitch', 'drop', 'fall', 'dive', 'synth'], 1.11, (ctx, out) => {
    const lp = filt(ctx, 'lowpass', 5000, 3);
    env(lp.frequency, [[0, 5000], [1.5, 300, 'exp']]);
    const g = vca(ctx);
    env(g.gain, [[0, 0], [0.006, 0.5], [1.0, 0.4], [1.7, 0]]);
    chain(lp, g, out);
    for (const [type, cents, level] of [['sawtooth', -7, 0.5], ['sawtooth', 7, 0.5], ['square', 0, 0.25]] as const) {
      const o = osc(ctx, type, 880, 0, 1.75, cents);
      env(o.frequency, [[0, 880], [1.5, 55, 'exp']]);
      o.connect(vca(ctx, level)).connect(lp);
    }
    // The low octave takes over as the pitch arrives at the bottom.
    const sub = vca(ctx);
    env(sub.gain, [[0.6, 0], [1.2, 0.5], [1.7, 0]]);
    const so = osc(ctx, 'sine', 440, 0.55, 1.75);
    env(so.frequency, [[0, 440], [1.5, 27.5, 'exp']]);
    so.connect(sub).connect(out);
  }),

  def('riser-synth-uplifter', 'Synth Uplifter', 2.2, ['riser', 'uplifter', 'synth', 'build', 'bright', 'edm'], 1.47, (ctx, out) => {
    const bus = withVerb(ctx, out, 0.8, 0.1);
    const hp = filt(ctx, 'highpass', 200, 0.7);
    env(hp.frequency, [[0, 200], [2.05, 1200, 'exp']]);
    const lp = filt(ctx, 'lowpass', 1200, 1.2);
    env(lp.frequency, [[0, 1200], [2.05, 8000, 'exp']]);
    const g = vca(ctx);
    shape(g.gain, 0, 2.12, build(1.3, 0.035), 0.7);
    chain(hp, lp, g, bus);
    [-24, -12, -4, 5, 13, 23].forEach((cents, i) => {
      const o = osc(ctx, 'sawtooth', 220, 0, 2.15, cents);
      env(o.frequency, [[0, 220], [2.05, 440, 'exp']]);
      o.connect(vca(ctx, 0.2)).connect(panner(ctx, (i - 2.5) * 0.3)).connect(hp);
    });
    const ng = vca(ctx);
    shape(ng.gain, 0, 2.12, build(2.4, 0.035), 0.3);
    const nf = filt(ctx, 'bandpass', 1500, 0.8);
    env(nf.frequency, [[0, 1500], [2.05, 7000, 'exp']]);
    chain(noise(ctx, 461, 0, 2.15), nf, ng, bus);
  }),
];

export default sounds;
