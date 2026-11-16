import type { SoundDef } from '../types';
import { chain, convReverb, drive, env, filt, kick, noiseHit, oneShot, osc, reverb, tone, vca, type Ctx } from './lib/synth';

const def = oneShot('impact');

/** Dry bus plus a convolution-reverb send; returns the node to connect voices to. */
function withTail(ctx: Ctx, out: AudioNode, decay: number, wet: number, toneHz = 2400, seed = 7): GainNode {
  const bus = vca(ctx, 1);
  const verb = convReverb(ctx, { decay, tone: toneHz, seed, pre: 0.012 });
  bus.connect(out);
  bus.connect(verb.input);
  verb.output.connect(vca(ctx, wet)).connect(out);
  return bus;
}

/** Long sine sub with a downward pitch sweep, lightly saturated so it reads on small speakers. */
function subBoom(ctx: Ctx, out: AudioNode, t: number, f0: number, f1: number, sweep: number, decay: number, gain: number): void {
  const sat = drive(ctx, 1.6);
  const lp = filt(ctx, 'lowpass', 260, 0.6);
  chain(sat.output, lp, vca(ctx, gain), out);
  tone(ctx, sat.input, { t, f: [[0, f0], [sweep, f1, 'exp']], a: 0.004, d: decay, gain: 1 });
}

const sounds: SoundDef[] = [
  def('impact-cinematic-boom', 'Cinematic Boom', 3.4, ['impact', 'boom', 'cinematic', 'trailer', 'deep', 'hit'], 0.556, (ctx, out) => {
    subBoom(ctx, out, 0, 68, 40, 0.5, 2.6, 0.7);
    const bus = withTail(ctx, out, 2.6, 0.7, 1500, 11);
    noiseHit(ctx, bus, { t: 0, seed: 301, type: 'lowpass', f: 260, q: 0.8, a: 0.002, d: 0.55, gain: 1.6, centre: true });
    noiseHit(ctx, bus, { t: 0, seed: 303, f: 520, q: 0.8, a: 0.002, d: 0.3, gain: 0.8 });
    noiseHit(ctx, bus, { t: 0, seed: 302, f: 1700, q: 0.7, a: 0.001, d: 0.07, gain: 0.5 });
    tone(ctx, bus, { t: 0, f: [[0, 150], [0.09, 62, 'exp']], a: 0.002, d: 0.45, gain: 0.6 });
  }),

  def('impact-sub-drop', 'Sub Drop', 2.4, ['impact', 'sub', 'drop', 'bass', 'low', 'drop down'], 0.949, (ctx, out) => {
    const sat = drive(ctx, 1.4);
    chain(sat.output, filt(ctx, 'lowpass', 320, 0.6), out);
    const g = vca(ctx);
    env(g.gain, [[0, 0], [0.014, 1], [1.2, 0.72], [2.3, 0]]);
    const o = osc(ctx, 'sine', 96, 0, 2.35);
    env(o.frequency, [[0, 96], [1.7, 31, 'exp'], [2.3, 27, 'exp']]);
    o.connect(g).connect(sat.input);
    noiseHit(ctx, out, { t: 0, seed: 311, type: 'lowpass', f: 320, q: 0.7, a: 0.003, d: 0.12, gain: 0.14, centre: true });
  }),

  def('impact-punch', 'Punchy Hit', 0.55, ['impact', 'punch', 'hit', 'kick', 'tight', 'thump'], 0.839, (ctx, out) => {
    const sat = drive(ctx, 2);
    sat.output.connect(out);
    kick(ctx, sat.input, { t: 0, gain: 0.9, f0: 190, f1: 52, sweep: 0.06, d: 0.36, click: 0.45, seed: 321 });
    tone(ctx, sat.input, { t: 0, type: 'triangle', f: [[0, 420], [0.05, 160, 'exp']], a: 0.001, d: 0.11, gain: 0.3 });
    noiseHit(ctx, out, { t: 0, seed: 322, f: 2400, q: 0.8, a: 0.0008, d: 0.07, gain: 0.32 });
  }),

  def('impact-braam', 'Braam', 3.4, ['impact', 'braam', 'brass', 'trailer', 'cinematic', 'horn'], 0.501, (ctx, out) => {
    const bus = withTail(ctx, out, 1.8, 0.32, 2600, 13);
    const lp = filt(ctx, 'lowpass', 200, 1.4);
    env(lp.frequency, [[0, 200], [0.12, 1700, 'exp'], [1.4, 900, 'exp'], [3.2, 240, 'exp']]);
    const sat = drive(ctx, 3);
    const g = vca(ctx);
    env(g.gain, [[0, 0], [0.04, 0.8], [1.6, 0.68], [3.25, 0]]);
    chain(lp, sat.input);
    chain(sat.output, filt(ctx, 'lowpass', 3400, 0.6), g, bus);
    // D1 / D2 / A2 / D3, three slightly detuned saws each, scooping up into pitch.
    for (const [f, level] of [[36.71, 0.5], [73.42, 0.5], [110, 0.3], [146.83, 0.22]] as const) {
      for (const cents of [-11, 0, 9]) {
        const o = osc(ctx, 'sawtooth', f, 0, 3.3, cents);
        env(o.detune, [[0, cents - 70], [0.11, cents]]);
        o.connect(vca(ctx, level / 3)).connect(lp);
      }
    }
    const sub = vca(ctx);
    env(sub.gain, [[0, 0], [0.05, 0.5], [1.8, 0.4], [3.2, 0]]);
    osc(ctx, 'sine', 36.71, 0, 3.3).connect(sub).connect(out);
  }),

  def('impact-thud', 'Soft Thud', 0.5, ['impact', 'thud', 'soft', 'drop', 'bump', 'muffled'], 1.0, (ctx, out) => {
    const lp = filt(ctx, 'lowpass', 1100, 0.6);
    lp.connect(out);
    tone(ctx, lp, { t: 0, f: [[0, 112], [0.08, 58, 'exp']], a: 0.003, d: 0.3, gain: 1 });
    noiseHit(ctx, lp, { t: 0, seed: 341, type: 'lowpass', f: 520, q: 0.7, a: 0.002, d: 0.11, gain: 0.7, centre: true });
  }),

  def('impact-metal-clang', 'Metal Clang', 2.1, ['impact', 'metal', 'clang', 'hit', 'pipe', 'anvil'], 0.415, (ctx, out) => {
    const verb = reverb(ctx, { decay: 1.0, damp: 6000, size: 0.8 });
    verb.output.connect(vca(ctx, 0.14)).connect(out);
    const bus = vca(ctx, 1);
    bus.connect(out);
    bus.connect(verb.input);
    // Modes of a struck steel plate; each is a slightly detuned pair so the ring shimmers.
    const modes = [1, 1.47, 2.09, 2.56, 3.14, 3.93, 4.71, 5.42, 6.83];
    modes.forEach((ratio, i) => {
      const f = 540 * ratio;
      const level = 0.5 / (1 + i * 0.55);
      const d = 1.7 / Math.pow(ratio, 0.75);
      tone(ctx, bus, { t: 0, f: f * 0.998, a: 0.001, d, gain: level, pan: -0.3 + (i % 3) * 0.3 });
      tone(ctx, bus, { t: 0, f: f * 1.003, a: 0.001, d: d * 0.9, gain: level * 0.7, pan: 0.3 - (i % 3) * 0.3 });
    });
    noiseHit(ctx, bus, { t: 0, seed: 351, f: 4600, q: 1, a: 0.0006, d: 0.05, gain: 0.5 });
    tone(ctx, bus, { t: 0, f: [[0, 260], [0.03, 170, 'exp']], a: 0.001, d: 0.14, gain: 0.45 });
  }),

  def('impact-slam', 'Heavy Slam', 2.2, ['impact', 'slam', 'door', 'bang', 'room', 'shut'], 0.766, (ctx, out) => {
    const bus = withTail(ctx, out, 1.7, 0.75, 2600, 17);
    tone(ctx, out, { t: 0, f: [[0, 124], [0.07, 48, 'exp']], a: 0.002, d: 0.5, gain: 0.9 });
    noiseHit(ctx, bus, { t: 0, seed: 361, f: 420, q: 1.4, a: 0.001, d: 0.13, gain: 1.4, centre: true });
    noiseHit(ctx, bus, { t: 0, seed: 362, type: 'highpass', f: 2000, q: 0.7, a: 0.0006, d: 0.04, gain: 0.3 });
    // The latch rattling a moment later.
    noiseHit(ctx, bus, { t: 0.047, seed: 363, f: 900, q: 2, a: 0.001, d: 0.05, gain: 0.5, centre: true });
  }),

  def('impact-finger-snap', 'Finger Snap', 0.34, ['impact', 'snap', 'finger', 'click', 'crisp', 'snap fingers'], 1.81, (ctx, out) => {
    const room = reverb(ctx, { decay: 0.25, size: 0.5, damp: 7000, pre: 0.004 });
    room.output.connect(vca(ctx, 0.12)).connect(out);
    const bus = vca(ctx, 1);
    bus.connect(out);
    bus.connect(room.input);
    noiseHit(ctx, bus, { t: 0, seed: 371, f: 3200, q: 2, a: 0.0005, d: 0.012, gain: 0.3, centre: true });
    noiseHit(ctx, bus, { t: 0.022, seed: 372, f: 2300, q: 2.2, steep: true, a: 0.0005, d: 0.07, gain: 3, centre: true });
    tone(ctx, bus, { t: 0.022, f: [[0, 2300], [0.03, 1900, 'exp']], a: 0.0005, d: 0.035, gain: 0.25 });
  }),

  def('impact-trailer-hit', 'Trailer Hit', 4.2, ['impact', 'trailer', 'hit', 'cinematic', 'epic', 'boom', 'tail'], 0.554, (ctx, out) => {
    subBoom(ctx, out, 0, 70, 38, 0.35, 1.9, 0.9);
    const bus = withTail(ctx, out, 3.2, 0.8, 2200, 23);
    // Distorted mid-range body.
    const lp = filt(ctx, 'lowpass', 2500, 1);
    env(lp.frequency, [[0, 2500], [0.5, 300, 'exp']]);
    const sat = drive(ctx, 4);
    const g = vca(ctx);
    env(g.gain, [[0, 0], [0.003, 0.5], [0.9, 0.0005, 'exp'], [0.92, 0]]);
    chain(lp, sat.input);
    chain(sat.output, g, bus);
    for (const f of [73.42, 110, 146.83]) for (const cents of [-9, 8]) osc(ctx, 'sawtooth', f, 0, 0.95, cents).connect(vca(ctx, 0.3)).connect(lp);
    noiseHit(ctx, bus, { t: 0, seed: 381, f: 900, q: 0.7, a: 0.001, d: 0.7, gain: 0.55 });
    noiseHit(ctx, bus, { t: 0, seed: 382, type: 'highpass', f: 3200, q: 0.7, a: 0.002, d: 1.5, gain: 0.16 });
  }),

  def('impact-big-drum', 'Big Drum', 1.7, ['impact', 'drum', 'taiko', 'tom', 'hit', 'epic', 'percussion'], 0.666, (ctx, out) => {
    const bus = withTail(ctx, out, 1.3, 0.5, 1900, 29);
    tone(ctx, bus, { t: 0, f: [[0, 150], [0.06, 82, 'exp'], [0.6, 74, 'exp']], a: 0.002, d: 1.0, gain: 1 });
    tone(ctx, bus, { t: 0, f: [[0, 220], [0.05, 124, 'exp']], a: 0.002, d: 0.45, gain: 0.32 });
    noiseHit(ctx, bus, { t: 0, seed: 391, f: 600, q: 0.8, a: 0.001, d: 0.09, gain: 0.9, centre: true });
    noiseHit(ctx, bus, { t: 0, seed: 392, f: 2800, q: 1, a: 0.0006, d: 0.02, gain: 0.35, centre: true });
  }),
];

export default sounds;
