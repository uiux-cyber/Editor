/**
 * Compressor (AudioProps.compressor) as a clip audio extension: DynamicsCompressorNode followed
 * by a gain stage that applies the user's make-up and cancels the node's automatic make-up
 * (core/audiofx/compressor.ts). Runs after the EQ. Identical for preview and export.
 *
 * Live preview nodes are registered per clip so the inspector can show gain reduction while the
 * clip plays, and so parameter changes are applied without rebuilding the chain.
 */

import { kneeFor, makeupStageDb, sanitizeCompressor } from '@/core/audiofx/compressor';
import type { CompressorSettings, ID } from '@/core/types';
import { useProjectStore } from '@/store/project';
import type { AudioMediaClip, ClipAudioExtension } from '../chain';

interface LiveComp {
  comp: DynamicsCompressorNode;
  makeup: GainNode;
}

const live = new Map<ID, Set<LiveComp>>();

function settingsOf(clip: AudioMediaClip): CompressorSettings | null {
  const c = clip.compressor;
  if (!c || typeof c !== 'object' || c.enabled === false) return null;
  return sanitizeCompressor(c);
}

function apply(n: LiveComp, s: CompressorSettings, smooth: boolean): void {
  const makeup = Math.pow(10, makeupStageDb(s) / 20);
  const values: [AudioParam, number][] = [
    [n.comp.threshold, s.threshold],
    [n.comp.knee, kneeFor(s.ratio)],
    [n.comp.ratio, s.ratio],
    [n.comp.attack, s.attack],
    [n.comp.release, s.release],
    [n.makeup.gain, makeup],
  ];
  const ctx = n.comp.context;
  for (const [param, v] of values) {
    if (smooth && ctx instanceof AudioContext) param.setTargetAtTime(v, ctx.currentTime, 0.02);
    else param.value = v;
  }
}

let lastProject: unknown = null;
useProjectStore.subscribe((s) => {
  if (s.project === lastProject) return;
  lastProject = s.project;
  for (const [id, set] of live) {
    const clip = s.project.clips[id];
    if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) continue;
    const settings = settingsOf(clip);
    if (!settings) continue;
    for (const n of set) apply(n, settings, true);
  }
});

/** Current gain reduction (dB, ≥ 0) of a clip's compressor in the live preview, or null. */
export function compressorReduction(clipId: ID): number | null {
  const set = live.get(clipId);
  if (!set || set.size === 0) return null;
  let r = 0;
  for (const n of set) r = Math.max(r, -n.comp.reduction);
  return r;
}

const ext: ClipAudioExtension = {
  id: 'compressor',
  order: 20,
  key: (clip) => (settingsOf(clip) ? 'on' : ''),
  build: (ctx, clip, mode) => {
    const settings = settingsOf(clip);
    if (!settings) return null;
    const n: LiveComp = { comp: ctx.createDynamicsCompressor(), makeup: ctx.createGain() };
    apply(n, settings, false);
    n.comp.connect(n.makeup);
    let dispose: (() => void) | undefined;
    if (mode === 'preview') {
      let set = live.get(clip.id);
      if (!set) live.set(clip.id, (set = new Set()));
      set.add(n);
      dispose = () => {
        const s = live.get(clip.id);
        s?.delete(n);
        if (s && s.size === 0) live.delete(clip.id);
        try {
          n.comp.disconnect();
        } catch {
          /* already disconnected */
        }
      };
    }
    return { input: n.comp, output: n.makeup, dispose };
  },
};

export default ext;
