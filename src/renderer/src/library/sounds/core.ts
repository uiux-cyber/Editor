import { seededRandom } from '@/core/easing';
import type { SoundDef } from '../types';

/** Fill a stereo buffer with deterministic white noise. */
export function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = seededRandom(seed + ch * 7919);
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = rnd() * 2 - 1;
  }
  return buffer;
}

/** Reference sounds. Further packs live next to this file. */
const sounds: SoundDef[] = [
  {
    id: 'whoosh-soft',
    name: 'Soft Whoosh',
    category: 'whoosh',
    duration: 0.8,
    keywords: ['whoosh', 'swipe', 'transition', 'air'],
    render: (ctx, dest) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.8, 11);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(300, 0);
      filter.frequency.exponentialRampToValueAtTime(3200, 0.38);
      filter.frequency.exponentialRampToValueAtTime(500, 0.78);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, 0);
      gain.gain.linearRampToValueAtTime(0.7, 0.36);
      gain.gain.linearRampToValueAtTime(0, 0.78);
      src.connect(filter).connect(gain).connect(dest);
      src.start(0);
      src.stop(0.8);
    },
  },
  {
    id: 'pop',
    name: 'Pop',
    category: 'ui',
    duration: 0.25,
    keywords: ['pop', 'bubble', 'click', 'appear'],
    render: (ctx, dest) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, 0);
      osc.frequency.exponentialRampToValueAtTime(140, 0.12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, 0);
      gain.gain.linearRampToValueAtTime(0.8, 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, 0.2);
      gain.gain.linearRampToValueAtTime(0, 0.23);
      osc.connect(gain).connect(dest);
      osc.start(0);
      osc.stop(0.25);
    },
  },
  {
    id: 'ding',
    name: 'Ding',
    category: 'notification',
    duration: 1.4,
    keywords: ['ding', 'bell', 'notification', 'success', 'chime'],
    render: (ctx, dest) => {
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, 0);
      out.gain.linearRampToValueAtTime(0.6, 0.004);
      out.gain.exponentialRampToValueAtTime(0.001, 1.3);
      out.gain.linearRampToValueAtTime(0, 1.38);
      out.connect(dest);
      for (const [freq, level] of [
        [1318.5, 0.6],
        [2637, 0.25],
        [3955.5, 0.1],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(out);
        osc.start(0);
        osc.stop(1.4);
      }
    },
  },
];

export default sounds;
