import { getSound } from '@/library';
import type { SoundDef } from '@/library/types';

export const SOUND_SAMPLE_RATE = 48000;
/** Looping beds are tiled this many times so a single clip covers a useful stretch of timeline. */
export const LOOP_REPEATS = 4;

const bufferCache = new Map<string, Promise<AudioBuffer>>();
const blobCache = new Map<string, Promise<{ blob: Blob; url: string; duration: number }>>();

/** Synthesise one pass of a library sound. */
export function renderSound(def: SoundDef): Promise<AudioBuffer> {
  let p = bufferCache.get(def.id);
  if (!p) {
    p = (async () => {
      const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(def.duration * SOUND_SAMPLE_RATE)), SOUND_SAMPLE_RATE);
      def.render(ctx, ctx.destination);
      return ctx.startRendering();
    })();
    bufferCache.set(def.id, p);
    p.catch(() => bufferCache.delete(def.id));
  }
  return p;
}

/** Duration of the generated asset for a sound (loops are tiled). */
export const soundAssetDuration = (def: SoundDef): number => def.duration * (def.loop ? LOOP_REPEATS : 1);

/** Encode channel data as a 16-bit PCM WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number, repeats = 1): Blob {
  const numCh = channels.length;
  const frames = channels[0].length;
  const total = frames * repeats;
  const bytes = total * numCh * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, bytes, true);
  let offset = 44;
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const v = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        offset += 2;
      }
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** WAV blob + object URL for a library sound, cached for the session. */
export function soundBlob(soundId: string): Promise<{ blob: Blob; url: string; duration: number }> {
  let p = blobCache.get(soundId);
  if (!p) {
    p = (async () => {
      const def = getSound(soundId);
      if (!def) throw new Error(`Unknown sound "${soundId}"`);
      const buf = await renderSound(def);
      const channels = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)];
      const blob = encodeWav(channels, buf.sampleRate, def.loop ? LOOP_REPEATS : 1);
      return { blob, url: URL.createObjectURL(blob), duration: soundAssetDuration(def) };
    })();
    blobCache.set(soundId, p);
    p.catch(() => blobCache.delete(soundId));
  }
  return p;
}

let auditionCtx: AudioContext | null = null;
let auditionNode: AudioBufferSourceNode | null = null;

/** Play a sound once through the speakers (library preview). Returns a stop function. */
export async function auditionSound(def: SoundDef, volume = 0.9, onEnded?: () => void): Promise<() => void> {
  stopAudition();
  const buffer = await renderSound(def);
  auditionCtx ??= new AudioContext({ sampleRate: SOUND_SAMPLE_RATE });
  if (auditionCtx.state === 'suspended') await auditionCtx.resume();
  const node = auditionCtx.createBufferSource();
  node.buffer = buffer;
  const gain = auditionCtx.createGain();
  gain.gain.value = volume;
  node.connect(gain).connect(auditionCtx.destination);
  node.onended = () => {
    if (auditionNode === node) auditionNode = null;
    onEnded?.();
  };
  node.start();
  auditionNode = node;
  return stopAudition;
}

export function stopAudition(): void {
  if (auditionNode) {
    try {
      auditionNode.onended = null;
      auditionNode.stop();
    } catch {
      /* already stopped */
    }
    auditionNode = null;
  }
}
