/**
 * Export targets: what one entry of the export dialog produces. A target is either a platform
 * preset or the custom settings; planning it yields the adapted project snapshot (reframed for
 * another aspect when needed), the concrete ExportSettings and naming for the output.
 *
 * Pure module (no DOM / GPU): unit tested in tests/export.test.ts.
 */

import type { VideoCodec } from 'mediabunny';
import { reframeProject } from '@/core/reframe';
import type { Project } from '@/core/types';
import type { ExportContainer, ExportSettings, QualityLevel, SubtitleFormat } from './exporter';
import { aspectName, frameFor, getPreset, outputSuffix, presetSettings, sameAspect, specLine, type AspectId } from './presets';

export interface FormatOption {
  id: string;
  label: string;
  hint: string;
  container: ExportContainer;
  codec: VideoCodec;
  ext: string;
  kind: 'video' | 'gif' | 'audio' | 'image' | 'sequence';
  /** Keeps a transparent background. */
  alpha?: boolean;
}

export const FORMATS: FormatOption[] = [
  { id: 'mp4-avc', label: 'MP4 · H.264', hint: 'Plays everywhere. Best choice for YouTube, TikTok, Instagram and sharing.', container: 'mp4', codec: 'avc', ext: 'mp4', kind: 'video' },
  { id: 'mp4-hevc', label: 'MP4 · HEVC (H.265)', hint: 'About 30% smaller files at the same quality. Great for 4K.', container: 'mp4', codec: 'hevc', ext: 'mp4', kind: 'video' },
  { id: 'mp4-av1', label: 'MP4 · AV1', hint: 'Smallest files; slower to encode and not supported by every player yet.', container: 'mp4', codec: 'av1', ext: 'mp4', kind: 'video' },
  { id: 'webm-vp9', label: 'WebM · VP9', hint: 'Open format for the web.', container: 'webm', codec: 'vp9', ext: 'webm', kind: 'video' },
  { id: 'mov-avc', label: 'MOV · H.264', hint: 'QuickTime container for Apple workflows.', container: 'mov', codec: 'avc', ext: 'mov', kind: 'video' },
  { id: 'webm-alpha', label: 'WebM · VP9 with transparency', hint: 'Video with an alpha channel — overlays, lower thirds and titles for other editors and the web.', container: 'webm', codec: 'vp9', ext: 'webm', kind: 'video', alpha: true },
  { id: 'png-sequence', label: 'PNG image sequence', hint: 'One lossless PNG per frame (with transparency) in a new folder — for compositing and VFX tools.', container: 'png-sequence', codec: 'avc', ext: '', kind: 'sequence', alpha: true },
  { id: 'gif', label: 'Animated GIF', hint: 'Short silent loops for chat and docs. Keep it small and brief.', container: 'gif', codec: 'avc', ext: 'gif', kind: 'gif' },
  { id: 'mp3', label: 'MP3 audio', hint: 'Sound only.', container: 'mp3', codec: 'avc', ext: 'mp3', kind: 'audio' },
  { id: 'wav', label: 'WAV audio', hint: 'Uncompressed sound only.', container: 'wav', codec: 'avc', ext: 'wav', kind: 'audio' },
  { id: 'png', label: 'PNG — current frame', hint: 'A full-resolution still of the frame under the playhead.', container: 'png', codec: 'avc', ext: 'png', kind: 'image', alpha: true },
];

export const getFormat = (id: string): FormatOption => FORMATS.find((f) => f.id === id) ?? FORMATS[0];

/** Formats offered when "Transparent background" is on. */
export const ALPHA_FORMATS = FORMATS.filter((f) => f.alpha);

export interface CustomSettings {
  formatId: string;
  aspect: AspectId;
  /** Shorter side in pixels (0 = project). */
  shortSide: number;
  fps: number;
  quality: QualityLevel;
  hardware: ExportSettings['hardware'];
  fastStart: boolean;
  transparent: boolean;
}

export const defaultCustom = (project: Project): CustomSettings => ({
  formatId: 'mp4-avc',
  aspect: 'source',
  shortSide: 0,
  fps: project.settings.fps,
  quality: 'high',
  hardware: 'no-preference',
  fastStart: false,
  transparent: false,
});

/** The custom format actually used (transparency restricts the choice to alpha formats). */
export function customFormat(c: CustomSettings): FormatOption {
  const f = getFormat(c.formatId);
  if (c.transparent && !f.alpha) return ALPHA_FORMATS[0];
  return f;
}

export interface ExportOptions {
  /** Section of the project to export (seconds). */
  range: { start: number; end: number };
  /** Playhead, for the still-frame format. */
  time: number;
  audio: boolean;
  burnInCaptions: boolean;
  sidecars: SubtitleFormat[];
  embedSubtitles: boolean;
}

export interface PlannedTarget {
  /** 'custom' or a preset id. */
  key: string;
  label: string;
  /** Spec line, e.g. "1080 × 1920 · 30 fps · H.264 · 10 Mbps". */
  detail: string;
  /** e.g. "9:16". */
  aspect: string;
  /** File extension ('' for a folder). */
  ext: string;
  kind: 'file' | 'folder';
  /** Text added to the project name when several outputs share a folder, e.g. "TikTok 9x16". */
  suffix: string;
  /** Snapshot to render: the project itself, or a reframed copy for another aspect. */
  project: Project;
  settings: ExportSettings;
  /** Relative amount of work (frames × pixels). */
  weight: number;
  /** Whether the framing differs from the project (reframed). */
  reframed: boolean;
  /** Longest duration the platform accepts, when known. */
  maxDuration?: number;
}

const workWeight = (s: ExportSettings): number => {
  const frames = s.container === 'png' ? 1 : Math.max(1, Math.round((s.end - s.start) * s.fps));
  return frames * Math.max(0.25, (s.width * s.height) / (1920 * 1080));
};

/** Adapt the project to `width × height` when its aspect differs (same aspect: unchanged). */
export function adaptProject(project: Project, width: number, height: number): { project: Project; reframed: boolean } {
  if (sameAspect(width, height, project.settings)) return { project, reframed: false };
  return { project: reframeProject(project, width, height), reframed: true };
}

/** Plan one dialog entry (a preset id or 'custom'). Returns null for unknown presets. */
export function planTarget(project: Project, key: string, custom: CustomSettings, opts: ExportOptions): PlannedTarget | null {
  const subtitleOpts = { burnInCaptions: opts.burnInCaptions, sidecars: opts.sidecars, embedSubtitles: opts.embedSubtitles };
  if (key === 'custom') {
    const f = customFormat(custom);
    const isStill = f.kind === 'image';
    const isAudio = f.kind === 'audio';
    const frame = frameFor(custom.aspect, project.settings, custom.shortSide || undefined);
    const fps = f.kind === 'gif' ? Math.min(custom.fps, 30) : custom.fps;
    const settings: ExportSettings = {
      container: f.container,
      videoCodec: f.codec,
      width: frame.width,
      height: frame.height,
      fps,
      quality: custom.quality,
      audio: opts.audio,
      start: isStill ? opts.time : opts.range.start,
      end: isStill ? opts.time : opts.range.end,
      hardware: custom.hardware,
      fastStart: custom.fastStart,
      ...subtitleOpts,
    };
    if (f.alpha && (custom.transparent || f.kind === 'sequence')) settings.transparent = custom.transparent;
    const { project: adapted, reframed } = isAudio ? { project, reframed: false } : adaptProject(project, frame.width, frame.height);
    const detail = isAudio ? `${f.label} · ${f.container === 'mp3' ? 'MP3' : 'PCM 16-bit'}` : f.kind === 'gif' || f.kind === 'image' || f.kind === 'sequence' ? `${frame.width} × ${frame.height}${isStill ? '' : ` · ${fps} fps`} · ${f.label}` : specLine(settings);
    return {
      key,
      label: custom.transparent && f.alpha ? `${f.label}` : 'Custom',
      detail,
      aspect: isAudio ? '' : aspectName(frame.width, frame.height),
      ext: f.ext,
      kind: f.kind === 'sequence' ? 'folder' : 'file',
      suffix: f.kind === 'sequence' ? 'PNG sequence' : isAudio ? 'Audio' : custom.aspect === 'source' ? '' : aspectName(frame.width, frame.height).replace(':', 'x'),
      project: adapted,
      settings,
      weight: workWeight(settings),
      reframed,
    };
  }
  const preset = getPreset(key);
  if (!preset) return null;
  const settings: ExportSettings = { ...presetSettings(preset, project.settings, opts.range), audio: opts.audio, ...subtitleOpts };
  const { project: adapted, reframed } = adaptProject(project, settings.width, settings.height);
  return {
    key,
    label: preset.name,
    detail: specLine(settings),
    aspect: aspectName(settings.width, settings.height),
    ext: 'mp4',
    kind: 'file',
    suffix: outputSuffix(preset.name, settings.width, settings.height),
    project: adapted,
    settings,
    weight: workWeight(settings),
    reframed,
    maxDuration: preset.maxDuration,
  };
}

/** Output name for a target: "<project>.<ext>" alone, "<project> - <suffix>.<ext>" in a batch. */
export function outputName(projectName: string, t: Pick<PlannedTarget, 'ext' | 'suffix' | 'kind'>, batch: boolean): string {
  const base = projectName.trim() || 'Untitled';
  const name = batch || t.kind === 'folder' ? (t.suffix ? `${base} - ${t.suffix}` : base) : base;
  return t.ext ? `${name}.${t.ext}` : name;
}
