/**
 * Engine for seamless, tempo-synced music beds.
 *
 * A loop is rendered into exactly `bars` bars. Nothing is faded at the loop point; instead every
 * sound that rings past the end is wrapped around to the start, so the rendered buffer is one
 * period of a periodic signal:
 *
 *  - Notes, chord stabs and drum hits are baked buffers mixed into a loop-length buffer per bus
 *    (`Loop.hit`): the part that would fall after the loop point is added at the start.
 *  - Long pads and drones (`Loop.voice`) use oscillators whose frequency is rounded to a whole
 *    number of cycles per loop (an error of a few hundredths of a hertz) and whose start time is
 *    aligned to that grid. An oscillator restarted at time 0 is therefore exactly in phase with
 *    the one that was still sounding at the loop point, and the voice's envelopes simply continue
 *    from the value they had reached.
 *
 * For this to hold the signal path of a loop must be memoryless: oscillators and buffers into
 * gains, panners and the master wave-shaper only. Filters, delays, reverbs and compressors carry
 * state across the loop point that cannot be reproduced at time 0, so they are not used here:
 *  - timbre comes from band-limited waveforms, and "filter envelopes" are cross-fades between a
 *    dull and a bright waveform of the same phase;
 *  - echoes are scheduled as real notes, which wrap like any other note;
 *  - room and reverb tails of the drums are baked into their buffers.
 */

import { bakeLayers, harmonicsOf, type BakeLayer, type Shape } from './bake';
import { CEILING, FLOOR, cached, mtof, panner, setWave, softClip, vca, wave, type Ctx, type Pt, type WaveType } from './synth';

export type { Shape };

/** Length in seconds of `bars` 4/4 bars at `bpm`. */
export const loopLength = (bpm: number, bars: number): number => (bars * 240) / bpm;

export interface LoopOpts {
  bpm: number;
  bars: number;
  /** Gain into the master limiter. */
  level?: number;
  /** Delay of every second 16th note, as a fraction of a 16th (0 = straight, 0.33 = triplet feel). */
  swing?: number;
}

/** One scheduling pass of a pitched voice (see `Loop.voice`). */
export class Voice {
  readonly ctx: Ctx;

  constructor(
    readonly loop: Loop,
    /** Start time of this pass; negative for the pass that renders the wrapped-around tail. */
    readonly t0: number,
    readonly len: number,
  ) {
    this.ctx = loop.ctx;
  }

  /**
   * Oscillator locked to the loop's phase grid. It runs until `until` seconds after the voice
   * start (default: the whole voice).
   */
  osc(type: WaveType, freq: number, detune = 0, until = this.len): OscillatorNode {
    const f = this.loop.q(freq * Math.pow(2, detune / 1200));
    const o = this.ctx.createOscillator();
    setWave(o, type);
    o.frequency.value = f;
    const start = this.t0 <= 0 ? 0 : Math.floor(this.t0 * f) / f;
    o.start(start);
    o.stop(Math.max(start, Math.min(this.loop.len, this.t0 + Math.min(until, this.len))));
    return o;
  }

  /** Schedule an envelope whose times are relative to the start of the voice. */
  env(p: AudioParam, pts: readonly Pt[]): void {
    const t0 = this.t0;
    let i = 0;
    let prevT = 0;
    let prevV = 0;
    if (t0 < 0) {
      // Wrapped pass: evaluate the envelope at the loop start and carry on from there.
      while (i < pts.length && t0 + pts[i][0] <= 0) i++;
      if (i === 0) {
        prevV = pts[0][1];
      } else if (i === pts.length) {
        prevV = pts[i - 1][1];
      } else {
        const ta = t0 + pts[i - 1][0];
        const va = pts[i - 1][1];
        const tb = t0 + pts[i][0];
        const vb = pts[i][1];
        const x = (0 - ta) / (tb - ta);
        const curve = pts[i][2];
        if (curve === 'set') prevV = va;
        else if (curve === 'exp') prevV = Math.max(FLOOR, va) * Math.pow(Math.max(FLOOR, vb) / Math.max(FLOOR, va), x);
        else prevV = va + (vb - va) * x;
      }
      p.setValueAtTime(prevV, 0);
    }
    for (; i < pts.length; i++) {
      const t = t0 + pts[i][0];
      const v = pts[i][1];
      const curve = pts[i][2];
      if ((i === 0 && t0 >= 0) || curve === 'set') {
        p.setValueAtTime(v, t);
      } else if (curve === 'exp') {
        if (prevV < FLOOR) p.setValueAtTime(FLOOR, prevT);
        p.exponentialRampToValueAtTime(Math.max(FLOOR, v), t);
      } else {
        p.linearRampToValueAtTime(v, t);
      }
      prevT = t;
      prevV = v;
    }
  }

  /** Oscillator → enveloped gain → `to`: the building block of every loop instrument. */
  layer(type: WaveType, freq: number, pts: readonly Pt[], to: AudioNode, detune = 0): void {
    const g = vca(this.ctx, 0);
    this.env(g.gain, pts);
    this.osc(type, freq, detune, pts[pts.length - 1][0] + 0.002)
      .connect(g)
      .connect(to);
  }

  /** Connect `node` to `out`, through a panner when `pan` is not centred. */
  send(node: AudioNode, out: AudioNode, pan = 0): void {
    if (pan) node.connect(panner(this.ctx, Math.max(-1, Math.min(1, pan)))).connect(out);
    else node.connect(out);
  }
}

export class Loop {
  readonly ctx: Ctx;
  readonly bpm: number;
  readonly bars: number;
  /** Seconds per beat, per 16th-note step, per bar, and for the whole loop. */
  readonly beat: number;
  readonly step: number;
  readonly bar: number;
  readonly len: number;
  readonly swing: number;
  /** Master bus (feeds the limiter). */
  readonly out: GainNode;

  constructor(ctx: Ctx, dest: AudioNode, o: LoopOpts) {
    this.ctx = ctx;
    this.bpm = o.bpm;
    this.bars = o.bars;
    this.beat = 60 / o.bpm;
    this.step = this.beat / 4;
    this.bar = this.beat * 4;
    this.len = loopLength(o.bpm, o.bars);
    this.swing = o.swing ?? 0;
    const clip = softClip(ctx, o.level ?? 1);
    const ceiling = vca(ctx, CEILING);
    clip.output.connect(ceiling).connect(dest);
    this.out = clip.input;
  }

  /** Time of a position counted in 16th notes from the loop start (fractions allowed), with swing. */
  at(step16: number): number {
    const whole = Math.floor(step16 + 1e-9);
    const late = whole % 2 === 1 ? this.swing * this.step : 0;
    return step16 * this.step + late;
  }

  /** Time of bar / beat / 16th (all zero-based), with swing. */
  pos(bar: number, beat = 0, sixteenth = 0): number {
    return this.at(bar * 16 + beat * 4 + sixteenth);
  }

  /** Fold a time into the loop. */
  wrap(t: number): number {
    const w = t % this.len;
    return w < 0 ? w + this.len : w;
  }

  /** Round a frequency so that a whole number of cycles fits into the loop. */
  q(freq: number): number {
    return Math.max(1, Math.round(freq * this.len)) / this.len;
  }

  /** A mix bus connected to the master (or to `to`). */
  bus(gain = 1, pan = 0, to: AudioNode = this.out): GainNode {
    const g = vca(this.ctx, gain);
    if (pan) g.connect(panner(this.ctx, pan)).connect(to);
    else g.connect(to);
    return g;
  }

  /** Loop-length stereo mix of all hits sent to each destination (see `hit`). */
  private readonly mixes = new Map<AudioNode, AudioBuffer>();

  /**
   * Play a baked buffer at `t`; whatever rings past the loop point is wrapped to the start.
   *
   * Hits are not individual nodes: they are mixed in JS into one loop-length buffer per
   * destination (with the equal-power pan law of a StereoPannerNode), and `finish` plays each mix
   * through a single source. A bed has hundreds of notes, and that keeps the graph tiny and the
   * mix order fixed. A hit that lands exactly on the loop start gets a 3 ms fade-in so the clip
   * never opens on a full-scale sample.
   */
  hit(buffer: AudioBuffer, t: number, gain: number, out: AudioNode = this.out, pan = 0): void {
    const sr = this.ctx.sampleRate;
    const n = Math.round(this.len * sr);
    let start = Math.round(this.wrap(t) * sr);
    if (start >= n) start = 0;
    let mix = this.mixes.get(out);
    if (!mix) {
      mix = this.ctx.createBuffer(2, n, sr);
      this.mixes.set(out, mix);
    }
    const left = mix.getChannelData(0);
    const right = mix.getChannelData(1);
    const inL = buffer.getChannelData(0);
    const inR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    // Pans snap to steps of 0.05. A centred hit is not panned at all (a mono hit plays at full
    // level on both sides, like a mono source connected straight to a stereo bus); otherwise the
    // gains are those of a StereoPannerNode: mono input → (ll, rr), stereo input also feeds
    // across (lr / rl).
    const p = Math.round(Math.max(-1, Math.min(1, pan)) * 20) / 20;
    let ll: number;
    let rr: number;
    let lr = 0;
    let rl = 0;
    if (p === 0) {
      ll = 1;
      rr = 1;
    } else if (!inR) {
      const x = ((p + 1) / 2) * (Math.PI / 2);
      ll = Math.cos(x);
      rr = Math.sin(x);
    } else if (p <= 0) {
      const x = (p + 1) * (Math.PI / 2);
      ll = 1;
      rl = Math.cos(x);
      rr = Math.sin(x);
    } else {
      const x = p * (Math.PI / 2);
      ll = Math.cos(x);
      lr = Math.sin(x);
      rr = 1;
    }
    const fade = start === 0 ? Math.round(0.003 * sr) : 0;
    const len = Math.min(buffer.length, n);
    for (let i = 0; i < len; i++) {
      const g = i < fade ? (gain * i) / fade : gain;
      const a = inL[i] * g;
      const b = inR ? inR[i] * g : a;
      const j = (start + i) % n;
      if (inR) {
        left[j] += a * ll + b * rl;
        right[j] += b * rr + a * lr;
      } else {
        left[j] += a * ll;
        right[j] += a * rr;
      }
    }
  }

  /** Start the hit mixes (call once, after the whole bed has been scheduled). */
  finish(): void {
    for (const [out, mix] of this.mixes) {
      const src = this.ctx.createBufferSource();
      src.buffer = mix;
      src.connect(out);
      src.start(0);
      src.stop(this.len);
    }
    this.mixes.clear();
  }

  /**
   * Schedule a pitched voice of `len` seconds at `t`. `build` is called once for the normal pass
   * and, when the voice rings past the loop point, a second time for the wrapped-around part.
   * Inside `build`, create oscillators with `v.osc` / `v.layer` and automate with `v.env` only.
   */
  voice(t: number, len: number, build: (v: Voice) => void): void {
    const t0 = this.wrap(t);
    const length = Math.min(len, this.len);
    build(new Voice(this, t0, length));
    if (t0 + length > this.len + 1e-9) build(new Voice(this, t0 - this.len, length));
  }

  /** Play a buffer that is exactly one loop long (seamless noise beds). */
  bed(buffer: AudioBuffer, gain: number, out: AudioNode = this.out): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(vca(this.ctx, gain)).connect(out);
    src.start(0);
    src.stop(this.len);
  }

  /**
   * Side-chain style ducking: dip `param` (normally 1) at each time in `times` and let it recover
   * within `release` seconds. Releases must not overlap the next dip.
   */
  pump(param: AudioParam, times: readonly number[], depth: number, release: number): void {
    const ts = [...new Set(times.map((t) => Math.round(this.wrap(t) * 1e5) / 1e5))].filter((t) => t < this.len).sort((a, b) => a - b);
    if (ts.length === 0) return;
    const attack = release * 0.08;
    // Level `x` seconds into a dip that began at level `from`.
    const duck = (from: number, x: number): number =>
      x < attack ? from + (1 - depth - from) * (x / attack) : 1 - depth * Math.pow(1 - Math.min(1, (x - attack) / (release - attack)), 2.2);
    const gap = (i: number): number => (i + 1 < ts.length ? ts[i + 1] : ts[0] + this.len) - ts[i];
    // A dip that is cut short by the next one hands over its level; two passes reach the steady state.
    const from: number[] = [];
    let level = 1;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < ts.length; i++) {
        from[i] = level;
        level = duck(level, Math.min(release, gap(i)));
      }
    }
    const segment = (i: number, when: number, x0: number, x1: number): void => {
      if (x1 - x0 < 0.001) return;
      const n = 32;
      const curve = new Float32Array(n);
      for (let k = 0; k < n; k++) curve[k] = duck(from[i], x0 + ((x1 - x0) * k) / (n - 1));
      param.setValueCurveAtTime(curve, when, x1 - x0 - 0.0002);
    };
    for (let i = 0; i < ts.length; i++) {
      const len = Math.min(release, gap(i));
      const first = this.len - ts[i];
      if (first >= len) {
        segment(i, ts[i], 0, len);
      } else {
        // The recovery crosses the loop point: finish it at the start of the loop.
        segment(i, ts[i], 0, first);
        segment(i, 0, first, len);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------------------------

/**
 * Amplitude envelope of a held note, relative to its start: linear attack `a`, exponential decay
 * over `d` to `s * peak`, hold until `dur`, then a release of `r` seconds.
 */
export function noteEnv(peak: number, a: number, d: number, s: number, dur: number, r: number): Pt[] {
  const pts: Pt[] = [
    [0, 0],
    [a, peak],
  ];
  const sus = Math.max(FLOOR, peak * s);
  const off = Math.max(dur, a + 0.001);
  let level = sus;
  if (off >= a + d) {
    pts.push([a + d, sus, 'exp']);
    if (off > a + d) pts.push([off, sus]);
  } else {
    level = peak * Math.pow(sus / peak, (off - a) / d);
    pts.push([off, level, 'exp']);
  }
  pts.push([off + r * 0.7, Math.max(FLOOR, level * 0.03), 'exp']);
  pts.push([off + r, 0]);
  return pts;
}

/** Percussive envelope: short attack, exponential decay (`decay` = time to fall by 60 dB). */
export function pluckEnv(peak: number, decay: number, attack = 0.002): Pt[] {
  return [
    [0, 0],
    [attack, peak],
    [attack + decay, Math.max(FLOOR, peak * 0.001), 'exp'],
    [attack + decay + 0.008, 0],
  ];
}

const endOf = (pts: readonly Pt[]): number => pts[pts.length - 1][0];

// ---------------------------------------------------------------------------------------------
// Baked instruments: every note is rendered once (and cached) and then triggered like a sample
// ---------------------------------------------------------------------------------------------

export interface NoteOpts {
  /** Start time in seconds (folded into the loop). */
  t: number;
  /** MIDI note number. */
  note: number;
  /** Velocity 0..1. */
  vel?: number;
  pan?: number;
}

interface LayerSpec {
  shape: Shape;
  /** Brightness as a harmonic number (see `harmonicsOf`). */
  cut?: number;
  slope?: number;
  /** Explicit harmonic amplitudes instead of a shape. */
  harmonics?: readonly number[];
  pts: readonly Pt[];
  /** Frequency ratio against the note (default 1). */
  ratio?: number;
  centre?: boolean;
}

const toLayer = (f: number, s: LayerSpec): BakeLayer => {
  const lf = f * (s.ratio ?? 1);
  return { harmonics: s.harmonics ?? harmonicsOf(s.shape, s.cut ?? 1, s.slope ?? 2, 18000 / lf), pts: s.pts, f: lf, centre: s.centre };
};

/** Bake (once per distinct `key`) and trigger a stack of layers at frequency `f`. */
function play(loop: Loop, out: AudioNode, key: string, t: number, f: number, specs: readonly LayerSpec[], gain = 1, pan = 0, detune = 0, spread = 0.5): void {
  const buffer = cached(loop.ctx, key, () =>
    bakeLayers(
      loop.ctx,
      specs.map((s) => toLayer(f, s)),
      { detune, spread },
    ),
  );
  loop.hit(buffer, t, gain, out, pan);
}

const EP_WAVE = [1, 0.46, 0.2, 0.1, 0.055, 0.03, 0.018, 0.01];

export interface KeysOpts extends NoteOpts {
  dur: number;
  /** Brightness of the attack (1 = default). */
  bright?: number;
  rel?: number;
  /** Detune between the left and right oscillator in cents (chorus / "dusty" feel). */
  detune?: number;
  spread?: number;
}

/** Electric-piano-like keys: a warm body, a brighter "bark" on the attack and a short tine. */
export function keys(loop: Loop, out: AudioNode, o: KeysOpts): void {
  const vel = o.vel ?? 0.8;
  const f = mtof(o.note);
  const bright = o.bright ?? 1;
  const rel = o.rel ?? 0.3;
  const detune = o.detune ?? 4;
  const spread = o.spread ?? 0.25;
  const cut = Math.max(1.4, Math.min(16, (1500 + 2600 * vel * bright) / f));
  const specs: LayerSpec[] = [
    { shape: 'sine', harmonics: EP_WAVE, pts: noteEnv(vel * 0.8, 0.004, 0.55, 0.36, o.dur, rel) },
    { shape: 'reed', cut, pts: pluckEnv(vel * vel * 0.3 * bright, 0.3, 0.003) },
  ];
  if (f * 4 < 5200) specs.push({ shape: 'sine', ratio: 4, pts: pluckEnv(vel * vel * 0.08, 0.16), centre: true });
  play(loop, out, ['keys', o.note, o.dur.toFixed(4), vel, bright, rel, detune, spread].join(':'), o.t, f, specs, 1, o.pan ?? 0, detune, spread);
}

export interface PluckNoteOpts extends NoteOpts {
  /** Time to fall by 60 dB (s). */
  decay?: number;
  shape?: Shape;
  /** The spectrum opens to `f * bright` Hz on the attack (capped at 9 kHz). */
  bright?: number;
  /** Where the spectrum settles, as a harmonic number. */
  floor?: number;
  /** Detune of a left/right oscillator pair in cents (0 = single centred oscillator). */
  detune?: number;
  spread?: number;
}

/** Synth pluck: a bright attack that mellows quickly while the body rings out. */
export function pluckNote(loop: Loop, out: AudioNode, o: PluckNoteOpts): void {
  const vel = o.vel ?? 0.8;
  const f = mtof(o.note);
  const decay = o.decay ?? 0.4;
  const shape = o.shape ?? 'saw';
  const floor = o.floor ?? 1.4;
  const bright = o.bright ?? 8;
  const detune = o.detune ?? 0;
  const spread = o.spread ?? 0.4;
  const top = Math.max(floor, (Math.min(9000, f * bright) * (0.55 + 0.45 * vel)) / f);
  const specs: LayerSpec[] = [
    { shape, cut: floor, pts: pluckEnv(vel * 0.6, decay) },
    { shape, cut: Math.sqrt(top * floor), pts: pluckEnv(vel * 0.4, decay * 0.5) },
    { shape, cut: top, pts: pluckEnv(vel * 0.3, decay * 0.22) },
  ];
  play(loop, out, ['pluck', o.note, decay, shape, bright, floor, vel, detune, spread].join(':'), o.t, f, specs, 1, o.pan ?? 0, detune, spread);
}

export interface SynthNoteOpts extends NoteOpts {
  dur: number;
  shape?: Shape;
  /** Attack / decay / sustain (fraction of peak) / release of the amplitude. */
  a?: number;
  d?: number;
  s?: number;
  rel?: number;
  /** Resting brightness in Hz, how far above it the attack opens (multiplier) and how fast it closes. */
  cutoff?: number;
  envAmt?: number;
  envTime?: number;
  detune?: number;
  spread?: number;
  /** Level of a centred sine one octave below (0 = none). */
  sub?: number;
}

/** General sustained voice with a "filter envelope": bass lines, leads. */
export function synthNote(loop: Loop, out: AudioNode, o: SynthNoteOpts): void {
  const vel = o.vel ?? 0.8;
  const f = mtof(o.note);
  const rel = o.rel ?? 0.06;
  const a = o.a ?? 0.004;
  const d = o.d ?? 0.2;
  const s = o.s ?? 0.7;
  const shape = o.shape ?? 'saw';
  const cutoff = o.cutoff ?? 1200;
  const amt = o.envAmt ?? 1;
  const envTime = o.envTime ?? 0.18;
  const detune = o.detune ?? 0;
  const spread = o.spread ?? 0.5;
  const sub = o.sub ?? 0;
  const cut = Math.max(1, cutoff / f);
  const specs: LayerSpec[] = [{ shape, cut, pts: noteEnv(vel * 0.8, a, d, s, o.dur, rel) }];
  if (amt > 1) specs.push({ shape, cut: cut * amt * (0.5 + 0.5 * vel), pts: pluckEnv(vel * 0.5, Math.min(envTime, Math.max(0.03, o.dur + rel - a - 0.01)), a) });
  if (sub) specs.push({ shape: 'sine', ratio: 0.5, pts: noteEnv(vel * sub, Math.max(a, 0.006), d, Math.max(s, 0.8), o.dur, rel), centre: true });
  const key = ['synth', o.note, o.dur.toFixed(4), shape, vel, a, d, s, rel, cutoff, amt, envTime, detune, spread, sub].join(':');
  play(loop, out, key, o.t, f, specs, 1, o.pan ?? 0, detune, spread);
}

export interface SubOpts extends NoteOpts {
  dur: number;
  rel?: number;
  /** Extra harmonics so the bass stays audible on small speakers (0..1). */
  grit?: number;
}

/** Round sub bass with a few soft harmonics. */
export function subNote(loop: Loop, out: AudioNode, o: SubOpts): void {
  const grit = o.grit ?? 0.5;
  const rel = o.rel ?? 0.08;
  const specs: LayerSpec[] = [{ shape: 'sine', harmonics: [1, 0.4 * grit, 0.16 * grit, 0.06 * grit], pts: noteEnv(1, 0.008, 0.25, 0.8, o.dur, rel) }];
  play(loop, out, ['sub', o.note, o.dur.toFixed(4), rel, grit].join(':'), o.t, mtof(o.note), specs, o.vel ?? 0.8, o.pan ?? 0);
}

/** [frequency ratio, amplitude, decay multiplier] */
type Partial3 = readonly [number, number, number];

const BELL_PARTIALS: readonly Partial3[] = [
  [1, 1, 1],
  [2, 0.28, 0.55],
  [3, 0.1, 0.35],
  [4.2, 0.04, 0.2],
];

export interface BellNoteOpts extends NoteOpts {
  /** Time for the fundamental to fall by 60 dB (s). */
  decay?: number;
  partials?: readonly Partial3[];
}

/** Additive bell / glockenspiel / music-box note. */
export function bellNote(loop: Loop, out: AudioNode, o: BellNoteOpts): void {
  const f = mtof(o.note);
  const decay = o.decay ?? 1.2;
  const partials = o.partials ?? BELL_PARTIALS;
  const specs: LayerSpec[] = [];
  for (const [ratio, amp, dk] of partials) {
    if (f * ratio < 15000) specs.push({ shape: 'sine', ratio, pts: pluckEnv(amp, decay * dk, 0.003) });
  }
  play(loop, out, ['bell', o.note, decay, partials.map((p) => p.join('/')).join(',')].join(':'), o.t, f, specs, o.vel ?? 0.8, o.pan ?? 0);
}

export interface StringNoteOpts extends NoteOpts {
  /** Time to fall by 60 dB (s). */
  decay?: number;
  /** Brightness of the pluck (1 = default). */
  bright?: number;
}

/** Plucked acoustic string (guitar / ukulele / harp feel): the upper harmonics die away first. */
export function stringNote(loop: Loop, out: AudioNode, o: StringNoteOpts): void {
  const vel = o.vel ?? 0.8;
  const f = mtof(o.note);
  const decay = o.decay ?? 1.4;
  const bright = o.bright ?? 1;
  const top = Math.max(3, Math.min(40, (5200 * bright * (0.6 + 0.4 * vel)) / f));
  const specs: LayerSpec[] = [
    { shape: 'string', cut: 2, pts: pluckEnv(vel * 0.62, decay, 0.0015) },
    { shape: 'string', cut: Math.sqrt(top * 2), pts: pluckEnv(vel * 0.36, decay * 0.4, 0.0015) },
    { shape: 'string', cut: top, slope: 1.5, pts: pluckEnv(vel * 0.3, decay * 0.12, 0.0012) },
  ];
  play(loop, out, ['string', o.note, decay, bright, vel].join(':'), o.t, f, specs, 1, o.pan ?? 0);
}

export interface ChordOpts {
  t: number;
  /** MIDI notes of the chord. */
  notes: readonly number[];
  /** Time until the release starts (s). */
  dur: number;
  vel?: number;
  a?: number;
  r?: number;
  shape?: Shape;
  /** Brightness of the body in Hz. */
  cutoff?: number;
  /** Optional brighter layer: its brightness in Hz and its gain envelope (relative to the start, 0..1). */
  brightCut?: number;
  brightEnv?: readonly Pt[];
  /** Detune of the left / right oscillator of each note, in cents. */
  detune?: number;
  spread?: number;
}

/** Baked chord stab: every note is a detuned left/right pair; the whole chord is one buffer. */
export function stabChord(loop: Loop, out: AudioNode, o: ChordOpts): void {
  const a = o.a ?? 0.01;
  const r = o.r ?? 0.1;
  const detune = o.detune ?? 8;
  const spread = o.spread ?? 0.75;
  const shape = o.shape ?? 'saw';
  const cutoff = o.cutoff ?? 1800;
  const brightCut = o.brightCut ?? 5000;
  const dur = Math.max(o.dur, a);
  const per = 1 / Math.sqrt(o.notes.length);
  const body: Pt[] = [
    [0, 0],
    [a, per],
    [dur, per],
    [dur + r, 0],
  ];
  const bright = o.brightEnv ? o.brightEnv.map(([time, value, curve]) => [time, value * per, curve] as const) : null;
  const key = ['stab', o.notes.join(','), dur.toFixed(4), a, r, shape, cutoff, brightCut, detune, spread, bright ? bright.map((p) => p.join('/')).join(',') : ''].join(':');
  const buffer = cached(loop.ctx, key, () => {
    const layers: BakeLayer[] = [];
    for (const n of o.notes) {
      const f = mtof(n);
      layers.push(toLayer(f, { shape, cut: Math.max(1, cutoff / f), pts: body }));
      if (bright) layers.push(toLayer(f, { shape, cut: Math.max(1, brightCut / f), pts: bright }));
    }
    return bakeLayers(loop.ctx, layers, { detune, spread });
  });
  loop.hit(buffer, o.t, o.vel ?? 0.8, out);
}

// ---------------------------------------------------------------------------------------------
// Oscillator pads: long, few, and phase-locked so they can sustain across the loop point
// ---------------------------------------------------------------------------------------------

/** Periodic wave for `shape` at brightness `cut` (harmonic number). */
export function shaped(ctx: Ctx, shape: Shape, cut: number, slope = 2): PeriodicWave {
  return wave(ctx, harmonicsOf(shape, cut, slope));
}

/**
 * Stereo pad: every note is a detuned left/right oscillator pair. With `a` = `r` and chords placed
 * back to back, consecutive chords cross-fade — also across the loop point.
 */
export function padChord(loop: Loop, out: AudioNode, o: ChordOpts): void {
  const vel = o.vel ?? 0.8;
  const a = o.a ?? 0.4;
  const r = o.r ?? 0.6;
  const detune = o.detune ?? 8;
  const spread = o.spread ?? 0.75;
  const shape = o.shape ?? 'saw';
  const per = vel / Math.sqrt(o.notes.length);
  const dur = Math.max(o.dur, a);
  const bodyPts: Pt[] = [
    [0, 0],
    [a, per],
    [dur, per],
    [dur + r, 0],
  ];
  const brightPts = o.brightEnv ? o.brightEnv.map(([time, value, curve]) => [time, value * per, curve] as const) : null;
  const len = Math.max(dur + r, brightPts ? endOf(brightPts) : 0) + 0.004;
  loop.voice(o.t, len, (v) => {
    for (const side of [-1, 1]) {
      const body = vca(loop.ctx, 0);
      v.env(body.gain, bodyPts);
      v.send(body, out, side * spread);
      let bright: GainNode | null = null;
      if (brightPts) {
        bright = vca(loop.ctx, 0);
        v.env(bright.gain, brightPts);
        v.send(bright, out, side * spread);
      }
      for (const n of o.notes) {
        const f = mtof(n);
        v.osc(shaped(loop.ctx, shape, Math.max(1, (o.cutoff ?? 1800) / f)), f, side * detune, dur + r + 0.002).connect(body);
        if (bright && brightPts) v.osc(shaped(loop.ctx, shape, Math.max(1, (o.brightCut ?? 5000) / f)), f, side * detune, endOf(brightPts) + 0.002).connect(bright);
      }
    }
  });
}
