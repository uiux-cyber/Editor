/**
 * Platform export presets. Each preset fixes the frame shape (aspect), the resolution, a frame
 * rate cap, the codec / container and the bitrates a platform recommends. `presetSettings` turns
 * a preset into concrete ExportSettings for a project; the export dialog shows them as a gallery.
 *
 * Pure module (no DOM / GPU): unit tested in tests/export.test.ts.
 */

import type { VideoCodec } from 'mediabunny';
import type { ProjectSettings } from '@/core/types';
import type { ExportContainer, ExportSettings, QualityLevel } from './exporter';

/** Frame shapes offered for multi-aspect export. `source` keeps the project's own aspect. */
export type AspectId = 'source' | '16:9' | '9:16' | '1:1' | '4:5';

export const ASPECTS: { id: Exclude<AspectId, 'source'>; w: number; h: number; label: string }[] = [
  { id: '16:9', w: 16, h: 9, label: 'Landscape 16:9' },
  { id: '9:16', w: 9, h: 16, label: 'Vertical 9:16' },
  { id: '1:1', w: 1, h: 1, label: 'Square 1:1' },
  { id: '4:5', w: 4, h: 5, label: 'Portrait 4:5' },
];

export type PresetGroup = 'social' | 'video' | 'general';

export interface PlatformPreset {
  id: string;
  name: string;
  group: PresetGroup;
  /** Short description shown as a tooltip. */
  hint: string;
  aspect: AspectId;
  /**
   * Target frame. For fixed aspects: exact output pixels. For `source`: the length of the
   * shorter side (0 = the project's own resolution).
   */
  width: number;
  height: number;
  shortSide?: number;
  /** Frame rate cap; the project rate is used when it is lower. */
  fpsCap: number;
  container: ExportContainer;
  videoCodec: VideoCodec;
  /** Video bitrate (bits / s) at ≤ 30 fps and at > 30 fps. 0 = derive from `quality`. */
  bitrate: [number, number];
  quality: QualityLevel;
  /** Audio bitrate, bits / s. */
  audioBitrate: number;
  fastStart: boolean;
  /** Longest video the platform accepts (seconds); the dialog warns past it. */
  maxDuration?: number;
  /** Accent used to tint the tile's frame shape (not a logo). */
  tint: string;
}

const MBPS = 1_000_000;

export const PLATFORM_PRESETS: PlatformPreset[] = [
  // ---- Video platforms ------------------------------------------------------------------------
  {
    id: 'youtube-1080p',
    name: 'YouTube 1080p',
    group: 'video',
    hint: 'Full HD upload with the bitrate YouTube recommends for SDR video.',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fpsCap: 60,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [10 * MBPS, 15 * MBPS],
    quality: 'high',
    audioBitrate: 192000,
    fastStart: true,
    tint: '#ff4e45',
  },
  {
    id: 'youtube-4k',
    name: 'YouTube 4K',
    group: 'video',
    hint: 'Ultra HD 2160p. YouTube gives 4K uploads its highest-quality encodes.',
    aspect: '16:9',
    width: 3840,
    height: 2160,
    fpsCap: 60,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [40 * MBPS, 60 * MBPS],
    quality: 'best',
    audioBitrate: 192000,
    fastStart: true,
    tint: '#ff4e45',
  },
  // ---- Social --------------------------------------------------------------------------------
  {
    id: 'youtube-shorts',
    name: 'YouTube Shorts',
    group: 'social',
    hint: 'Vertical 9:16, up to 3 minutes.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fpsCap: 60,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [10 * MBPS, 15 * MBPS],
    quality: 'high',
    audioBitrate: 192000,
    fastStart: true,
    maxDuration: 180,
    tint: '#ff4e45',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    group: 'social',
    hint: 'Vertical 9:16 full HD. Keep text inside the safe zones.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fpsCap: 60,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [10 * MBPS, 15 * MBPS],
    quality: 'high',
    audioBitrate: 192000,
    fastStart: true,
    maxDuration: 600,
    tint: '#25f4ee',
  },
  {
    id: 'instagram-reels',
    name: 'Instagram Reels',
    group: 'social',
    hint: 'Vertical 9:16 at 30 fps, up to 3 minutes.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fpsCap: 30,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [8 * MBPS, 8 * MBPS],
    quality: 'high',
    audioBitrate: 128000,
    fastStart: true,
    maxDuration: 180,
    tint: '#e1306c',
  },
  {
    id: 'instagram-portrait',
    name: 'Instagram feed 4:5',
    group: 'social',
    hint: 'Portrait feed post — takes the most screen space in the feed.',
    aspect: '4:5',
    width: 1080,
    height: 1350,
    fpsCap: 30,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [8 * MBPS, 8 * MBPS],
    quality: 'high',
    audioBitrate: 128000,
    fastStart: true,
    maxDuration: 3600,
    tint: '#e1306c',
  },
  {
    id: 'instagram-square',
    name: 'Instagram feed 1:1',
    group: 'social',
    hint: 'Square feed post.',
    aspect: '1:1',
    width: 1080,
    height: 1080,
    fpsCap: 30,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [8 * MBPS, 8 * MBPS],
    quality: 'high',
    audioBitrate: 128000,
    fastStart: true,
    maxDuration: 3600,
    tint: '#e1306c',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    group: 'social',
    hint: 'Landscape full HD for feed and page videos.',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fpsCap: 60,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [8 * MBPS, 12 * MBPS],
    quality: 'high',
    audioBitrate: 128000,
    fastStart: true,
    tint: '#1877f2',
  },
  {
    id: 'x',
    name: 'X',
    group: 'social',
    hint: 'Landscape full HD, up to 2 min 20 s for most accounts.',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fpsCap: 60,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [8 * MBPS, 12 * MBPS],
    quality: 'high',
    audioBitrate: 128000,
    fastStart: true,
    maxDuration: 140,
    tint: '#e7e9ea',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    group: 'social',
    hint: 'Landscape full HD at 30 fps, up to 10 minutes.',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fpsCap: 30,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [8 * MBPS, 8 * MBPS],
    quality: 'high',
    audioBitrate: 192000,
    fastStart: true,
    maxDuration: 600,
    tint: '#0a66c2',
  },
  // ---- General -------------------------------------------------------------------------------
  {
    id: 'master',
    name: 'Master (high quality)',
    group: 'general',
    hint: 'Project size and frame rate at a very high bitrate — for archiving or further editing.',
    aspect: 'source',
    width: 0,
    height: 0,
    shortSide: 0,
    fpsCap: 240,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [0, 0],
    quality: 'best',
    audioBitrate: 192000,
    fastStart: false,
    tint: '#9d85ff',
  },
  {
    id: 'web-small',
    name: 'Small file (web)',
    group: 'general',
    hint: '720p at 30 fps with a modest bitrate — quick to upload, email or embed.',
    aspect: 'source',
    width: 0,
    height: 0,
    shortSide: 720,
    fpsCap: 30,
    container: 'mp4',
    videoCodec: 'avc',
    bitrate: [2.5 * MBPS, 2.5 * MBPS],
    quality: 'low',
    audioBitrate: 128000,
    fastStart: true,
    tint: '#34d399',
  },
];

export const PRESET_GROUPS: { id: PresetGroup; label: string }[] = [
  { id: 'social', label: 'Social' },
  { id: 'video', label: 'Video platforms' },
  { id: 'general', label: 'General' },
];

export const getPreset = (id: string): PlatformPreset | undefined => PLATFORM_PRESETS.find((p) => p.id === id);

export const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Width / height ratio of an aspect (source = the project's own). */
export function aspectRatio(aspect: AspectId, project: Pick<ProjectSettings, 'width' | 'height'>): number {
  if (aspect === 'source') return project.width / project.height;
  const a = ASPECTS.find((x) => x.id === aspect)!;
  return a.w / a.h;
}

/** Whether a frame of `w × h` has (about) the same shape as the project. */
export function sameAspect(w: number, h: number, project: Pick<ProjectSettings, 'width' | 'height'>): boolean {
  return Math.abs(w / h - project.width / project.height) < 0.01;
}

/** Name of the closest standard aspect, e.g. '9:16' (falls back to W:H). */
export function aspectName(w: number, h: number): string {
  const r = w / h;
  for (const a of ASPECTS) if (Math.abs(r - a.w / a.h) < 0.01) return a.id;
  if (Math.abs(r - 21 / 9) < 0.02) return '21:9';
  if (Math.abs(r - 4 / 3) < 0.01) return '4:3';
  return `${Math.round(r * 100) / 100}:1`;
}

/**
 * Output size for an aspect. Fixed aspects keep the project's shorter-side resolution (at least
 * `minShort`); `shortSide` overrides it.
 */
export function frameFor(aspect: AspectId, project: Pick<ProjectSettings, 'width' | 'height'>, shortSide?: number): { width: number; height: number } {
  const short = shortSide && shortSide > 0 ? shortSide : Math.min(project.width, project.height);
  const r = aspectRatio(aspect, project);
  return r >= 1 ? { width: even(short * r), height: even(short) } : { width: even(short), height: even(short / r) };
}

/** Resolution of a preset for a project. */
export function presetFrame(preset: PlatformPreset, project: Pick<ProjectSettings, 'width' | 'height'>): { width: number; height: number } {
  if (preset.aspect !== 'source') return { width: preset.width, height: preset.height };
  return frameFor('source', project, preset.shortSide || undefined);
}

/** Frame rate for a preset: the project rate, capped. */
export const presetFps = (preset: PlatformPreset, projectFps: number): number => Math.min(projectFps, preset.fpsCap);

/** Concrete export settings for a preset (range and caption options are added by the caller). */
export function presetSettings(preset: PlatformPreset, project: Pick<ProjectSettings, 'width' | 'height' | 'fps'>, range: { start: number; end: number }): ExportSettings {
  const { width, height } = presetFrame(preset, project);
  const fps = presetFps(preset, project.fps);
  const bitrate = fps > 30 ? preset.bitrate[1] : preset.bitrate[0];
  const settings: ExportSettings = {
    container: preset.container,
    videoCodec: preset.videoCodec,
    width,
    height,
    fps,
    quality: preset.quality,
    audio: true,
    start: range.start,
    end: range.end,
    hardware: 'no-preference',
    fastStart: preset.fastStart,
    audioBitrate: preset.audioBitrate,
  };
  if (bitrate > 0) settings.videoBitrate = bitrate;
  else if (preset.id === 'master') {
    // Master: about 0.3 bits per pixel — visually lossless H.264 for re-editing.
    settings.videoBitrate = Math.round(Math.min(120e6, Math.max(8e6, width * height * Math.min(60, fps) * 0.3)));
  }
  return settings;
}

const codecLabel: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', vp8: 'VP8' };

/** One-line spec, e.g. "1080 × 1920 · 30 fps · H.264 · 8 Mbps". */
export function specLine(s: Pick<ExportSettings, 'width' | 'height' | 'fps' | 'videoCodec' | 'container'> & { videoBitrate?: number }): string {
  const parts = [`${s.width} × ${s.height}`, `${Math.round(s.fps * 100) / 100} fps`, codecLabel[s.videoCodec] ?? s.videoCodec.toUpperCase()];
  if (s.videoBitrate) parts.push(`${Math.round(s.videoBitrate / 100_000) / 10} Mbps`);
  return parts.join(' · ');
}

/** Spec line of a preset for display in the gallery (project-dependent for source-aspect presets). */
export function presetSpec(preset: PlatformPreset, project: Pick<ProjectSettings, 'width' | 'height' | 'fps'>): string {
  const s = presetSettings(preset, project, { start: 0, end: 0 });
  return specLine(s);
}

/** A file-name friendly label for a preset output, e.g. "YouTube Shorts 9x16", "Instagram feed 4x5". */
export function outputSuffix(name: string, width: number, height: number): string {
  const aspect = aspectName(width, height);
  const clean = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const label = clean.includes(aspect) ? clean : `${clean} ${aspect}`;
  return label.replace(/:/g, 'x').replace(/[<>"/\\|?*]/g, '').replace(/\s+/g, ' ');
}
