/**
 * Parametric EQ (AudioProps.eq) as a clip audio extension: one BiquadFilterNode per band, in
 * order. The same build runs for the live preview and the offline export mix.
 *
 * The chain key only encodes the band layout (count + types). Parameter changes are pushed into
 * the live preview nodes (smoothed) instead of rebuilding the chain, so dragging a node while
 * the clip plays sweeps the filter without clicks.
 */

import { isNeutralEq, nodeQ, sanitizeEq } from '@/core/audiofx/eq';
import type { EqBand, ID } from '@/core/types';
import { useProjectStore } from '@/store/project';
import type { AudioMediaClip, ClipAudioExtension } from '../chain';

const live = new Map<ID, Set<BiquadFilterNode[]>>();

function layout(bands: EqBand[]): string {
  return bands.map((b) => b.type).join(',');
}

function bandsOf(clip: AudioMediaClip): EqBand[] | null {
  if (!clip.eq || !Array.isArray(clip.eq) || isNeutralEq(clip.eq)) return null;
  return sanitizeEq(clip.eq);
}

function setParams(node: BiquadFilterNode, b: EqBand, ctx: BaseAudioContext | null): void {
  if (ctx && ctx instanceof AudioContext) {
    const t = ctx.currentTime;
    node.frequency.setTargetAtTime(b.frequency, t, 0.015);
    node.gain.setTargetAtTime(b.gain, t, 0.015);
    node.Q.setTargetAtTime(nodeQ(b), t, 0.015);
  } else {
    node.frequency.value = b.frequency;
    node.gain.value = b.gain;
    node.Q.value = nodeQ(b);
  }
}

let lastProject: unknown = null;
useProjectStore.subscribe((s) => {
  if (s.project === lastProject) return;
  lastProject = s.project;
  for (const [id, set] of live) {
    const clip = s.project.clips[id];
    if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) continue;
    const bands = bandsOf(clip);
    if (!bands) continue;
    for (const nodes of set) {
      if (nodes.length !== bands.length || nodes.some((n, i) => n.type !== bands[i].type)) continue;
      nodes.forEach((n, i) => setParams(n, bands[i], n.context));
    }
  }
});

const ext: ClipAudioExtension = {
  id: 'eq',
  order: 10,
  key: (clip) => {
    const bands = bandsOf(clip);
    return bands ? layout(bands) : '';
  },
  build: (ctx, clip, mode) => {
    const bands = bandsOf(clip);
    if (!bands || bands.length === 0) return null;
    const nodes = bands.map((b) => {
      const n = ctx.createBiquadFilter();
      n.type = b.type;
      setParams(n, b, null);
      return n;
    });
    for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
    let dispose: (() => void) | undefined;
    if (mode === 'preview') {
      let set = live.get(clip.id);
      if (!set) live.set(clip.id, (set = new Set()));
      set.add(nodes);
      dispose = () => {
        const s = live.get(clip.id);
        s?.delete(nodes);
        if (s && s.size === 0) live.delete(clip.id);
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {
            /* already disconnected */
          }
        }
      };
    }
    return { input: nodes[0], output: nodes[nodes.length - 1], dispose };
  },
};

export default ext;
