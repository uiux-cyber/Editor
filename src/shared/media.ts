/**
 * Performance & media helpers shared by the main process, the renderer and the unit tests:
 * app-owned storage folders and FFmpeg argument building / output parsing. Pure — no runtime
 * imports — so every side can include it.
 */

/** App-owned media folders inside userData. Files are written only by src/main/handlers/media.ts. */
export const MEDIA_FOLDERS = ['proxies', 'cache', 'converted'] as const;
export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

export interface FolderUsage {
  folder: MediaFolder;
  path: string;
  files: number;
  bytes: number;
}

export interface StoredFile {
  name: string;
  size: number;
  mtimeMs: number;
}

/** File-name-safe stem (keeps letters, digits, dot, dash, underscore). */
export function safeStem(name: string, max = 48): string {
  const stem = String(name ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, max);
  return stem || 'media';
}

/** 53-bit string hash (cyrb53) as 14 hex chars. Fast, deterministic, good dispersion. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

// ---------------------------------------------------------------------------------------------
// FFmpeg
// ---------------------------------------------------------------------------------------------

export interface FfmpegInfo {
  found: boolean;
  path: string | null;
  /** 'custom' = chosen by the user, 'path' = found on PATH. */
  source: 'custom' | 'path' | null;
  version: string | null;
  /** Encoders relevant to the intermediate formats. */
  encoders: string[];
  error?: string;
}

export type IntermediateCodec = 'h264' | 'hevc';

export interface FfmpegConvertOptions {
  codec: IntermediateCodec;
  /** Keep 10-bit precision (HEVC Main10) when the source has it. */
  tenBit?: boolean;
  /** Target video bitrate in bits/s, used by hardware encoders (software encoders use CRF). */
  videoBitrate: number;
  audioBitrate: number;
}

export interface FfmpegProgress {
  /** Seconds of output written so far. */
  outTime: number;
  /** Encoding speed relative to real time (e.g. 2.5 = 2.5×), when known. */
  speed: number | null;
  frame: number | null;
  fps: number | null;
  /** True on the final block (`progress=end`). */
  done: boolean;
}

const H264_ENCODERS = ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf'];
const HEVC_ENCODERS = ['libx265', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_mf'];
export const RELEVANT_ENCODERS = [...H264_ENCODERS, ...HEVC_ENCODERS, 'aac'];

/** Best available encoder for an intermediate codec, or null. */
export function pickEncoder(codec: IntermediateCodec, available: readonly string[]): string | null {
  const list = codec === 'hevc' ? HEVC_ENCODERS : H264_ENCODERS;
  return list.find((e) => available.includes(e)) ?? null;
}

/**
 * FFmpeg arguments (an argv array — never joined into a shell string) converting `src` into a
 * high-quality intermediate MP4 at `out`. Only the first video and audio streams are kept.
 */
export function buildFfmpegArgs(src: string, out: string, opts: FfmpegConvertOptions, available: readonly string[]): string[] {
  const enc = pickEncoder(opts.codec, available);
  if (!enc) throw new Error(`FFmpeg has no ${opts.codec === 'hevc' ? 'HEVC' : 'H.264'} encoder.`);
  const tenBit = opts.codec === 'hevc' && !!opts.tenBit;
  const kbps = `${Math.round(opts.videoBitrate / 1000)}k`;
  const args = ['-hide_banner', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0', '-sn', '-dn'];
  // 4:2:0 needs even dimensions.
  args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', enc);
  if (enc === 'libx264') args.push('-preset', 'medium', '-crf', '14', '-profile:v', 'high');
  else if (enc === 'libx265') args.push('-preset', 'medium', '-crf', '16', '-profile:v', tenBit ? 'main10' : 'main');
  else args.push('-b:v', kbps, '-maxrate', kbps, '-bufsize', `${Math.round((opts.videoBitrate * 2) / 1000)}k`);
  if (enc.endsWith('nvenc')) args.push('-preset', 'p5');
  args.push('-pix_fmt', tenBit ? (enc === 'libx265' ? 'yuv420p10le' : 'p010le') : 'yuv420p');
  if (opts.codec === 'hevc') args.push('-tag:v', 'hvc1');
  args.push('-g', '30');
  args.push('-c:a', 'aac', '-b:a', `${Math.round(opts.audioBitrate / 1000)}k`);
  args.push('-movflags', '+faststart', '-f', 'mp4', out);
  return args;
}

/** Total duration (seconds) announced by FFmpeg on stderr ("Duration: 00:01:02.50"), if present. */
export function parseFfmpegDuration(text: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(s) && s > 0 ? s : null;
}

/** "ffmpeg version 7.1-full_build-www.gyan.dev Copyright …" → "7.1-full_build-www.gyan.dev". */
export function parseFfmpegVersion(text: string): string | null {
  const m = /ffmpeg version (\S+)/i.exec(text);
  return m ? m[1] : null;
}

/** Encoder names listed by `ffmpeg -encoders` (lines like " V....D libx264   libx264 H.264"). */
export function parseEncoders(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([VAS][.FXSBD]{5})\s+(\S+)/.exec(line);
    if (m && m[2] !== '=') out.push(m[2]);
  }
  return out;
}

function timeToSeconds(v: string): number | null {
  const m = /^(-?\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Incremental parser for `-progress pipe:1` output: key=value lines, one block per update,
 * each terminated by `progress=continue` or `progress=end`. Chunks may split lines anywhere.
 */
export class FfmpegProgressParser {
  private partial = '';
  private block: Record<string, string> = {};

  push(chunk: string): FfmpegProgress[] {
    const out: FfmpegProgress[] = [];
    const lines = (this.partial + chunk).split(/\r?\n/);
    this.partial = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      this.block[key] = value;
      if (key === 'progress') {
        out.push(this.toProgress(value === 'end'));
        this.block = {};
      }
    }
    return out;
  }

  private toProgress(done: boolean): FfmpegProgress {
    const b = this.block;
    let outTime: number | null = null;
    // out_time_us and (despite its name) out_time_ms are both microseconds.
    for (const k of ['out_time_us', 'out_time_ms']) {
      const n = Number(b[k]);
      if (b[k] !== undefined && b[k] !== 'N/A' && Number.isFinite(n)) {
        outTime = n / 1e6;
        break;
      }
    }
    if (outTime === null && b.out_time) outTime = timeToSeconds(b.out_time);
    const speedM = /^([\d.]+)x$/.exec(b.speed ?? '');
    const frame = Number(b.frame);
    const fps = Number(b.fps);
    return {
      outTime: Math.max(0, outTime ?? 0),
      speed: speedM ? Number(speedM[1]) : null,
      frame: Number.isFinite(frame) && b.frame !== undefined ? frame : null,
      fps: Number.isFinite(fps) && b.fps !== undefined ? fps : null,
      done,
    };
  }
}

/** 0..1 completion from a progress block and the total duration. */
export function progressRatio(p: FfmpegProgress, duration: number | null): number {
  if (p.done) return 1;
  if (!duration || duration <= 0) return 0;
  return Math.min(0.999, Math.max(0, p.outTime / duration));
}

/** First `ffmpeg.exe` (or `exe`) on a Windows PATH string, using `exists` to test candidates. */
export function findOnPath(pathEnv: string, exe: string, exists: (p: string) => boolean): string | null {
  for (const dir of String(pathEnv ?? '').split(';')) {
    const d = dir.trim().replace(/^"(.*)"$/, '$1');
    if (!d) continue;
    const candidate = d.replace(/[\\/]+$/, '') + '\\' + exe;
    if (exists(candidate)) return candidate;
  }
  return null;
}

export const FFMPEG_INSTALL_URL = 'https://ffmpeg.org/download.html#build-windows';
