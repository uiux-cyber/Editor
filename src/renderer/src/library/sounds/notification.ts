import type { SoundDef } from '../types';
import { BELL, CHIME, GLOCK, MARIMBA, chime, convReverb, fm, hz, noiseHit, oneShot, pad, reverb, vca, type Ctx, type Partial3 } from './lib/synth';

const def = oneShot('notification');

/** Dry bus plus a small, bright room so the tones do not sound glued to the speaker. */
function room(ctx: Ctx, out: AudioNode, decay = 1.0, wet = 0.1): GainNode {
  const bus = vca(ctx, 1);
  const verb = reverb(ctx, { decay, damp: 6500, size: 0.9, lowCut: 300 });
  bus.connect(out);
  bus.connect(verb.input);
  verb.output.connect(vca(ctx, wet)).connect(out);
  return bus;
}

/** Square-ish, bright partials for arcade-style tones. */
const ARCADE: readonly Partial3[] = [
  [1, 1, 1],
  [3, 0.3, 0.7],
  [5, 0.14, 0.5],
  [7, 0.06, 0.35],
];

const sounds: SoundDef[] = [
  def('notify-rising-chime', 'Rising Chime', 1.8, ['chime', 'notification', 'rising', 'alert', 'bell', 'positive'], 0.616, (ctx, out) => {
    const bus = room(ctx, out, 1.1, 0.1);
    ['C6', 'E6', 'G6'].forEach((note, i) => chime(ctx, bus, { t: i * 0.13, f: hz(note), d: 1.2, gain: 0.75 + i * 0.08, pan: (i - 1) * 0.25 }));
  }),

  def('notify-soft-two-tone', 'Soft Two-Tone', 2.0, ['chime', 'notification', 'two tone', 'doorbell', 'soft', 'gentle'], 0.773, (ctx, out) => {
    const bus = room(ctx, out, 1.2, 0.1);
    chime(ctx, bus, { t: 0, f: hz('E6'), d: 1.3, gain: 0.85, a: 0.006, pan: -0.15 });
    chime(ctx, bus, { t: 0.32, f: hz('C6'), d: 1.5, gain: 0.95, a: 0.006, pan: 0.15 });
  }),

  def('notify-marimba-ping', 'Marimba Ping', 1.1, ['marimba', 'ping', 'notification', 'wood', 'mallet', 'warm'], 0.513, (ctx, out) => {
    const bus = room(ctx, out, 0.6, 0.08);
    for (const [t, note, gain] of [[0, 'G4', 0.85], [0.16, 'C5', 1]] as const) {
      chime(ctx, bus, { t, f: hz(note), d: 0.75, gain, a: 0.002, partials: MARIMBA });
      noiseHit(ctx, bus, { t, seed: 611, type: 'lowpass', f: 900, q: 0.7, a: 0.001, d: 0.02, gain: gain * 0.5, centre: true });
    }
  }),

  def('notify-message-tone', 'Message Tone', 0.9, ['message', 'text', 'notification', 'chat', 'ping', 'incoming'], 0.739, (ctx, out) => {
    const bus = room(ctx, out, 0.6, 0.08);
    fm(ctx, bus, { t: 0, f: hz('A5'), ratio: 2, index: 1.1, indexDecay: 0.08, d: 0.26, gain: 0.8 });
    fm(ctx, bus, { t: 0.12, f: hz('D6'), ratio: 2, index: 1.1, indexDecay: 0.1, d: 0.6, gain: 1 });
  }),

  def('notify-level-up', 'Level Up', 1.5, ['level up', 'game', 'reward', 'power up', 'win', 'notification'], 0.523, (ctx, out) => {
    const bus = room(ctx, out, 1.0, 0.1);
    ['C5', 'E5', 'G5', 'C6'].forEach((note, i) => chime(ctx, bus, { t: i * 0.08, f: hz(note), d: 0.22, gain: 0.6, a: 0.002, partials: ARCADE }));
    for (const note of ['C6', 'E6', 'G6']) chime(ctx, bus, { t: 0.34, f: hz(note), d: 0.95, gain: 0.45, a: 0.003, partials: CHIME });
    chime(ctx, bus, { t: 0.42, f: hz('E7'), d: 0.5, gain: 0.14, pan: 0.4 });
    chime(ctx, bus, { t: 0.5, f: hz('G7'), d: 0.5, gain: 0.12, pan: -0.4 });
  }),

  def('notify-coin', 'Coin', 0.75, ['coin', 'game', 'collect', 'pickup', 'reward', 'points'], 1.0, (ctx, out) => {
    chime(ctx, out, { t: 0, f: hz('A5'), d: 0.09, gain: 0.7, a: 0.002, partials: ARCADE });
    chime(ctx, out, { t: 0.075, f: hz('E6'), d: 0.6, gain: 0.9, a: 0.002, partials: ARCADE });
  }),

  def('notify-achievement', 'Achievement', 2.4, ['achievement', 'success', 'arpeggio', 'reward', 'unlock', 'fanfare', 'win'], 0.625, (ctx, out) => {
    const bus = vca(ctx, 1);
    const verb = convReverb(ctx, { decay: 1.5, tone: 5000, seed: 31 });
    bus.connect(out);
    bus.connect(verb.input);
    verb.output.connect(vca(ctx, 0.3)).connect(out);
    ['G4', 'B4', 'D5', 'G5', 'B5', 'D6'].forEach((note, i) => {
      chime(ctx, bus, { t: i * 0.09, f: hz(note), d: 0.9, gain: 0.5 + i * 0.04, a: 0.002, pan: (i % 2 ? 0.3 : -0.3) * (i / 5), partials: GLOCK });
    });
    chime(ctx, bus, { t: 0.6, f: hz('G6'), d: 1.2, gain: 0.5, partials: CHIME });
    pad(ctx, bus, { t: 0.05, dur: 1.9, freqs: [hz('G3'), hz('B3'), hz('D4')], gain: 0.16, a: 0.35, r: 1.1, cutoff: 1500, detune: 7 });
  }),

  def('notify-soft-bell', 'Soft Bell', 2.8, ['bell', 'soft', 'notification', 'meditation', 'calm', 'ring'], 0.426, (ctx, out) => {
    const bus = room(ctx, out, 1.4, 0.1);
    chime(ctx, bus, { t: 0, f: hz('D5'), d: 2.4, gain: 0.8, a: 0.004, partials: BELL });
  }),

  def('notify-gentle-reminder', 'Gentle Reminder', 1.4, ['reminder', 'notification', 'gentle', 'alert', 'calendar', 'soft'], 0.711, (ctx, out) => {
    const bus = room(ctx, out, 0.8, 0.1);
    for (const [t, gain] of [[0, 1], [0.5, 0.6]] as const) {
      chime(ctx, bus, { t, f: hz('F5'), d: 0.4, gain: 0.8 * gain, a: 0.004 });
      chime(ctx, bus, { t: t + 0.14, f: hz('A5'), d: 0.6, gain: 0.9 * gain, a: 0.004 });
    }
  }),
];

export default sounds;
