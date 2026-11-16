import { seededRandom } from '@/core/easing';
import type { SoundDef } from '../types';
import { adsr, chain, chime, convReverb, env, filt, mtof, noise, noiseHit, oneShot, osc, perc, reverb, shift, tone, vca, type Ctx, type Pt } from './lib/synth';

const def = oneShot('cartoon');

/** Slide whistle: a sine with a little second harmonic, vibrato and breath noise following the pitch. */
function slideWhistle(ctx: Ctx, out: AudioNode, f0: number, f1: number, dur: number): void {
  const glide: Pt[] = [
    [0, f0],
    [dur * 0.85, f1, 'exp'],
  ];
  const g = vca(ctx);
  env(g.gain, [[0, 0], [0.035, 0.9], [dur * 0.8, 0.8], [dur, 0]]);
  g.connect(out);
  const vibrato = vca(ctx, 0);
  env(vibrato.gain, [[0, 0], [dur * 0.4, (f0 + f1) * 0.006]]);
  osc(ctx, 'sine', 6.5, 0, dur + 0.02).connect(vibrato);
  for (const [mult, level] of [[1, 1], [2, 0.1], [3, 0.03]] as const) {
    const o = osc(ctx, 'sine', f0 * mult, 0, dur + 0.02);
    env(o.frequency, glide.map(([t, f, c]) => [t, f * mult, c] as const));
    vibrato.connect(o.frequency);
    o.connect(vca(ctx, level)).connect(g);
  }
  const breath = filt(ctx, 'bandpass', f0, 4);
  env(breath.frequency, glide);
  chain(noise(ctx, 811, 0, dur + 0.02), breath, vca(ctx, 0.5), g);
}

/** Brass-like note: a detuned saw pair through a low-pass that opens on the attack. */
function brass(ctx: Ctx, out: AudioNode, t: number, f: number, dur: number, gain: number): void {
  const lp = filt(ctx, 'lowpass', 500, 0.9);
  env(lp.frequency, [[t, 500], [t + 0.04, Math.min(5000, f * 7)], [t + 0.22, Math.min(4000, f * 4.5), 'exp']]);
  const g = vca(ctx);
  const end = adsr(g.gain, t, { peak: gain, a: 0.025, d: 0.12, s: 0.8, dur, r: 0.14 });
  const vibrato = vca(ctx, 0);
  if (dur > 0.4) {
    env(vibrato.gain, [[t + 0.25, 0], [t + 0.5, f * 0.006]]);
    osc(ctx, 'sine', 5.5, t, end).connect(vibrato);
  }
  for (const cents of [-6, 6]) {
    const o = osc(ctx, 'sawtooth', f, t, end + 0.01, cents);
    vibrato.connect(o.frequency);
    o.connect(lp);
  }
  chain(lp, g, out);
}

const sounds: SoundDef[] = [
  def('cartoon-boing', 'Boing', 0.9, ['boing', 'cartoon', 'bounce', 'jump', 'spring', 'funny'], 3.05, (ctx, out) => {
    const o = osc(ctx, 'sawtooth', 150, 0, 0.88);
    env(o.frequency, [[0, 150], [0.07, 240], [0.8, 105, 'exp']]);
    const wobble = vca(ctx, 16);
    env(wobble.gain, [[0, 16], [0.7, 2, 'exp']]);
    osc(ctx, 'sine', 26, 0, 0.88).connect(wobble).connect(o.frequency);
    // A resonance sweeping up and back down gives the "oi-oi-oing" vowel.
    const bp = filt(ctx, 'bandpass', 500, 5);
    env(bp.frequency, [[0, 500], [0.1, 1500, 'exp'], [0.8, 450, 'exp']]);
    const g = vca(ctx);
    perc(g.gain, 0, 0.9, 0.004, 0.78);
    o.connect(bp).connect(g);
    chain(o, filt(ctx, 'lowpass', 380, 0.7), vca(ctx, 0.3), g);
    g.connect(out);
  }),

  def('cartoon-slide-up', 'Slide Whistle Up', 0.78, ['slide whistle', 'up', 'cartoon', 'rise', 'funny', 'whistle'], 0.758, (ctx, out) => {
    slideWhistle(ctx, out, 520, 1750, 0.72);
  }),

  def('cartoon-slide-down', 'Slide Whistle Down', 0.88, ['slide whistle', 'down', 'cartoon', 'fall', 'funny', 'fail'], 0.736, (ctx, out) => {
    slideWhistle(ctx, out, 1700, 420, 0.82);
  }),

  def('cartoon-cork-pop', 'Cork Pop', 0.36, ['pop', 'cork', 'bottle', 'cartoon', 'open', 'champagne'], 0.836, (ctx, out) => {
    tone(ctx, out, { t: 0, f: [[0, 950], [0.045, 300, 'exp']], a: 0.001, d: 0.12, gain: 1 });
    noiseHit(ctx, out, { t: 0, seed: 821, f: 1400, q: 1, a: 0.0006, d: 0.03, gain: 0.8, centre: true });
    // Hollow ring of the bottle neck.
    noiseHit(ctx, out, { t: 0.002, seed: 822, f: 520, q: 9, a: 0.001, d: 0.22, gain: 3, centre: true });
  }),

  def('cartoon-spring', 'Spring', 1.15, ['spring', 'sproing', 'cartoon', 'bounce', 'wobble', 'coil'], 1.73, (ctx, out) => {
    // Pitch wobbles up and down, faster and shallower as the coil settles.
    const lfo = osc(ctx, 'sine', 9, 0, 1.1);
    env(lfo.frequency, [[0, 9], [0.95, 20]]);
    const depth = vca(ctx, 190);
    env(depth.gain, [[0, 190], [0.95, 10, 'exp']]);
    lfo.connect(depth);
    const bp = filt(ctx, 'bandpass', 900, 1.6);
    const g = vca(ctx);
    perc(g.gain, 0, 0.9, 0.004, 1.0);
    for (const [type, f, level, scale] of [['triangle', 320, 1, 1], ['sine', 883, 0.25, 2.76]] as const) {
      const o = osc(ctx, type, f, 0, 1.1);
      depth.connect(vca(ctx, scale)).connect(o.frequency);
      o.connect(vca(ctx, level)).connect(bp);
    }
    chain(bp, g, out);
    noiseHit(ctx, out, { t: 0, seed: 831, f: 2000, q: 1.5, a: 0.0006, d: 0.02, gain: 0.5, centre: true });
  }),

  def('cartoon-squeak', 'Toy Squeak', 0.34, ['squeak', 'toy', 'rubber', 'cartoon', 'squeeze', 'funny'], 1.07, (ctx, out) => {
    const squeak = (t: number, dur: number, glide: readonly Pt[], gain: number): void => {
      const bp = filt(ctx, 'bandpass', 2600, 2.5);
      const g = vca(ctx);
      env(g.gain, [[t, 0], [t + 0.008, gain], [t + dur - 0.025, gain * 0.8], [t + dur, 0]]);
      for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 3, 0.25]] as const) {
        const o = osc(ctx, type, glide[0][1] * mult, t, t + dur + 0.01);
        env(o.frequency, shift(glide.map(([time, f, c]) => [time, f * mult, c] as const), t));
        o.connect(vca(ctx, level)).connect(bp);
      }
      chain(bp, g, out);
    };
    squeak(0, 0.13, [[0, 1500], [0.05, 2500, 'exp'], [0.13, 2100, 'exp']], 1);
    squeak(0.16, 0.13, [[0, 1900], [0.04, 1500, 'exp'], [0.13, 1150, 'exp']], 0.6);
  }),

  def('cartoon-twinkle', 'Twinkle', 1.6, ['twinkle', 'sparkle', 'magic', 'cartoon', 'shine', 'fairy', 'star'], 1.11, (ctx, out) => {
    const bus = vca(ctx, 1);
    const verb = reverb(ctx, { decay: 1.0, damp: 7500, lowCut: 500 });
    bus.connect(out);
    bus.connect(verb.input);
    verb.output.connect(vca(ctx, 0.12)).connect(out);
    const rnd = seededRandom(777);
    const scale = [84, 86, 88, 91, 93, 96, 98, 100];
    const order = [7, 5, 6, 4, 2, 3, 1, 4, 6, 5, 7, 3, 6, 7];
    order.forEach((degree, i) => {
      chime(ctx, bus, { t: i * 0.068 + rnd() * 0.02, f: mtof(scale[degree]), d: 0.35 + rnd() * 0.3, gain: 0.3 + rnd() * 0.25, a: 0.002, pan: (rnd() - 0.5) * 1.4 });
    });
  }),

  def('cartoon-record-scratch', 'Record Scratch', 0.6, ['scratch', 'record', 'vinyl', 'dj', 'stop', 'cartoon', 'interrupt'], 0.758, (ctx, out) => {
    // Push, pull, push: the band (and a faint tone) follows the speed of the hand.
    const move: Pt[] = [
      [0, 500], [0.05, 3400, 'exp'], [0.13, 700, 'exp'],
      [0.15, 600, 'set'], [0.2, 2600, 'exp'], [0.31, 450, 'exp'],
      [0.33, 650, 'set'], [0.39, 3800, 'exp'], [0.52, 350, 'exp'],
    ];
    const g = vca(ctx);
    env(g.gain, [[0, 0], [0.01, 1], [0.11, 0.8], [0.135, 0], [0.15, 0], [0.165, 0.8], [0.29, 0.6], [0.315, 0], [0.33, 0], [0.345, 1], [0.48, 0.6], [0.53, 0]]);
    g.connect(out);
    const bp = filt(ctx, 'bandpass', 500, 3.5);
    env(bp.frequency, move);
    chain(noise(ctx, 841, 0, 0.56), bp, vca(ctx, 2.2), g);
    const o = osc(ctx, 'sawtooth', 125, 0, 0.56);
    env(o.frequency, move.map(([t, f, c]) => [t, f / 4, c] as const));
    chain(o, filt(ctx, 'lowpass', 2400, 0.7), vca(ctx, 0.3), g);
  }),

  def('cartoon-ta-da', 'Ta-Da', 1.8, ['ta-da', 'fanfare', 'reveal', 'success', 'brass', 'cartoon', 'surprise'], 0.474, (ctx, out) => {
    const bus = vca(ctx, 1);
    const verb = convReverb(ctx, { decay: 1.1, tone: 4200, seed: 37 });
    bus.connect(out);
    bus.connect(verb.input);
    verb.output.connect(vca(ctx, 0.28)).connect(out);
    // "Ta" — a short pick-up on the dominant.
    for (const [f, level] of [[196, 0.28], [293.66, 0.26], [392, 0.3]] as const) brass(ctx, bus, 0, f, 0.1, level);
    // "Da!" — the full major chord, with a cymbal splash and a thump underneath.
    for (const [f, level] of [[130.81, 0.3], [196, 0.2], [261.63, 0.26], [329.63, 0.24], [392, 0.26], [523.25, 0.3]] as const) brass(ctx, bus, 0.19, f, 0.85, level);
    noiseHit(ctx, bus, { t: 0.19, seed: 851, type: 'highpass', f: 5000, q: 0.7, a: 0.002, d: 0.8, gain: 0.22 });
    tone(ctx, bus, { t: 0.19, f: [[0, 120], [0.06, 58, 'exp']], a: 0.002, d: 0.3, gain: 0.5 });
  }),

  def('cartoon-bonk', 'Bonk', 0.42, ['bonk', 'hit', 'wood', 'cartoon', 'head', 'knock', 'coconut'], 0.693, (ctx, out) => {
    tone(ctx, out, { t: 0, f: [[0, 640], [0.04, 560, 'exp']], a: 0.001, d: 0.11, gain: 1 });
    tone(ctx, out, { t: 0, f: 1480, a: 0.001, d: 0.045, gain: 0.35 });
    noiseHit(ctx, out, { t: 0, seed: 861, f: 1200, q: 1.5, a: 0.0006, d: 0.015, gain: 1, centre: true });
    noiseHit(ctx, out, { t: 0, seed: 862, f: 420, q: 6, a: 0.001, d: 0.16, gain: 2, centre: true });
  }),

  def('cartoon-zip', 'Zip', 0.32, ['zip', 'zoom', 'fast', 'cartoon', 'dash', 'whip'], 0.643, (ctx, out) => {
    const rise = (x: number): number => (x < 0.85 ? Math.pow(x / 0.85, 1.6) : Math.cos(((x - 0.85) / 0.15) * (Math.PI / 2)));
    const bp = filt(ctx, 'bandpass', 400, 4);
    env(bp.frequency, [[0, 400], [0.24, 5200, 'exp']]);
    const g = vca(ctx);
    g.gain.setValueCurveAtTime(Float32Array.from({ length: 64 }, (_, i) => rise(i / 63)), 0, 0.28);
    chain(noise(ctx, 871, 0, 0.3), bp, vca(ctx, 2.5), g, out);
    const o = osc(ctx, 'sine', 400, 0, 0.3);
    env(o.frequency, [[0, 400], [0.24, 5200, 'exp']]);
    o.connect(vca(ctx, 0.12)).connect(g);
  }),
];

export default sounds;
