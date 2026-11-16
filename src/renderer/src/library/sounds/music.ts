import { seededRandom } from '@/core/easing';
import type { SoundDef } from '../types';
import { clapBuf, coefs, crackleBed, hatBuf, kickBuf, percBuf, rimBuf, shakerBuf, snareBuf, stereoNoise, toBuffer } from './lib/dsp';
import { Loop, bellNote, keys, loopLength, padChord, pluckNote, stabChord, stringNote, subNote, synthNote } from './lib/loop';
import { deterministic, midi, type Ctx } from './lib/synth';

/**
 * Music beds: seamless loops of a whole number of 4/4 bars. See `lib/loop.ts` for how the loop
 * point is kept click-free without fades (everything that rings past the end wraps to the start).
 */
function bed(id: string, name: string, bpm: number, bars: number, swing: number, keywords: string[], level: number, build: (loop: Loop, ctx: Ctx) => void): SoundDef {
  return {
    id,
    name,
    category: 'music',
    duration: loopLength(bpm, bars),
    bpm,
    loop: true,
    keywords,
    render: (ctx, dest) =>
      deterministic(ctx, () => {
        const loop = new Loop(ctx, dest, { bpm, bars, level, swing });
        build(loop, ctx);
        loop.finish();
      }),
  };
}

const VELOCITY: Record<string, number> = { X: 1, x: 0.78, o: 0.42, '-': 0.22 };

/**
 * Play a drum pattern starting at `bar`. 16 characters per bar; `X` accent, `x` hit, `o` soft,
 * `-` ghost, anything else rest. Spaces and `|` are ignored.
 */
function drums(loop: Loop, buffer: AudioBuffer, pattern: string, gain: number, out?: AudioNode, pan = 0, bar = 0): void {
  const clean = pattern.replace(/[\s|]/g, '');
  for (let i = 0; i < clean.length; i++) {
    const vel = VELOCITY[clean[i]];
    if (vel) loop.hit(buffer, loop.at(bar * 16 + i), gain * vel, out, pan);
  }
}

/** Repeat a pattern (one or more whole bars) through the entire loop. */
function drumsAll(loop: Loop, buffer: AudioBuffer, pattern: string, gain: number, out?: AudioNode, pan = 0): void {
  const bars = Math.round(pattern.replace(/[\s|]/g, '').length / 16);
  for (let bar = 0; bar < loop.bars; bar += bars) drums(loop, buffer, pattern, gain, out, pan, bar);
}

const notes = (names: string): number[] => names.split(' ').map(midi);

/** [bar, 16th step, note name, length in 16ths, velocity] */
type Ev = readonly [bar: number, step: number, note: string, len?: number, vel?: number];

const sounds: SoundDef[] = [
  // -------------------------------------------------------------------------------------------
  bed('music-lofi-chill', 'Lo-Fi Chill', 80, 4, 0.28, ['lofi', 'chill', 'study', 'relax', 'mellow', 'beat', 'hip hop'], 0.672, (loop, ctx) => {
    const kick = kickBuf(ctx, { f0: 115, f1: 47, sweep: 0.045, decay: 0.17, click: 0.06, drive: 1.3, tone: 2600 });
    const snare = snareBuf(ctx, { tone: 172, toneMix: 0.42, noiseDecay: 0.085, hp: 800, lp: 6000, room: 0.22, roomDecay: 0.1 });
    const hat = hatBuf(ctx, { decay: 0.02, hp: 5500, lp: 9500, metal: 0.25 });
    drums(loop, kick, 'x.....o...x.....|x.....o..xx.....|x.....o...x.....|x......x..x..o..', 0.75);
    drumsAll(loop, snare, '....x.......x...', 0.5);
    drumsAll(loop, hat, 'x.xox.x.x.xox.x.', 0.2, undefined, 0.25);
    drums(loop, rimBuf(ctx), '...............o', 0.3, undefined, -0.3, 1);
    drums(loop, rimBuf(ctx), '.............o.o', 0.3, undefined, -0.3, 3);
    // Dust and crackle, baked as one seamless loop-length buffer.
    const n = Math.round(loop.len * ctx.sampleRate);
    loop.bed(toBuffer(ctx, crackleBed(ctx.sampleRate, n, 2101, { ticks: 9, pops: 0.4 })), 0.08);

    const keysBus = loop.bus(0.5);
    const bassBus = loop.bus(0.3);
    const leadBus = loop.bus(0.42);
    const prog = [
      { bass: 'D2', chord: 'F3 A3 C4 E4' },
      { bass: 'G1', chord: 'F3 A3 B3 E4' },
      { bass: 'C2', chord: 'E3 G3 B3 D4' },
      { bass: 'A1', chord: 'G3 A3 C#4 F4' },
    ];
    prog.forEach((p, bar) => {
      const chord = notes(p.chord);
      chord.forEach((note, i) => {
        const pan = (i - 1.5) * 0.14;
        // A slow roll through the chord, an answer on the "and" of two, and a light push on four.
        keys(loop, keysBus, { t: loop.pos(bar) + i * 0.014, note, dur: loop.beat * 1.35, vel: 0.62, rel: 0.5, detune: 7, bright: 0.7, pan });
        keys(loop, keysBus, { t: loop.pos(bar, 1, 3) + i * 0.01, note, dur: loop.beat * 0.9, vel: 0.42, rel: 0.4, detune: 7, bright: 0.6, pan });
        if (i >= 2) keys(loop, keysBus, { t: loop.pos(bar, 3), note, dur: loop.beat * 0.7, vel: 0.36, rel: 0.4, detune: 7, bright: 0.6, pan });
      });
      subNote(loop, bassBus, { t: loop.pos(bar), note: midi(p.bass), dur: loop.beat * 1.4, vel: 0.8 });
      subNote(loop, bassBus, { t: loop.pos(bar, 2, 2), note: midi(p.bass), dur: loop.beat * 0.9, vel: 0.62 });
    });
    const melody: Ev[] = [
      [0, 4, 'A4'], [0, 7, 'C5'], [0, 10, 'D5'], [0, 14, 'E5'],
      [1, 2, 'D5'], [1, 6, 'B4'], [1, 10, 'G4'],
      [2, 4, 'G4'], [2, 7, 'B4'], [2, 10, 'D5'], [2, 14, 'E5'],
      [3, 2, 'F5'], [3, 6, 'E5'], [3, 10, 'C#5'], [3, 13, 'A4'],
    ];
    const mellow = [[1, 1, 1], [2, 0.12, 0.5], [3, 0.04, 0.3]] as const;
    for (const [bar, step, name] of melody) {
      const t = loop.pos(bar, 0, step);
      bellNote(loop, leadBus, { t, note: midi(name), decay: 0.9, vel: 0.5, partials: mellow, pan: -0.15 });
      bellNote(loop, leadBus, { t: t + loop.step * 3, note: midi(name), decay: 0.7, vel: 0.17, partials: mellow, pan: 0.4 });
    }
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-upbeat-pop', 'Upbeat Pop', 120, 8, 0, ['pop', 'upbeat', 'happy', 'energetic', 'bright', 'dance', 'fun'], 0.47, (loop, ctx) => {
    const kick = kickBuf(ctx, { f0: 165, f1: 50, sweep: 0.03, decay: 0.15, click: 0.25, drive: 1.6 });
    const clap = clapBuf(ctx, { decay: 0.08 });
    const snare = snareBuf(ctx, { tone: 200, noiseDecay: 0.07, room: 0.2 });
    drumsAll(loop, kick, 'X...x...x...x...|X...x...x...x...|X...x...x...x...|X...x...x...x.x.', 0.75);
    drumsAll(loop, clap, '....x.......x...', 0.42);
    drumsAll(loop, snare, '....x.......x...', 0.28);
    drumsAll(loop, hatBuf(ctx, { decay: 0.045, hp: 6500 }), '..x...x...x...x.', 0.2, undefined, 0.2);
    drumsAll(loop, shakerBuf(ctx), 'x-o-x-o-x-o-x-o-', 0.09, undefined, -0.3);
    const crash = hatBuf(ctx, { decay: 0.45, hp: 4800, metal: 0.5, attack: 0.002 });
    loop.hit(crash, loop.pos(0), 0.2);
    loop.hit(crash, loop.pos(4), 0.16);

    const bassBus = loop.bus(0.3);
    const stabBus = loop.bus(0.36);
    const padBus = loop.bus(0.26);
    const leadBus = loop.bus(0.4);
    const prog = [
      { bass: 'C2', stab: 'C4 E4 G4', pad: 'C3 G3 E4' },
      { bass: 'G1', stab: 'B3 D4 G4', pad: 'G2 D3 B3' },
      { bass: 'A1', stab: 'C4 E4 A4', pad: 'A2 E3 C4' },
      { bass: 'F1', stab: 'C4 F4 A4', pad: 'F2 C3 A3' },
    ];
    for (let bar = 0; bar < 8; bar++) {
      const p = prog[bar % 4];
      const root = midi(p.bass);
      // Driving eighths with an octave bounce.
      for (let i = 0; i < 8; i++) {
        const up = i === 3 || i === 7;
        synthNote(loop, bassBus, { t: loop.pos(bar, 0, i * 2), note: root + (up ? 12 : 0), dur: loop.step * 1.5, vel: i % 2 ? 0.7 : 0.9, cutoff: 420, envAmt: 3.5, envTime: 0.12, s: 0.6 });
      }
      for (const step of [0, 3, 6, 10, 13]) {
        notes(p.stab).forEach((note, i) => pluckNote(loop, stabBus, { t: loop.pos(bar, 0, step), note, decay: 0.3, bright: 7, vel: step === 0 ? 0.85 : 0.65, detune: 8, spread: 0.55, pan: (i - 1) * 0.1 }));
      }
      padChord(loop, padBus, { t: loop.pos(bar) - 0.15, notes: notes(p.pad), dur: loop.bar, a: 0.3, r: 0.3, cutoff: 1500, vel: 0.8 });
    }
    const melody: Ev[] = [
      [0, 0, 'E5'], [0, 3, 'G5'], [0, 6, 'A5'], [0, 8, 'G5'], [0, 11, 'E5'], [0, 14, 'D5'],
      [1, 0, 'D5'], [1, 3, 'G5'], [1, 6, 'B5'], [1, 8, 'A5'], [1, 12, 'G5'],
      [2, 0, 'A5'], [2, 3, 'C6'], [2, 6, 'A5'], [2, 8, 'G5'], [2, 11, 'E5'], [2, 14, 'G5'],
      [3, 0, 'A5'], [3, 3, 'F5'], [3, 6, 'A5'], [3, 8, 'C6'], [3, 12, 'A5'],
      [4, 0, 'E5'], [4, 3, 'G5'], [4, 6, 'C6'], [4, 8, 'E6'], [4, 11, 'D6'], [4, 14, 'C6'],
      [5, 0, 'B5'], [5, 3, 'D6'], [5, 6, 'B5'], [5, 8, 'G5'], [5, 12, 'D5'],
      [6, 0, 'C6'], [6, 3, 'A5'], [6, 6, 'E5'], [6, 8, 'A5'], [6, 11, 'C6'], [6, 14, 'E6'],
      [7, 0, 'F6'], [7, 3, 'E6'], [7, 6, 'C6'], [7, 8, 'A5'], [7, 12, 'G5'],
    ];
    for (const [bar, step, name] of melody) {
      const t = loop.pos(bar, 0, step);
      pluckNote(loop, leadBus, { t, note: midi(name), shape: 'square', decay: 0.5, bright: 5, floor: 2, vel: 0.8 });
      pluckNote(loop, leadBus, { t: t + loop.step * 3, note: midi(name), shape: 'square', decay: 0.35, bright: 3, vel: 0.26, pan: 0.5 });
      pluckNote(loop, leadBus, { t: t + loop.step * 6, note: midi(name), shape: 'square', decay: 0.3, bright: 2.5, vel: 0.12, pan: -0.5 });
    }
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-corporate-inspire', 'Corporate Inspire', 120, 8, 0, ['corporate', 'inspiring', 'uplifting', 'business', 'motivational', 'presentation', 'positive'], 0.642, (loop, ctx) => {
    const kick = kickBuf(ctx, { f0: 140, f1: 50, sweep: 0.035, decay: 0.14, click: 0.12, drive: 1.3, tone: 5000 });
    const clap = clapBuf(ctx, { decay: 0.06, f: 1500 });
    const shaker = shakerBuf(ctx);
    drums(loop, kick, 'x.......x.....x.|x.......x.......|x.......x.....x.|x.......x.....o.', 0.62);
    drums(loop, kick, 'x...x...x...x...|x...x...x...x...|x...x...x...x...|x...x...x...x.x.', 0.7, undefined, 0, 4);
    drumsAll(loop, clap, '....x.......x...', 0.26);
    drums(loop, shaker, 'x...x...x...x...|x...x...x...x...|x...x...x...x...|x...x...x...x...', 0.07, undefined, -0.3);
    drums(loop, shaker, 'x-o-x-o-x-o-x-o-|x-o-x-o-x-o-x-o-|x-o-x-o-x-o-x-o-|x-o-x-o-x-o-x-o-', 0.09, undefined, -0.3, 4);
    drums(loop, hatBuf(ctx, { decay: 0.03 }), '..x...x...x...x.|..x...x...x...x.|..x...x...x...x.|..x...x...x.x.x.', 0.1, undefined, 0.3, 4);

    const pluckBus = loop.bus(0.5);
    const padBus = loop.bus(0.32);
    const keysBus = loop.bus(0.34);
    const bassBus = loop.bus(0.27);
    const bellBus = loop.bus(0.32);
    const prog = [
      { bass: 'D2', riff: 'D4 A4 F#4 A4 D5 A4 F#4 A4', pad: 'D3 A3 E4 F#4', keys: 'F#3 A3 D4' },
      { bass: 'A1', riff: 'C#4 A4 E4 A4 C#5 A4 E4 A4', pad: 'C#3 A3 C#4 E4', keys: 'E3 A3 C#4' },
      { bass: 'B1', riff: 'D4 B4 F#4 B4 D5 B4 F#4 B4', pad: 'B2 F#3 B3 D4', keys: 'F#3 B3 D4' },
      { bass: 'G1', riff: 'D4 B4 G4 B4 D5 B4 G4 B4', pad: 'B2 G3 B3 D4', keys: 'G3 B3 D4' },
    ];
    for (let bar = 0; bar < 8; bar++) {
      const p = prog[bar >> 1];
      // Muted eighth-note ostinato with dotted-eighth echoes bouncing left and right.
      notes(p.riff).forEach((note, i) => {
        const t = loop.pos(bar, 0, i * 2);
        const vel = i % 4 === 0 ? 0.85 : i % 2 === 0 ? 0.7 : 0.58;
        pluckNote(loop, pluckBus, { t, note, decay: 0.2, bright: 4.5, floor: 1.2, vel });
        pluckNote(loop, pluckBus, { t: t + loop.step * 3, note, decay: 0.17, bright: 3, vel: vel * 0.4, pan: 0.55 });
        pluckNote(loop, pluckBus, { t: t + loop.step * 6, note, decay: 0.15, bright: 2.2, vel: vel * 0.2, pan: -0.55 });
      });
      const root = midi(p.bass);
      subNote(loop, bassBus, { t: loop.pos(bar), note: root, dur: loop.step * 5, vel: 0.8, grit: 0.7 });
      subNote(loop, bassBus, { t: loop.pos(bar, 1, 2), note: root, dur: loop.step * 1.5, vel: 0.6, grit: 0.7 });
      subNote(loop, bassBus, { t: loop.pos(bar, 2), note: root, dur: loop.step * 5, vel: 0.75, grit: 0.7 });
      if (bar % 2 === 0) {
        padChord(loop, padBus, { t: loop.pos(bar) - 0.25, notes: notes(p.pad), dur: loop.bar * 2, a: 0.5, r: 0.5, cutoff: 1300, vel: 0.8, brightCut: 3600, brightEnv: [[0, 0], [loop.bar * 1.4, 0.35], [loop.bar * 2 + 0.5, 0]] });
        notes(p.keys).forEach((note, i) => keys(loop, keysBus, { t: loop.pos(bar) + i * 0.01, note, dur: loop.beat * 2.5, vel: 0.6, rel: 0.6, bright: 1.2, pan: (i - 1) * 0.2 }));
      }
    }
    const bells: Ev[] = [
      [1, 8, 'A5'], [1, 12, 'F#5'], [3, 8, 'E5'], [3, 12, 'A5'],
      [4, 0, 'F#5'], [4, 6, 'B5'], [4, 12, 'D6'], [5, 4, 'C#6'], [5, 8, 'B5'], [5, 14, 'F#5'],
      [6, 0, 'G5'], [6, 6, 'B5'], [6, 12, 'D6'], [7, 4, 'E6'], [7, 8, 'D6'], [7, 12, 'A5'],
    ];
    for (const [bar, step, name] of bells) bellNote(loop, bellBus, { t: loop.pos(bar, 0, step), note: midi(name), decay: 1.3, vel: 0.6, pan: step % 4 ? 0.3 : -0.3 });
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-cinematic-pad', 'Cinematic Pad', 60, 4, 0, ['cinematic', 'pad', 'emotional', 'film', 'atmospheric', 'dramatic', 'slow'], 0.63, (loop, ctx) => {
    const padBus = loop.bus(0.42);
    const harpBus = loop.bus(0.34);
    const bassBus = loop.bus(0.22);
    const prog = [
      { bass: 'D2', pad: 'D3 A3 D4 F4 A4', harp: 'D5 F5 A5 D6 A5 F5' },
      { bass: 'A#1', pad: 'A#2 F3 A#3 D4 F4', harp: 'D5 F5 A#5 D6 A#5 F5' },
      { bass: 'F1', pad: 'F3 A3 C4 F4 A4', harp: 'C5 F5 A5 C6 A5 F5' },
      { bass: 'C2', pad: 'C3 G3 C4 E4 G4', harp: 'C5 E5 G5 C6 G5 E5' },
    ];
    prog.forEach((p, bar) => {
      // Each chord fades in across the bar line while the previous one fades out.
      padChord(loop, padBus, {
        t: loop.pos(bar) - 0.8, notes: notes(p.pad), dur: loop.bar, a: 1.6, r: 1.6, cutoff: 1100, vel: 0.8, detune: 9,
        brightCut: 3800, brightEnv: [[0, 0], [2.6, 0.5], [5.6, 0]],
      });
      subNote(loop, bassBus, { t: loop.pos(bar), note: midi(p.bass), dur: loop.bar - 0.7, rel: 0.6, vel: 0.7, grit: 0.6 });
      notes(p.harp).forEach((note, i) => {
        const t = loop.pos(bar, 1, i * 2);
        stringNote(loop, harpBus, { t, note, decay: 2.4, vel: 0.6 - (i % 3) * 0.06, pan: i % 2 ? 0.35 : -0.35 });
        stringNote(loop, harpBus, { t: t + loop.step * 3, note, decay: 1.8, vel: 0.2, bright: 0.6, pan: i % 2 ? -0.5 : 0.5 });
      });
    });
    // Deep, soft hits on bars one and three.
    const boom = kickBuf(ctx, { f0: 90, f1: 38, sweep: 0.06, decay: 0.5, click: 0.04, drive: 1.2, tone: 1200, len: 1.9 });
    const drum = percBuf(ctx, { f: 62, bend: 0.5, decay: 0.45, slap: 0.12, len: 1.6 });
    loop.hit(boom, loop.pos(0), 0.5);
    loop.hit(drum, loop.pos(0), 0.3);
    loop.hit(boom, loop.pos(2), 0.36);
    loop.hit(drum, loop.pos(2), 0.2);
    for (const [bar, name] of [[0, 'A6'], [1, 'F6'], [2, 'C7'], [3, 'G6']] as const) bellNote(loop, harpBus, { t: loop.pos(bar, 2), note: midi(name), decay: 3.2, vel: 0.22, pan: bar % 2 ? 0.5 : -0.5 });
    const n = Math.round(loop.len * ctx.sampleRate);
    loop.bed(toBuffer(ctx, stereoNoise(n, 2401, [coefs('bandpass', ctx.sampleRate, 2500, 0.3), coefs('lowpass', ctx.sampleRate, 6000, 0.6)], 0.006)), 1);
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-synthwave-drive', 'Synthwave Drive', 100, 4, 0, ['synthwave', 'retro', '80s', 'retrowave', 'neon', 'drive', 'synth'], 0.504, (loop, ctx) => {
    const kick = kickBuf(ctx, { f0: 170, f1: 52, sweep: 0.028, decay: 0.14, click: 0.3, drive: 1.8 });
    const snare = snareBuf(ctx, { tone: 190, toneMix: 0.45, noiseDecay: 0.09, hp: 700, lp: 9000, room: 0.9, roomDecay: 0.3, gate: 0.17 });
    drumsAll(loop, kick, 'X...x...x...x...', 0.75);
    drumsAll(loop, snare, '....x.......x...', 0.55);
    drumsAll(loop, hatBuf(ctx, { decay: 0.018 }), 'x.-ox.-ox.-ox.-o', 0.12, undefined, 0.25);
    drumsAll(loop, hatBuf(ctx, { decay: 0.08, hp: 6500 }), '..x...x...x...x.', 0.12, undefined, -0.2);
    // Tom fill into the loop point.
    loop.hit(percBuf(ctx, { f: 185, decay: 0.11, slap: 0.2 }), loop.pos(3, 3, 0), 0.4, undefined, -0.4);
    loop.hit(percBuf(ctx, { f: 185, decay: 0.11, slap: 0.2 }), loop.pos(3, 3, 1), 0.32, undefined, -0.4);
    loop.hit(percBuf(ctx, { f: 140, decay: 0.13, slap: 0.2 }), loop.pos(3, 3, 2), 0.42, undefined, 0);
    loop.hit(percBuf(ctx, { f: 104, decay: 0.16, slap: 0.2 }), loop.pos(3, 3, 3), 0.45, undefined, 0.4);

    const pumped = loop.bus(1);
    const beats: number[] = [];
    for (let i = 0; i < 16; i++) beats.push(i * loop.beat);
    loop.pump(pumped.gain, beats, 0.45, loop.beat * 0.92);
    const bassBus = loop.bus(0.3, 0, pumped);
    const padBus = loop.bus(0.26, 0, pumped);
    const arpBus = loop.bus(0.36);
    const leadBus = loop.bus(0.32);
    const prog = [
      { bass: 'A1', arp: 'A3 C4 E4 A4 C5 E5 C5 A4', pad: 'A3 C4 E4' },
      { bass: 'F1', arp: 'F3 A3 C4 F4 A4 C5 A4 F4', pad: 'A3 C4 F4' },
      { bass: 'C2', arp: 'C4 E4 G4 C5 E5 G5 E5 C5', pad: 'G3 C4 E4' },
      { bass: 'G1', arp: 'G3 B3 D4 G4 B4 D5 B4 G4', pad: 'G3 B3 D4' },
    ];
    prog.forEach((p, bar) => {
      const root = midi(p.bass);
      const arp = notes(p.arp);
      for (let i = 0; i < 16; i++) {
        const t = loop.pos(bar, 0, i);
        // Rolling sixteenth-note bass, octave jump on the off-beats.
        synthNote(loop, bassBus, { t, note: root + (i % 4 === 2 ? 12 : 0), dur: loop.step * 0.7, vel: [1, 0.6, 0.8, 0.6][i % 4], cutoff: 360, envAmt: 4.5, envTime: 0.1, s: 0.5 });
        const note = arp[i % 8];
        pluckNote(loop, arpBus, { t, note, decay: 0.24, bright: 9, vel: i % 2 ? 0.55 : 0.7, detune: 9, spread: 0.45 });
        pluckNote(loop, arpBus, { t: t + loop.step * 3, note, decay: 0.2, bright: 4, vel: 0.2, pan: i % 2 ? 0.6 : -0.6 });
      }
      padChord(loop, padBus, { t: loop.pos(bar) - 0.08, notes: notes(p.pad), dur: loop.bar, a: 0.16, r: 0.3, cutoff: 2200, vel: 0.8, detune: 11 });
    });
    const lead: Ev[] = [
      [0, 0, 'E5', 6], [0, 6, 'D5', 2], [0, 8, 'C5', 4], [0, 12, 'E5', 4],
      [1, 0, 'F5', 6], [1, 6, 'E5', 2], [1, 8, 'C5', 6], [1, 14, 'A4', 2],
      [2, 0, 'G5', 6], [2, 6, 'E5', 2], [2, 8, 'C5', 4], [2, 12, 'E5', 4],
      [3, 0, 'D5', 6], [3, 6, 'B4', 2], [3, 8, 'G4', 4], [3, 12, 'B4', 2], [3, 14, 'D5', 2],
    ];
    for (const [bar, step, name, len = 2] of lead) {
      synthNote(loop, leadBus, { t: loop.pos(bar, 0, step), note: midi(name), dur: loop.step * len * 0.9, shape: 'square', vel: 0.8, a: 0.012, d: 0.3, s: 0.7, rel: 0.16, cutoff: 2200, envAmt: 2.2, detune: 8, spread: 0.3 });
    }
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-deep-house', 'Deep House Groove', 120, 8, 0, ['house', 'deep house', 'groove', 'club', 'dance', 'electronic', 'night'], 0.682, (loop, ctx) => {
    const kick = kickBuf(ctx, { f0: 150, f1: 48, sweep: 0.04, hold: 0.02, decay: 0.19, click: 0.15, drive: 1.7, tone: 6000 });
    drumsAll(loop, kick, 'X...x...x...x...', 0.78);
    drumsAll(loop, clapBuf(ctx, { decay: 0.09, f: 1150 }), '....x.......x...', 0.4);
    drumsAll(loop, hatBuf(ctx, { decay: 0.07, hp: 6800 }), '..x...x...x...x.', 0.2, undefined, 0.15);
    drumsAll(loop, hatBuf(ctx, { decay: 0.016 }), 'o.-.o.-oo.-.o.-o', 0.1, undefined, -0.25);
    drumsAll(loop, shakerBuf(ctx, { decay: 0.02 }), '-o-x-o-x-o-x-o-x', 0.06, undefined, 0.35);
    drumsAll(loop, percBuf(ctx, { f: 330, decay: 0.06, slap: 0.3 }), '.....x.......o..|..x......x...x..', 0.14, undefined, -0.45);
    drums(loop, rimBuf(ctx), '.......x..x.....', 0.14, undefined, 0.4, 3);
    drums(loop, rimBuf(ctx), '.......x..x..x.x', 0.14, undefined, 0.4, 7);

    const pumped = loop.bus(1);
    const beats: number[] = [];
    for (let i = 0; i < 32; i++) beats.push(i * loop.beat);
    loop.pump(pumped.gain, beats, 0.5, loop.beat * 0.9);
    const stabBus = loop.bus(0.5, 0, pumped);
    const bassBus = loop.bus(0.3, 0, pumped);
    const bellBus = loop.bus(0.3);
    const prog = [
      { bass: 'C2', stab: 'D#3 G3 A#3 D4' },
      { bass: 'C2', stab: 'D#3 G3 A#3 D4' },
      { bass: 'G#1', stab: 'D#3 G3 G#3 C4' },
      { bass: 'A#1', stab: 'D3 F3 G3 C4' },
    ];
    for (let bar = 0; bar < 8; bar++) {
      const p = prog[bar % 4];
      // Off-beat chord stabs: a reedy organ body with a bright bite on the attack.
      [3, 6, 11, 14].forEach((step, i) => {
        stabChord(loop, stabBus, {
          t: loop.pos(bar, 0, step), notes: notes(p.stab), dur: loop.step * (i % 2 ? 1.6 : 1.1), a: 0.005, r: 0.12, shape: 'reed', cutoff: 1300, vel: i % 2 ? 0.8 : 0.65, detune: 6, spread: 0.6,
          brightCut: 4200, brightEnv: [[0, 0], [0.006, 0.7], [0.14, 0]],
        });
      });
      const root = midi(p.bass);
      for (const [step, len, up] of [[2, 1.6, 0], [6, 1.6, 0], [10, 1.6, 0], [14, 1.2, 0], [15, 0.8, 12]] as const) {
        if (up && bar % 2 === 0) continue;
        subNote(loop, bassBus, { t: loop.pos(bar, 0, step), note: root + up, dur: loop.step * len, vel: up ? 0.6 : 0.85, grit: 0.9, rel: 0.05 });
      }
    }
    const bells: Ev[] = [
      [1, 8, 'G5'], [1, 11, 'A#5'], [3, 8, 'C6'], [3, 12, 'G5'],
      [5, 8, 'D#5'], [5, 11, 'G5'], [5, 14, 'A#5'], [7, 8, 'D6'], [7, 12, 'C6'],
    ];
    for (const [bar, step, name] of bells) {
      const t = loop.pos(bar, 0, step);
      bellNote(loop, bellBus, { t, note: midi(name), decay: 1.1, vel: 0.6, pan: -0.2 });
      bellNote(loop, bellBus, { t: t + loop.step * 3, note: midi(name), decay: 0.9, vel: 0.25, pan: 0.5 });
      bellNote(loop, bellBus, { t: t + loop.step * 6, note: midi(name), decay: 0.8, vel: 0.11, pan: -0.5 });
    }
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-hiphop-beat', 'Hip-Hop Beat', 90, 4, 0.2, ['hip hop', 'beat', 'boom bap', 'rap', 'urban', 'trap', 'groove'], 0.57, (loop, ctx) => {
    const kick = kickBuf(ctx, { f0: 130, f1: 45, sweep: 0.05, hold: 0.02, decay: 0.22, click: 0.15, drive: 2, len: 0.75 });
    const snare = snareBuf(ctx, { tone: 180, toneMix: 0.45, noiseDecay: 0.1, hp: 1000, lp: 9000, room: 0.4, roomDecay: 0.14 });
    const hat = hatBuf(ctx, { decay: 0.018 });
    drums(loop, kick, 'X.......x.x.....|X......x..x.....|X.......x.x.....|X......x..x...o.', 0.8);
    drumsAll(loop, snare, '....x.......x...', 0.55);
    drumsAll(loop, clapBuf(ctx, { decay: 0.07 }), '....x.......x...', 0.2);
    drums(loop, hat, 'x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x...|x.x.x.x.x.x.x.x.|x.x.x.x.x.x.....', 0.15, undefined, 0.2);
    drums(loop, hatBuf(ctx, { decay: 0.09, hp: 6500 }), '......x.........', 0.13, undefined, 0.2, 1);
    drums(loop, hatBuf(ctx, { decay: 0.09, hp: 6500 }), '......x.........', 0.13, undefined, 0.2, 3);
    // Hat rolls: thirty-second notes at the end of bar two, triplets at the end of bar four.
    [0, 0.5, 1, 1.5].forEach((off, i) => loop.hit(hat, loop.at(16 + 14 + off), 0.08 + i * 0.025, undefined, 0.2));
    [0, 0.667, 1.333, 2, 2.667, 3.333].forEach((off, i) => loop.hit(hat, loop.step * (48 + 12 + off), 0.07 + i * 0.018, undefined, 0.2));
    const n = Math.round(loop.len * ctx.sampleRate);
    loop.bed(toBuffer(ctx, crackleBed(ctx.sampleRate, n, 2701, { ticks: 6, pops: 0.25 })), 0.04);

    const keysBus = loop.bus(0.46);
    const bassBus = loop.bus(0.34);
    const bellBus = loop.bus(0.3);
    const prog = [
      { bass: 'F1', chord: 'G#3 C4 D#4 G4', sub: [[0, 6], [8, 1.5], [10, 4.5]] },
      { bass: 'C#2', chord: 'G#3 C4 F4', sub: [[0, 6], [7, 2], [10, 4.5]] },
      { bass: 'A#1', chord: 'G#3 C4 C#4 F4', sub: [[0, 6], [8, 1.5], [10, 4.5]] },
      { bass: 'C2', chord: 'G3 A#3 C#4 E4', sub: [[0, 6], [7, 2], [10, 3], [14, 1.4]] },
    ];
    prog.forEach((p, bar) => {
      notes(p.chord).forEach((note, i) => {
        const pan = (i - 1.5) * 0.15;
        keys(loop, keysBus, { t: loop.pos(bar) + i * 0.012, note, dur: loop.beat * 2.2, vel: 0.62, rel: 0.5, detune: 6, bright: 0.55, pan });
        keys(loop, keysBus, { t: loop.pos(bar, 2, 2) + i * 0.01, note, dur: loop.beat * 0.8, vel: 0.4, rel: 0.4, detune: 6, bright: 0.5, pan });
      });
      for (const [step, len] of p.sub) subNote(loop, bassBus, { t: loop.pos(bar, 0, step), note: midi(p.bass), dur: loop.step * len, vel: step === 0 ? 0.9 : 0.72, grit: 0.75, rel: 0.07 });
    });
    const melody: Ev[] = [
      [0, 4, 'C6'], [0, 7, 'G#5'], [0, 10, 'G5'],
      [1, 4, 'F5'], [1, 10, 'G#5'],
      [2, 4, 'C#6'], [2, 7, 'A#5'], [2, 10, 'F5'],
      [3, 4, 'E5'], [3, 8, 'G5'], [3, 12, 'A#5'],
    ];
    const box = [[1, 1, 1], [2.76, 0.25, 0.4], [5.4, 0.08, 0.22]] as const;
    for (const [bar, step, name] of melody) {
      const t = loop.pos(bar, 0, step);
      bellNote(loop, bellBus, { t, note: midi(name), decay: 1.0, vel: 0.6, partials: box, pan: -0.25 });
      bellNote(loop, bellBus, { t: t + loop.step * 3, note: midi(name), decay: 0.8, vel: 0.22, partials: box, pan: 0.45 });
    }
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-ambient-drone', 'Ambient Drone', 60, 4, 0, ['ambient', 'drone', 'calm', 'meditation', 'space', 'background', 'atmosphere'], 0.756, (loop, ctx) => {
    const padBus = loop.bus(0.3);
    const bellBus = loop.bus(0.3);
    // Three long, overlapping swells; the last one carries across the loop point.
    const swells = [
      { t: 0, chord: 'D3 A3 E4', dur: 6 },
      { t: 5.5, chord: 'D3 F#3 A3 C#4', dur: 5.5 },
      { t: 10.5, chord: 'B2 F#3 D4 E4', dur: 5.5 },
    ];
    for (const s of swells) {
      padChord(loop, padBus, {
        t: s.t, notes: notes(s.chord), dur: s.dur, a: 4, r: 5, cutoff: 1100, vel: 0.8, detune: 10,
        brightCut: 2800, brightEnv: [[0, 0], [s.dur * 0.8, 0.45], [s.dur + 5, 0]],
      });
    }
    padChord(loop, padBus, { t: 6, notes: notes('D5 A5'), dur: 4, a: 3, r: 3, cutoff: 2500, vel: 0.22, detune: 6 });
    // The sub is two sines a fraction of a hertz apart, so it breathes exactly twice per loop.
    loop.voice(0, loop.len, (v) => {
      const f = loop.q(73.416);
      v.layer('sine', f, [[0, 0.09], [loop.len, 0.09]], loop.out);
      v.layer('sine', f + 2 / loop.len, [[0, 0.09], [loop.len, 0.09]], loop.out);
    });
    const rnd = seededRandom(2801);
    const scale = notes('D5 E5 F#5 A5 B5 D6 E6 F#6');
    for (let i = 0; i < 9; i++) {
      const t = (i * 16) / 9 + rnd() * 0.9;
      const note = scale[Math.floor(rnd() * scale.length)];
      const pan = (rnd() - 0.5) * 1.2;
      bellNote(loop, bellBus, { t, note, decay: 4, vel: 0.35 + rnd() * 0.3, pan });
      bellNote(loop, bellBus, { t: t + 0.75, note, decay: 3, vel: 0.14, pan: -pan });
    }
    const n = Math.round(loop.len * ctx.sampleRate);
    loop.bed(toBuffer(ctx, stereoNoise(n, 2803, [coefs('bandpass', ctx.sampleRate, 1800, 0.35), coefs('lowpass', ctx.sampleRate, 5000, 0.6)], 0.008)), 1);
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-funk-groove', 'Funk Groove', 100, 4, 0.1, ['funk', 'groove', 'funky', 'retro', 'bass', 'upbeat', 'disco'], 0.673, (loop, ctx) => {
    const kick = kickBuf(ctx, { f0: 170, f1: 55, sweep: 0.025, decay: 0.1, click: 0.3, drive: 1.5 });
    const snare = snareBuf(ctx, { tone: 210, toneMix: 0.4, noiseDecay: 0.06, hp: 1800, room: 0.25, roomDecay: 0.08 });
    drums(loop, kick, 'X..x......x..x..|X..x......x.....|X..x......x..x..|X..x...x..x.....', 0.75);
    drumsAll(loop, snare, '....X..-.-..X..-', 0.5);
    drums(loop, hatBuf(ctx, { decay: 0.016 }), 'xoxoxoxoxoxoxoxo|xoxoxoxoxoxoxo..|xoxoxoxoxoxoxoxo|xoxoxoxoxoxoxo..', 0.13, undefined, 0.25);
    drums(loop, hatBuf(ctx, { decay: 0.1, hp: 6500 }), '..............x.', 0.15, undefined, 0.25, 1);
    drums(loop, hatBuf(ctx, { decay: 0.1, hp: 6500 }), '..............x.', 0.15, undefined, 0.25, 3);
    drumsAll(loop, percBuf(ctx, { f: 330, decay: 0.07, slap: 0.3 }), '..x........x....', 0.2, undefined, -0.45);
    drumsAll(loop, percBuf(ctx, { f: 245, decay: 0.09, slap: 0.3 }), '......x.......o.', 0.2, undefined, 0.45);

    const bassBus = loop.bus(0.34);
    const clavBus = loop.bus(0.36, 0.25);
    const organBus = loop.bus(0.18);
    const hornBus = loop.bus(0.3);
    const eVamp: Ev[] = [[0, 0, 'E2', 2, 1], [0, 3, 'E2', 1, 0.7], [0, 6, 'G2', 1, 0.75], [0, 7, 'A2', 1.5, 0.8], [0, 10, 'E3', 1, 1], [0, 12, 'D3', 1.5, 0.8], [0, 14, 'B2', 1, 0.7], [0, 15, 'D3', 1, 0.75]];
    const eVamp2: Ev[] = [[0, 0, 'E2', 2, 1], [0, 3, 'E2', 1, 0.7], [0, 6, 'G2', 1, 0.75], [0, 7, 'A2', 1, 0.8], [0, 8, 'B2', 1.5, 0.8], [0, 10, 'E3', 1, 1], [0, 11, 'D3', 1, 0.7], [0, 14, 'A2', 1, 0.75], [0, 15, 'B2', 1, 0.75]];
    const aTurn: Ev[] = [[0, 0, 'A2', 2, 1], [0, 3, 'A2', 1, 0.7], [0, 6, 'C3', 1, 0.75], [0, 7, 'D3', 1.5, 0.8], [0, 10, 'A3', 1, 1], [0, 12, 'G3', 1.5, 0.8], [0, 14, 'E3', 1, 0.75], [0, 15, 'D3', 1, 0.75]];
    [eVamp, eVamp2, eVamp, aTurn].forEach((line, bar) => {
      for (const [, step, name, len = 1, vel = 0.8] of line) {
        synthNote(loop, bassBus, { t: loop.pos(bar, 0, step), note: midi(name), dur: loop.step * len * 0.8, shape: 'pulse', vel, cutoff: 480, envAmt: 5, envTime: 0.09, s: 0.5, rel: 0.04, sub: 0.35 });
      }
      // Clavinet-style sixteenth-note comping: accents ring, ghost strokes are choked.
      const chord = notes(bar === 3 ? 'G3 C#4 F#4' : 'G#3 D4 F#4');
      const comp = bar % 2 ? '..x-x.-x.-x.x-x.' : '..x-x..x-x..x-x-';
      for (let i = 0; i < 16; i++) {
        const vel = VELOCITY[comp[i]];
        if (!vel) continue;
        chord.forEach((note) => pluckNote(loop, clavBus, { t: loop.pos(bar, 0, i), note, shape: 'pulse', decay: vel > 0.5 ? 0.16 : 0.05, bright: 12, floor: 2, vel }));
      }
      padChord(loop, organBus, { t: loop.pos(bar) - 0.05, notes: notes(bar === 3 ? 'A3 C#4 G4' : 'E3 B3 D4'), dur: loop.bar - 0.05, a: 0.1, r: 0.1, shape: 'reed', cutoff: 1400, vel: 0.8, detune: 5 });
    });
    // Horn stabs answering at the end of bars two and four.
    for (const [bar, chord] of [[1, 'E4 G#4 B4 D5'], [3, 'A4 C#5 E5 G5']] as const) {
      stabChord(loop, hornBus, {
        t: loop.pos(bar, 3, 2), notes: notes(chord), dur: loop.step * 1.3, a: 0.012, r: 0.1, cutoff: 1800, vel: 0.8, detune: 7, spread: 0.5,
        brightCut: 5000, brightEnv: [[0, 0], [0.02, 0.8], [0.2, 0.25], [0.29, 0]],
      });
    }
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-future-bass', 'Future Bass Chords', 150, 8, 0, ['future bass', 'edm', 'electronic', 'chords', 'drop', 'modern', 'energetic'], 0.596, (loop, ctx) => {
    const kick = kickBuf(ctx, { f0: 160, f1: 46, sweep: 0.04, hold: 0.02, decay: 0.2, click: 0.25, drive: 2, len: 0.6 });
    const snare = snareBuf(ctx, { tone: 195, toneMix: 0.4, noiseDecay: 0.11, hp: 900, room: 0.6, roomDecay: 0.2 });
    const hat = hatBuf(ctx, { decay: 0.018 });
    drumsAll(loop, kick, 'X.....x.......x.|X.....x...x.....', 0.8);
    drumsAll(loop, snare, '........X.......', 0.6);
    drumsAll(loop, clapBuf(ctx, { decay: 0.1 }), '........x.......', 0.32);
    drumsAll(loop, hat, 'x.x.x.x.x.x.x.x.|x.x.x.x.x.x.xoxo', 0.12, undefined, 0.25);
    drumsAll(loop, hatBuf(ctx, { decay: 0.08, hp: 6500 }), '....x.......x...', 0.1, undefined, -0.25);
    // Thirty-second-note hat rolls into every fourth bar line.
    for (const bar of [3, 7]) [0, 0.5, 1, 1.5].forEach((off, i) => loop.hit(hat, loop.at(bar * 16 + 14 + off), 0.07 + i * 0.02, undefined, 0.25));

    const pumped = loop.bus(1);
    const kicks: number[] = [];
    for (let bar = 0; bar < 8; bar++) for (const step of bar % 2 ? [0, 6, 10] : [0, 6, 14]) kicks.push(loop.pos(bar, 0, step));
    loop.pump(pumped.gain, kicks, 0.6, loop.step * 3.6);
    const chordBus = loop.bus(0.44, 0, pumped);
    const bassBus = loop.bus(0.28, 0, pumped);
    const sparkBus = loop.bus(0.24);
    const prog = [
      { bass: 'F1', chord: 'F3 A3 C4 E4 G4' },
      { bass: 'G1', chord: 'G3 B3 D4 E4 G4' },
      { bass: 'A1', chord: 'A3 C4 E4 G4 B4' },
      { bass: 'E1', chord: 'E3 G3 B3 D4 G4' },
    ];
    const rnd = seededRandom(3001);
    const stabs = [0, 3, 6, 8, 11, 14];
    for (let bar = 0; bar < 8; bar++) {
      const p = prog[bar >> 1];
      const chord = notes(p.chord);
      stabs.forEach((step, i) => {
        const len = ((stabs[i + 1] ?? 16) - step) * loop.step - 0.07;
        // Wide super-saw stab whose brightness swells through each hit.
        stabChord(loop, chordBus, {
          t: loop.pos(bar, 0, step), notes: chord, dur: len, a: 0.015, r: 0.06, cutoff: 1300, vel: i === 0 || i === 3 ? 0.85 : 0.7, detune: 14, spread: 0.9,
          brightCut: 6500, brightEnv: [[0, 0], [0.012, 0.2], [len * 0.55, 0.9], [len, 0.5], [len + 0.06, 0]],
        });
      });
      const root = midi(p.bass);
      for (const [step, len] of [[0, 5.4], [6, 1.6], [8, 5.4], [14, 1.6]] as const) subNote(loop, bassBus, { t: loop.pos(bar, 0, step), note: root + 12, dur: loop.step * len, vel: 0.85, grit: 0.9, rel: 0.05 });
      // Sparkling plucks picked from the chord, two octaves up.
      for (let i = 0; i < 16; i++) {
        const pick = rnd();
        const pan = rnd() - 0.5;
        if (rnd() > 0.42) continue;
        const note = chord[Math.floor(pick * chord.length)] + 24;
        const t = loop.pos(bar, 0, i);
        bellNote(loop, sparkBus, { t, note, decay: 0.35, vel: 0.6, pan });
        bellNote(loop, sparkBus, { t: t + loop.step * 3, note, decay: 0.3, vel: 0.22, pan: -pan });
      }
    }
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-acoustic-pluck', 'Acoustic Pluck', 96, 4, 0, ['acoustic', 'guitar', 'pluck', 'folk', 'warm', 'fingerpicking', 'gentle'], 0.822, (loop, ctx) => {
    const guitar = loop.bus(0.34, -0.12);
    const second = loop.bus(0.2, 0.45);
    const prog = [
      { bass: ['G2', 'D3'], strings: ['G3', 'B3', 'D4'], top: 'G4' },
      { bass: ['E2', 'B2'], strings: ['G3', 'B3', 'E4'], top: 'G4' },
      { bass: ['C3', 'G2'], strings: ['G3', 'C4', 'E4'], top: 'G4' },
      { bass: ['D3', 'A2'], strings: ['A3', 'D4', 'F#4'], top: 'A4' },
    ];
    prog.forEach((p, bar) => {
      // Travis-style picking: thumb alternates the bass, fingers roll the upper strings.
      for (let i = 0; i < 8; i++) {
        const t = loop.pos(bar, 0, i * 2);
        if (i % 4 === 0) {
          stringNote(loop, guitar, { t, note: midi(p.bass[i / 4]), decay: 2.4, vel: 0.9, bright: 0.8 });
          if (i === 0) stringNote(loop, guitar, { t: t + 0.012, note: midi(p.top), decay: 1.8, vel: 0.6, pan: 0.2 });
        } else {
          stringNote(loop, guitar, { t, note: midi(p.strings[(i % 4) - 1]), decay: 1.7, vel: i % 2 ? 0.62 : 0.72, pan: ((i % 4) - 2) * 0.12 });
        }
      }
      // A second guitar brushes the chord on the downbeat.
      [...p.strings, p.top].forEach((name, i) => stringNote(loop, second, { t: loop.pos(bar) + 0.02 + i * 0.022, note: midi(name), decay: 2.0, vel: 0.55, bright: 0.7 }));
    });
    const melody: Ev[] = [
      [0, 12, 'B4'], [0, 14, 'D5'],
      [1, 12, 'E5'], [1, 14, 'B4'],
      [2, 12, 'C5'], [2, 14, 'E5'],
      [3, 8, 'F#5'], [3, 12, 'E5'], [3, 14, 'D5'],
    ];
    for (const [bar, step, name] of melody) stringNote(loop, guitar, { t: loop.pos(bar, 0, step), note: midi(name), decay: 1.6, vel: 0.8, pan: 0.25, bright: 1.1 });
    drumsAll(loop, shakerBuf(ctx, { attack: 0.02, decay: 0.03 }), 'o...x...o...x...', 0.06, undefined, 0.5);
    drumsAll(loop, percBuf(ctx, { f: 92, bend: 0.3, decay: 0.07, slap: 0.1 }), 'x.......o.......', 0.3);
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-tense-pulse', 'Tense Pulse', 120, 4, 0, ['tense', 'suspense', 'pulse', 'thriller', 'dark', 'investigation', 'countdown'], 0.664, (loop, ctx) => {
    const boom = kickBuf(ctx, { f0: 95, f1: 36, sweep: 0.07, hold: 0.03, decay: 0.45, click: 0.08, drive: 1.6, tone: 1500, len: 1.8 });
    const heart = kickBuf(ctx, { f0: 100, f1: 46, sweep: 0.05, decay: 0.13, click: 0.04, drive: 1.2, tone: 1800 });
    loop.hit(boom, loop.pos(0), 0.6);
    loop.hit(boom, loop.pos(2), 0.4);
    drums(loop, heart, '........x..o....', 0.5, undefined, 0, 1);
    drums(loop, heart, '........x..o....', 0.55, undefined, 0, 3);
    drumsAll(loop, rimBuf(ctx), 'x...o...x...o...', 0.13, undefined, 0.3);
    drumsAll(loop, hatBuf(ctx, { decay: 0.012, hp: 8000 }), '..x...x...x...x.', 0.06, undefined, -0.3);

    const bassBus = loop.bus(0.3);
    const tickBus = loop.bus(0.26, -0.2);
    const padBus = loop.bus(0.36);
    const highBus = loop.bus(0.2, 0.35);
    const accents = [1, 0.55, 0.7, 0.55, 0.85, 0.55, 0.7, 0.6];
    for (let bar = 0; bar < 4; bar++) {
      for (let i = 0; i < 8; i++) {
        // The last half bar slips up a semitone before falling back at the loop point.
        const note = bar === 3 && i >= 4 ? 39 : 38;
        synthNote(loop, bassBus, { t: loop.pos(bar, 0, i * 2), note, dur: loop.step * 1.3, vel: accents[i], cutoff: 320, envAmt: 3 + accents[i] * 3, envTime: 0.14, s: 0.55, rel: 0.05 });
      }
      const tick = 'x.xxx.xxx.xxx.xx';
      for (let i = 0; i < 16; i++) if (tick[i] === 'x') pluckNote(loop, tickBus, { t: loop.pos(bar, 0, i), note: bar === 3 && i >= 8 ? 51 : 50, shape: 'pulse', decay: 0.09, bright: 9, vel: i % 4 === 0 ? 0.8 : 0.55 });
    }
    // A cluster that slowly brightens through the loop, then a diminished colour in the last bar.
    padChord(loop, padBus, { t: 0.05, notes: notes('D3 A3 D#4 A4'), dur: 5, a: 3, r: 2.8, cutoff: 700, vel: 0.8, detune: 12, brightCut: 3000, brightEnv: [[0, 0], [6.4, 0.6], [7.8, 0]] });
    padChord(loop, padBus, { t: 5.8, notes: notes('D4 F4 G#4'), dur: 1.7, a: 1.4, r: 0.4, cutoff: 1500, vel: 0.5, detune: 12 });
    for (let i = 0; i < 32; i++) pluckNote(loop, highBus, { t: loop.pos(2, 0, i), note: 81, decay: 0.1, bright: 4, vel: 0.3 + (i / 32) * 0.6 });
  }),

  // -------------------------------------------------------------------------------------------
  bed('music-happy-ukulele', 'Happy Ukulele', 120, 8, 0, ['ukulele', 'happy', 'cheerful', 'fun', 'sunny', 'kids', 'positive', 'whistle'], 0.938, (loop, ctx) => {
    const uke = loop.bus(0.32, -0.15);
    const bassBus = loop.bus(0.3);
    const glock = loop.bus(0.26, 0.2);
    const prog = [
      { bass: 'C3', chord: 'G4 C4 E4 C5' },
      { bass: 'G2', chord: 'G4 D4 G4 B4' },
      { bass: 'A2', chord: 'A4 C4 E4 A4' },
      { bass: 'F2', chord: 'A4 C4 F4 A4' },
    ];
    // Island strum: down, down-up, up-down-up. Down-strokes roll low string to high, up-strokes the reverse.
    const strum: [step: number, down: boolean, vel: number][] = [[0, true, 1], [4, true, 0.8], [6, false, 0.6], [10, false, 0.65], [12, true, 0.85], [14, false, 0.6]];
    for (let bar = 0; bar < 8; bar++) {
      const p = prog[bar % 4];
      const strings = notes(p.chord);
      for (const [step, down, vel] of strum) {
        const order = down ? [0, 1, 2, 3] : [3, 2, 1];
        order.forEach((s, i) => {
          stringNote(loop, uke, { t: loop.pos(bar, 0, step) + i * (down ? 0.013 : 0.009), note: strings[s], decay: 0.9, vel: vel * (down ? 0.8 : 0.65), bright: 1.3, pan: (s - 1.5) * 0.1 });
        });
      }
      const root = midi(p.bass);
      stringNote(loop, bassBus, { t: loop.pos(bar), note: root, decay: 1.1, vel: 0.9, bright: 0.5 });
      stringNote(loop, bassBus, { t: loop.pos(bar, 2), note: root + 7, decay: 0.9, vel: 0.75, bright: 0.5 });
      stringNote(loop, bassBus, { t: loop.pos(bar, 3, 2), note: root, decay: 0.5, vel: 0.6, bright: 0.5 });
    }
    const melody: Ev[] = [
      [0, 0, 'E5'], [0, 4, 'G5'], [0, 8, 'C6'], [0, 12, 'B5'], [0, 14, 'C6'],
      [1, 0, 'D6'], [1, 4, 'B5'], [1, 8, 'G5'], [1, 12, 'A5'], [1, 14, 'B5'],
      [2, 0, 'C6'], [2, 4, 'A5'], [2, 8, 'E5'], [2, 12, 'A5'],
      [3, 0, 'A5'], [3, 4, 'F5'], [3, 8, 'A5'], [3, 12, 'G5'],
      [4, 0, 'E5'], [4, 4, 'G5'], [4, 8, 'C6'], [4, 12, 'E6'], [4, 14, 'D6'],
      [5, 0, 'D6'], [5, 4, 'B5'], [5, 8, 'D6'], [5, 12, 'G5'],
      [6, 0, 'C6'], [6, 4, 'E6'], [6, 8, 'C6'], [6, 12, 'A5'], [6, 14, 'C6'],
      [7, 0, 'A5'], [7, 4, 'C6'], [7, 8, 'G5'], [7, 12, 'D5'],
    ];
    const bars = [[1, 1, 1], [2.756, 0.3, 0.4], [5.404, 0.1, 0.25]] as const;
    for (const [bar, step, name] of melody) bellNote(loop, glock, { t: loop.pos(bar, 0, step), note: midi(name), decay: 0.9, vel: 0.7, partials: bars });
    drumsAll(loop, clapBuf(ctx, { decay: 0.05, f: 1500 }), '....x.......x...', 0.22, undefined, 0.2);
    drumsAll(loop, shakerBuf(ctx), 'x-o-x-o-x-o-x-o-', 0.08, undefined, 0.45);
    drumsAll(loop, percBuf(ctx, { f: 88, bend: 0.4, decay: 0.08, slap: 0.12 }), 'x.......x.....o.', 0.3);
  }),
];

export default sounds;
