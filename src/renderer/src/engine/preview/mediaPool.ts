/**
 * Live playback of timed media for the preview. Every video / audio clip near the playhead gets
 * its own media element, kept in sync with the timeline clock; element audio is routed through
 * Web Audio so clip volume, fades and the master level apply.
 */

import { mediaInstances, pictureRefsAt, soundsAt } from '@/core/nested';
import { sourceRange, sourceTimeAt, speedAt } from '@/core/timemap';
import type { AudioClip, ID, MediaAsset, Project, VideoClip } from '@/core/types';
import { buildChain, chainKey, type BuiltChain } from '../audio/chain';
import type { FrameImage } from '../compositor';
import { assetUrl } from '../media/assets';
import { ReverseAudio, ReverseFrames } from './reverse';

type MediaClip = VideoClip | AudioClip;

interface Slot {
  clipId: ID;
  url: string;
  el: HTMLVideoElement | HTMLAudioElement;
  isVideo: boolean;
  gain: GainNode | null;
  node: MediaElementAudioSourceNode | null;
  /** Bumped whenever a new picture becomes available while paused. */
  frameVersion: number;
  pendingSeek: number | null;
  lastUsed: number;
  cleanup: () => void;
  /** Per-clip processing chain between the element source and its gain (engine/audio). */
  chain: BuiltChain | null;
  /** Sum point of the clip's sources (element / reversed buffer) feeding the chain. */
  bus: GainNode | null;
  /** Reverse playback (decoded frames + rendered sound) for reversed clips. */
  rev: ReverseState | null;
}

/** Reverse playback state of a slot (see ./reverse.ts). */
interface ReverseState {
  frames: ReverseFrames | null;
  audio: ReverseAudio | null;
  node: AudioBufferSourceNode | null;
  /** Audio-clock time and clip-local time at which `node` started. */
  startedAt: number;
  startedLocal: number;
}

const PRELOAD_AHEAD = 2.0;
const MAX_IDLE_SLOTS = 4;
const HARD_RESYNC = 0.28;

export class MediaPool {
  private slots = new Map<ID, Slot>();
  private host: HTMLDivElement;
  private audioCtx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private tick = 0;
  private masterVolume = 1;
  /** Called when a paused element has decoded a new frame and the preview should repaint. */
  onFrame: () => void = () => undefined;

  constructor() {
    // Elements live in a hidden host so Chromium keeps decoding them normally.
    this.host = document.createElement('div');
    this.host.setAttribute('aria-hidden', 'true');
    this.host.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none;';
    document.body.appendChild(this.host);
  }

  private ensureAudio(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.audioCtx.createGain();
      this.master.gain.value = this.masterVolume;
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.meterBuf = new Float32Array(this.analyser.fftSize);
      this.master.connect(this.analyser);
      this.master.connect(this.audioCtx.destination);
    }
    return this.audioCtx;
  }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.min(2, Math.max(0, v));
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  /** Peak output level (0..1) for the UI meter. */
  level(): number {
    if (!this.analyser || !this.meterBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = Math.abs(this.meterBuf[i]);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak);
  }

  private createSlot(clip: MediaClip, url: string): Slot {
    const isVideo = clip.type === 'video';
    const el = document.createElement(isVideo ? 'video' : 'audio') as HTMLVideoElement | HTMLAudioElement;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    if (isVideo) (el as HTMLVideoElement).playsInline = true;
    el.preservesPitch = false;
    el.src = url;
    this.host.appendChild(el);

    const slot: Slot = { clipId: clip.id, url, el, isVideo, gain: null, node: null, frameVersion: 1, pendingSeek: null, lastUsed: this.tick, cleanup: () => undefined, chain: null, bus: null, rev: null };

    try {
      const ctx = this.ensureAudio();
      slot.node = ctx.createMediaElementSource(el);
      slot.bus = ctx.createGain();
      slot.node.connect(slot.bus);
      slot.gain = ctx.createGain();
      slot.gain.gain.value = 0;
      slot.gain.connect(this.master!);
      this.wireChain(slot, clip);
    } catch (err) {
      console.warn('[preview] audio routing unavailable', err);
      el.muted = true;
    }

    const bump = (): void => {
      slot.frameVersion++;
      this.onFrame();
    };
    const onSeeked = (): void => {
      if (slot.pendingSeek !== null) {
        const target = slot.pendingSeek;
        slot.pendingSeek = null;
        if (Math.abs(el.currentTime - target) > 0.001) {
          el.currentTime = target;
          return;
        }
      }
      bump();
    };
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('loadeddata', bump);
    el.addEventListener('canplay', bump);
    slot.cleanup = () => {
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('loadeddata', bump);
      el.removeEventListener('canplay', bump);
    };
    return slot;
  }

  /** (Re)connect sources → processing chain → gain for a clip's current settings. */
  private wireChain(slot: Slot, clip: MediaClip): void {
    const src = slot.bus ?? slot.node;
    if (!src || !slot.gain || !this.audioCtx) return;
    try {
      src.disconnect();
    } catch {
      /* not connected yet */
    }
    slot.chain?.dispose();
    const chain = buildChain(this.audioCtx, clip, 'preview');
    slot.chain = chain;
    if (chain.input && chain.output) {
      src.connect(chain.input);
      chain.output.connect(slot.gain);
    } else {
      src.connect(slot.gain);
    }
  }

  private destroySlot(slot: Slot): void {
    slot.cleanup();
    this.dropReverse(slot);
    try {
      slot.el.pause();
      slot.node?.disconnect();
      slot.bus?.disconnect();
      slot.chain?.dispose();
      slot.gain?.disconnect();
      slot.el.removeAttribute('src');
      slot.el.load();
    } catch {
      /* element already gone */
    }
    slot.el.remove();
    this.slots.delete(slot.clipId);
  }

  private slotFor(clip: MediaClip): Slot | null {
    const url = assetUrl(clip.assetId);
    if (!url) return null;
    let slot = this.slots.get(clip.id);
    if (slot && slot.url !== url) {
      this.destroySlot(slot);
      slot = undefined;
    }
    if (!slot) {
      slot = this.createSlot(clip, url);
      this.slots.set(clip.id, slot);
    }
    slot.lastUsed = this.tick;
    return slot;
  }

  private seek(slot: Slot, target: number): void {
    const el = slot.el;
    if (el.seeking) {
      slot.pendingSeek = target;
      return;
    }
    slot.pendingSeek = null;
    try {
      el.currentTime = target;
    } catch {
      /* not seekable yet; `loadeddata` will trigger another sync */
    }
  }

  /**
   * Bring every element in line with the timeline. Call on each playback tick and after seeks
   * or project edits.
   */
  sync(project: Project, time: number, playing: boolean): void {
    this.tick++;
    const fps = project.settings.fps;
    const wanted = new Map<ID, { clip: MediaClip; localTime: number; gain: number; active: boolean }>();

    // Pictures on screen (including the handles used by transitions and clips inside compound
    // clips, which come as instance clips with their own ids).
    for (const ref of pictureRefsAt(project, time)) {
      wanted.set(ref.clip.id, { clip: ref.clip, localTime: ref.localTime, gain: 0, active: true });
    }
    // Sound.
    for (const a of soundsAt(project, time)) {
      const w = wanted.get(a.clip.id);
      if (w) w.gain = a.gain;
      else wanted.set(a.clip.id, { clip: a.clip, localTime: a.localTime, gain: a.gain, active: true });
    }
    // Clips about to start: create and pre-seek their elements so the cut is seamless.
    for (const inst of mediaInstances(project)) {
      if (inst.from > time + PRELOAD_AHEAD) break;
      const clip = inst.clip;
      if (inst.from > time && !wanted.has(clip.id)) wanted.set(clip.id, { clip, localTime: inst.from - inst.origin, gain: 0, active: false });
      // Keep the element of a clip we just left for a moment (scrubbing back and forth).
      else if (inst.to <= time && time - inst.to < 0.5 && !wanted.has(clip.id) && this.slots.has(clip.id)) {
        this.slots.get(clip.id)!.lastUsed = this.tick;
      }
    }

    if (playing && this.audioCtx && this.audioCtx.state === 'suspended') void this.audioCtx.resume();

    for (const w of wanted.values()) {
      const asset = project.assets[w.clip.assetId];
      if (!asset) continue;
      const slot = this.slotFor(w.clip);
      if (!slot) continue;
      if (slot.node && slot.gain && slot.chain && slot.chain.key !== chainKey(w.clip)) this.wireChain(slot, w.clip);
      const el = slot.el;
      const maxT = asset.duration > 0 ? Math.max(0, asset.duration - 0.02) : Infinity;
      const desired = Math.min(Math.max(sourceTimeAt(w.clip, w.localTime), 0), maxT);
      // Speed ramps drive the rate continuously; freeze frames hold a paused element.
      const rate = Math.min(16, Math.max(0.0625, speedAt(w.clip, w.localTime) || 1));
      if (slot.gain) {
        const g = playing && w.active ? w.gain : 0;
        // Short smoothing avoids zipper noise on fades.
        slot.gain.gain.setTargetAtTime(g, this.audioCtx!.currentTime, 0.012);
      }
      if (el.preservesPitch !== !!w.clip.preservePitch) el.preservesPitch = !!w.clip.preservePitch;

      if (w.clip.reverse && !w.clip.freeze) {
        // Media elements cannot play backwards: decoded frames + a rendered reversed sound.
        if (!el.paused) el.pause();
        this.syncReverse(slot, w.clip, asset, w.localTime, desired, playing && w.active);
        continue;
      }
      if (slot.rev) this.dropReverse(slot);

      if (playing && w.active && el.readyState >= 1 && !w.clip.freeze) {
        if (el.playbackRate !== rate) el.playbackRate = rate;
        const atEnd = desired >= maxT - 0.001;
        if (el.paused) {
          if (!atEnd) {
            if (Math.abs(el.currentTime - desired) > 0.04) this.seek(slot, desired);
            void el.play().catch(() => undefined);
          }
        } else if (!el.seeking) {
          const drift = el.currentTime - desired;
          if (Math.abs(drift) > HARD_RESYNC * Math.max(1, rate)) {
            this.seek(slot, desired);
          } else if (Math.abs(drift) > 0.045) {
            // Gently steer back instead of jumping (inaudible, avoids visible stutter).
            el.playbackRate = rate * (1 - Math.max(-0.08, Math.min(0.08, drift)));
          }
        }
      } else {
        if (!el.paused) el.pause();
        if (el.readyState >= 1) {
          const target = slot.pendingSeek ?? el.currentTime;
          if (Math.abs(target - desired) > 0.5 / fps) this.seek(slot, desired);
        }
      }
    }

    // Silence and pause everything that is no longer needed; drop the oldest idle elements.
    const idle: Slot[] = [];
    for (const slot of this.slots.values()) {
      if (wanted.has(slot.clipId)) continue;
      if (!slot.el.paused) slot.el.pause();
      if (slot.rev) this.stopReverseSound(slot.rev);
      if (slot.gain && this.audioCtx) slot.gain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.01);
      // Instance clips of compound clips are not in project.clips: they simply age out.
      if (!project.clips[slot.clipId] && !slot.clipId.includes('/')) this.destroySlot(slot);
      else idle.push(slot);
    }
    if (idle.length > MAX_IDLE_SLOTS) {
      idle.sort((a, b) => a.lastUsed - b.lastUsed);
      for (const slot of idle.slice(0, idle.length - MAX_IDLE_SLOTS)) this.destroySlot(slot);
    }
  }

  /** Start / steer / stop the reverse playback of a slot. */
  private syncReverse(slot: Slot, clip: MediaClip, asset: MediaAsset, localTime: number, sourceTime: number, playing: boolean): void {
    const rev = (slot.rev ??= { frames: null, audio: null, node: null, startedAt: 0, startedLocal: 0 });
    if (clip.type === 'video' && asset.hasVideo) {
      rev.frames ??= new ReverseFrames(asset, () => {
        slot.frameVersion++;
        this.onFrame();
      });
      rev.frames.want(sourceTime, sourceRange(clip).from, playing);
    }
    if (!this.audioCtx || !slot.bus) return;
    rev.audio ??= new ReverseAudio(this.audioCtx);
    rev.audio.prepare(clip, asset);
    const ctx = this.audioCtx;
    const buffer = rev.audio.buffer;
    if (playing && buffer && localTime >= 0 && localTime < clip.duration) {
      const at = rev.node ? rev.startedLocal + (ctx.currentTime - rev.startedAt) : -1;
      if (!rev.node || rev.node.buffer !== buffer || Math.abs(at - localTime) > 0.06) {
        this.stopReverseSound(rev);
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(slot.bus);
        node.start(0, Math.max(0, localTime));
        rev.node = node;
        rev.startedAt = ctx.currentTime;
        rev.startedLocal = localTime;
      }
    } else {
      this.stopReverseSound(rev);
    }
  }

  private stopReverseSound(rev: ReverseState): void {
    if (!rev.node) return;
    try {
      rev.node.stop();
      rev.node.disconnect();
    } catch {
      /* already stopped */
    }
    rev.node = null;
  }

  private dropReverse(slot: Slot): void {
    if (!slot.rev) return;
    this.stopReverseSound(slot.rev);
    slot.rev.frames?.dispose();
    slot.rev.audio?.dispose();
    slot.rev = null;
  }

  /** Current picture of a video clip (its element, or decoded frames for reversed clips). */
  videoFrame(clip: VideoClip, sourceTime?: number): FrameImage | null {
    const slot = this.slots.get(clip.id);
    if (!slot || !slot.isVideo) return null;
    if (clip.reverse && !clip.freeze && slot.rev?.frames) {
      return slot.rev.frames.frame(sourceTime ?? sourceTimeAt(clip, 0));
    }
    const el = slot.el as HTMLVideoElement;
    if (el.readyState < 2 || el.videoWidth === 0) return null;
    return {
      source: el,
      width: el.videoWidth,
      height: el.videoHeight,
      version: slot.frameVersion * 100003 + (Math.round(el.currentTime * 600) % 100003),
    };
  }

  /** True while any needed element is still seeking / buffering (the picture may be stale). */
  isSettling(): boolean {
    for (const slot of this.slots.values()) {
      if (slot.lastUsed !== this.tick) continue;
      if (slot.rev?.frames) {
        if (slot.rev.frames.settling(slot.rev.frames.lastTarget)) return true;
        continue;
      }
      if (slot.el.seeking || slot.pendingSeek !== null || slot.el.readyState < 2) return true;
    }
    return false;
  }

  pauseAll(): void {
    for (const slot of this.slots.values()) {
      if (slot.rev) this.stopReverseSound(slot.rev);
      if (!slot.el.paused) slot.el.pause();
      if (slot.gain && this.audioCtx) slot.gain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.01);
    }
  }

  reset(): void {
    for (const slot of [...this.slots.values()]) this.destroySlot(slot);
  }

  dispose(): void {
    this.reset();
    this.host.remove();
    void this.audioCtx?.close();
    this.audioCtx = null;
  }
}
