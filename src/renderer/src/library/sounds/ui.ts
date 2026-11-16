import type { SoundDef } from '../types';
import { chime, env, filt, noiseHit, oneShot, osc, sweep, tone, vca, type EdgeOpts, type Partial3 } from './lib/synth';

const def = oneShot('ui');

/** UI sounds are tiny: keep the edge fades short so the transients stay crisp. */
const TIGHT: EdgeOpts = { attack: 0.001, release: 0.006 };

/** Soft, mostly-fundamental tone for interface blips. */
const SOFT: readonly Partial3[] = [
  [1, 1, 1],
  [2, 0.18, 0.6],
  [3, 0.05, 0.4],
];

const sounds: SoundDef[] = [
  def('ui-click-soft', 'Soft Click', 0.09, ['click', 'ui', 'button', 'soft', 'tap', 'interface'], 0.851, (ctx, out) => {
    tone(ctx, out, { t: 0, f: [[0, 1900], [0.02, 1100, 'exp']], a: 0.001, d: 0.035, gain: 0.9 });
    noiseHit(ctx, out, { t: 0, seed: 501, f: 3200, q: 1.2, a: 0.0005, d: 0.012, gain: 0.6, centre: true });
  }, TIGHT),

  def('ui-click-crisp', 'Crisp Click', 0.07, ['click', 'ui', 'button', 'crisp', 'tick', 'interface'], 0.911, (ctx, out) => {
    noiseHit(ctx, out, { t: 0, seed: 511, f: 4000, q: 1.5, a: 0.0005, d: 0.014, gain: 2, centre: true });
    tone(ctx, out, { t: 0, f: 2500, a: 0.0005, d: 0.012, gain: 0.3 });
  }, TIGHT),

  def('ui-tap', 'Tap', 0.13, ['tap', 'ui', 'touch', 'knock', 'soft', 'finger'], 0.703, (ctx, out) => {
    tone(ctx, out, { t: 0, f: [[0, 520], [0.03, 260, 'exp']], a: 0.001, d: 0.07, gain: 1 });
    noiseHit(ctx, out, { t: 0, seed: 521, type: 'lowpass', f: 1800, q: 0.7, a: 0.0005, d: 0.015, gain: 0.35, centre: true });
  }, TIGHT),

  def('ui-toggle-on', 'Toggle On', 0.22, ['toggle', 'switch', 'on', 'ui', 'enable', 'interface'], 0.767, (ctx, out) => {
    chime(ctx, out, { t: 0, f: 622, d: 0.07, gain: 0.7, a: 0.002, partials: SOFT });
    chime(ctx, out, { t: 0.07, f: 932, d: 0.12, gain: 0.9, a: 0.002, partials: SOFT });
    noiseHit(ctx, out, { t: 0, seed: 531, f: 2600, q: 1.5, a: 0.0005, d: 0.008, gain: 0.5, centre: true });
  }, TIGHT),

  def('ui-toggle-off', 'Toggle Off', 0.22, ['toggle', 'switch', 'off', 'ui', 'disable', 'interface'], 0.78, (ctx, out) => {
    chime(ctx, out, { t: 0, f: 932, d: 0.07, gain: 0.7, a: 0.002, partials: SOFT });
    chime(ctx, out, { t: 0.07, f: 622, d: 0.12, gain: 0.9, a: 0.002, partials: SOFT });
    noiseHit(ctx, out, { t: 0, seed: 541, f: 2200, q: 1.5, a: 0.0005, d: 0.008, gain: 0.5, centre: true });
  }, TIGHT),

  def('ui-pop-soft', 'Soft Pop', 0.18, ['pop', 'soft', 'ui', 'bloop', 'appear', 'bubble'], 0.683, (ctx, out) => {
    tone(ctx, out, { t: 0, f: [[0, 260], [0.05, 640, 'exp']], a: 0.003, d: 0.1, gain: 1 });
    tone(ctx, out, { t: 0, f: [[0, 520], [0.05, 1280, 'exp']], a: 0.003, d: 0.05, gain: 0.12 });
  }, TIGHT),

  def('ui-bubble', 'Bubble', 0.34, ['bubble', 'water', 'drop', 'ui', 'bloop', 'liquid'], 0.89, (ctx, out) => {
    tone(ctx, out, { t: 0, f: [[0, 420], [0.07, 1100, 'exp']], a: 0.004, d: 0.09, gain: 1, pan: -0.15 });
    tone(ctx, out, { t: 0.13, f: [[0, 620], [0.06, 1500, 'exp']], a: 0.004, d: 0.08, gain: 0.7, pan: 0.15 });
    tone(ctx, out, { t: 0.21, f: [[0, 800], [0.04, 1700, 'exp']], a: 0.003, d: 0.05, gain: 0.3 });
  }, TIGHT),

  def('ui-swipe-tick', 'Swipe Tick', 0.26, ['swipe', 'tick', 'ui', 'slide', 'scroll', 'gesture'], 0.75, (ctx, out) => {
    const tame = filt(ctx, 'lowpass', 9000, 0.6);
    tame.connect(out);
    sweep(ctx, tame, { t: 0, dur: 0.15, seed: 571, type: 'highpass', q: 0.7, gain: 0.45, peakAt: 0.6, f: [[0, 1800], [0.14, 5000, 'exp']], pan: [[0, -0.3], [0.15, 0.2]] });
    tone(ctx, out, { t: 0.15, f: [[0, 1800], [0.02, 1250, 'exp']], a: 0.001, d: 0.05, gain: 0.9 });
    noiseHit(ctx, out, { t: 0.15, seed: 572, f: 3400, q: 1.4, a: 0.0005, d: 0.012, gain: 0.7, centre: true });
  }, TIGHT),

  def('ui-keyboard-key', 'Keyboard Key', 0.17, ['keyboard', 'key', 'type', 'typing', 'press', 'mechanical'], 1.19, (ctx, out) => {
    // Down-stroke: click plus the low "thock" of the case; up-stroke: a lighter click.
    noiseHit(ctx, out, { t: 0, seed: 581, f: 2400, q: 1.4, a: 0.0005, d: 0.012, gain: 1.6, centre: true });
    tone(ctx, out, { t: 0, type: 'triangle', f: [[0, 220], [0.03, 150, 'exp']], a: 0.001, d: 0.05, gain: 0.5 });
    noiseHit(ctx, out, { t: 0.088, seed: 582, f: 3400, q: 1.6, a: 0.0005, d: 0.01, gain: 0.8, centre: true });
    tone(ctx, out, { t: 0.088, type: 'triangle', f: 250, a: 0.001, d: 0.025, gain: 0.25 });
  }, TIGHT),

  def('ui-camera-shutter', 'Camera Shutter', 0.38, ['camera', 'shutter', 'photo', 'snapshot', 'capture', 'click'], 1.14, (ctx, out) => {
    // First curtain.
    noiseHit(ctx, out, { t: 0, seed: 591, f: 1900, q: 1.2, a: 0.0015, d: 0.024, gain: 1.6, centre: true });
    tone(ctx, out, { t: 0, f: 3100, a: 0.0015, d: 0.03, gain: 0.12 });
    // Mechanism travelling.
    sweep(ctx, out, { t: 0.03, dur: 0.075, seed: 592, q: 1.5, gain: 0.3, f: [[0, 900], [0.07, 1600, 'exp']] });
    // Second curtain and mirror slap.
    noiseHit(ctx, out, { t: 0.108, seed: 593, f: 2600, q: 1.3, a: 0.0005, d: 0.032, gain: 1.9, centre: true });
    tone(ctx, out, { t: 0.108, type: 'triangle', f: [[0, 320], [0.03, 210, 'exp']], a: 0.001, d: 0.05, gain: 0.22 });
    noiseHit(ctx, out, { t: 0.165, seed: 594, f: 3600, q: 2, a: 0.0005, d: 0.02, gain: 0.5 });
  }, TIGHT),

  def('ui-mouse-click', 'Mouse Click', 0.14, ['mouse', 'click', 'button', 'computer', 'press', 'ui'], 1.54, (ctx, out) => {
    noiseHit(ctx, out, { t: 0, seed: 601, f: 2900, q: 2, a: 0.0004, d: 0.009, gain: 2.4, centre: true });
    tone(ctx, out, { t: 0, f: 1150, a: 0.0005, d: 0.014, gain: 0.35 });
    noiseHit(ctx, out, { t: 0.076, seed: 602, f: 3600, q: 2, a: 0.0004, d: 0.008, gain: 1.3, centre: true });
    tone(ctx, out, { t: 0.076, f: 1500, a: 0.0005, d: 0.01, gain: 0.2 });
  }, TIGHT),

  def('ui-select', 'Select', 0.32, ['select', 'choose', 'ui', 'confirm', 'menu', 'pick'], 0.581, (ctx, out) => {
    chime(ctx, out, { t: 0, f: 880, d: 0.24, gain: 0.9, a: 0.002, partials: [[1, 1, 1], [1.5, 0.45, 0.8], [3, 0.08, 0.4]] });
  }, TIGHT),

  def('ui-error-buzz', 'Error Buzz', 0.36, ['error', 'buzz', 'wrong', 'deny', 'invalid', 'ui', 'fail'], 0.519, (ctx, out) => {
    const lp = filt(ctx, 'lowpass', 1100, 0.7);
    lp.connect(out);
    [0, 0.17].forEach((t, i) => {
      const g = vca(ctx);
      env(g.gain, [[t, 0], [t + 0.006, 0.8], [t + 0.12, 0.8], [t + 0.135, 0]]);
      const f = i === 0 ? 155.56 : 146.83;
      osc(ctx, 'sawtooth', f, t, t + 0.14).connect(g);
      osc(ctx, 'square', f * 1.004, t, t + 0.14).connect(vca(ctx, 0.5)).connect(g);
      g.connect(lp);
    });
  }, TIGHT),

  def('ui-success-blip', 'Success Blip', 0.6, ['success', 'blip', 'done', 'confirm', 'ok', 'positive', 'ui'], 0.71, (ctx, out) => {
    chime(ctx, out, { t: 0, f: 783.99, d: 0.2, gain: 0.75, a: 0.002, partials: SOFT });
    chime(ctx, out, { t: 0.11, f: 1174.66, d: 0.44, gain: 0.95, a: 0.002, partials: SOFT });
  }, TIGHT),

  def('ui-hover-tick', 'Hover Tick', 0.06, ['hover', 'tick', 'ui', 'subtle', 'light', 'rollover'], 0.734, (ctx, out) => {
    tone(ctx, out, { t: 0, f: [[0, 2400], [0.015, 2000, 'exp']], a: 0.001, d: 0.022, gain: 1 });
  }, TIGHT),

  def('ui-cancel', 'Cancel', 0.36, ['cancel', 'back', 'close', 'dismiss', 'ui', 'negative'], 0.77, (ctx, out) => {
    chime(ctx, out, { t: 0, f: 659.25, d: 0.12, gain: 0.8, a: 0.002, partials: SOFT });
    chime(ctx, out, { t: 0.1, f: 440, d: 0.22, gain: 0.9, a: 0.002, partials: SOFT });
  }, TIGHT),
];

export default sounds;
