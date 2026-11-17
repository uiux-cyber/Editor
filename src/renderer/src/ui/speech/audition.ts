/**
 * A/B listening for noise reduction: the original and the cleaned excerpt play in lock-step
 * (looped) and a switch crossfades between them, so the difference is heard at the same moment.
 */

export type Side = 'A' | 'B';

let ctx: AudioContext | null = null;
let nodes: { a: AudioBufferSourceNode; b: AudioBufferSourceNode; ga: GainNode; gb: GainNode } | null = null;
const listeners = new Set<() => void>();
let side: Side = 'B';

const notify = (): void => listeners.forEach((cb) => cb());

export function onAuditionChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const auditionPlaying = (): boolean => !!nodes;
export const auditionSide = (): Side => side;

function toBuffer(c: AudioContext, channels: Float32Array[], sampleRate: number): AudioBuffer {
  const buf = c.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  return buf;
}

export async function playAudition(original: Float32Array[], cleaned: Float32Array[], sampleRate: number, start: Side = side): Promise<void> {
  stopAudition();
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const c = ctx;
  const a = c.createBufferSource();
  const b = c.createBufferSource();
  a.buffer = toBuffer(c, original, sampleRate);
  b.buffer = toBuffer(c, cleaned, sampleRate);
  a.loop = b.loop = true;
  const ga = c.createGain();
  const gb = c.createGain();
  side = start;
  ga.gain.value = side === 'A' ? 1 : 0;
  gb.gain.value = side === 'B' ? 1 : 0;
  a.connect(ga).connect(c.destination);
  b.connect(gb).connect(c.destination);
  const when = c.currentTime + 0.05;
  a.start(when);
  b.start(when);
  nodes = { a, b, ga, gb };
  notify();
}

export function setAuditionSide(next: Side): void {
  side = next;
  if (nodes && ctx) {
    const t = ctx.currentTime;
    nodes.ga.gain.setTargetAtTime(next === 'A' ? 1 : 0, t, 0.015);
    nodes.gb.gain.setTargetAtTime(next === 'B' ? 1 : 0, t, 0.015);
  }
  notify();
}

export function stopAudition(): void {
  if (!nodes) return;
  try {
    nodes.a.stop();
    nodes.b.stop();
  } catch {
    /* already stopped */
  }
  nodes.a.disconnect();
  nodes.b.disconnect();
  nodes = null;
  notify();
}
