/**
 * Per-clip audio processing chain shared by the live preview and the export mix. Features that
 * process a clip's sound (EQ, compressor, pitch, …) live in `engine/audio/ext/*.ts`, each
 * default-exporting a `ClipAudioExtension` (or an array). The chain sits between the clip's
 * source node and its volume gain:  source → ext₁ → ext₂ → … → gain → mix.
 */

import type { AudioClip, VideoClip } from '@/core/types';

export type AudioMediaClip = VideoClip | AudioClip;

export interface AudioStage {
  input: AudioNode;
  output: AudioNode;
  /** Release anything that is not freed by disconnecting the nodes. */
  dispose?: () => void;
}

export interface ClipAudioExtension {
  id: string;
  /** Lower runs first (default 100). */
  order?: number;
  /**
   * Fingerprint of the clip settings this extension depends on. When it changes the preview
   * rebuilds the chain. Return '' when the extension is inactive for the clip.
   */
  key: (clip: AudioMediaClip) => string;
  /** Build the stage, or return null when inactive. `mode` tells live playback from export. */
  build: (ctx: BaseAudioContext, clip: AudioMediaClip, mode: 'preview' | 'export') => AudioStage | null;
}

const modules = import.meta.glob<{ default: ClipAudioExtension | ClipAudioExtension[] }>('./ext/*.ts', { eager: true });

export const AUDIO_EXTENSIONS: ClipAudioExtension[] = Object.keys(modules)
  .sort()
  .flatMap((k) => {
    const d = modules[k].default;
    return Array.isArray(d) ? d : d ? [d] : [];
  })
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

/** Combined fingerprint of every extension for a clip ('' = no processing). */
export function chainKey(clip: AudioMediaClip): string {
  let key = '';
  for (const ext of AUDIO_EXTENSIONS) {
    const k = ext.key(clip);
    if (k) key += `${ext.id}:${k};`;
  }
  return key;
}

export interface BuiltChain {
  input: AudioNode | null;
  output: AudioNode | null;
  key: string;
  dispose: () => void;
}

/**
 * Build the processing chain for a clip. When no extension is active `input`/`output` are null
 * and the caller connects the source straight to its gain.
 */
export function buildChain(ctx: BaseAudioContext, clip: AudioMediaClip, mode: 'preview' | 'export'): BuiltChain {
  const stages: AudioStage[] = [];
  for (const ext of AUDIO_EXTENSIONS) {
    if (!ext.key(clip)) continue;
    try {
      const st = ext.build(ctx, clip, mode);
      if (st) stages.push(st);
    } catch (err) {
      console.warn(`[audio] extension "${ext.id}" failed`, err);
    }
  }
  for (let i = 0; i + 1 < stages.length; i++) stages[i].output.connect(stages[i + 1].input);
  return {
    input: stages[0]?.input ?? null,
    output: stages[stages.length - 1]?.output ?? null,
    key: chainKey(clip),
    dispose: () => {
      for (const st of stages) {
        try {
          st.input.disconnect();
          st.output.disconnect();
        } catch {
          /* already disconnected */
        }
        st.dispose?.();
      }
    },
  };
}
