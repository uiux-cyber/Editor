import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { makeEffect, makeGenerator, makeText, makeTrack, makeVideo } from '@/core/factory';
import { createProject, projectDuration } from '@/core/project';
import type { MediaAsset, Project } from '@/core/types';
import { HEAVY_COST, cacheRenderSize, computeSegments, frameCost, stableStringify } from '@/engine/cache/keys';
import { OPERATOR_INDEX, SDR_WHITE_NITS, TONE_MAP_OPERATORS, hlgDecode, pqDecode, pqEncode, srgbEncode, toneMap, type ToneMapOperator } from '@/engine/gl/hdrMath';
import { averageMbps, isHevc10Bit, proxyBitrate, proxyDimensions, proxyEligibility, proxyFileName } from '@/engine/media/proxyRules';
import { FfmpegProgressParser, buildFfmpegArgs, findOnPath, parseEncoders, parseFfmpegDuration, parseFfmpegVersion, pickEncoder, progressRatio, safeStem } from '@shared/media';

const video = (over: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'as_v',
  kind: 'video',
  name: 'clip.mp4',
  source: { type: 'file', path: 'C:/media/clip.mp4' },
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 10 * 1024 * 1024 * 3, // ~25 Mbit/s over 10 s
  videoCodec: 'avc',
  addedAt: 0,
  ...over,
});

const RULES = { minShortSide: 1440, minMbps: 60, hevc10: true };

// ---------------------------------------------------------------------------------------------
// Proxies
// ---------------------------------------------------------------------------------------------

describe('proxy eligibility', () => {
  it('flags 1440p and above, by the shorter side', () => {
    expect(proxyEligibility(video(), RULES).eligible).toBe(false);
    const qhd = proxyEligibility(video({ width: 2560, height: 1440 }), RULES);
    expect(qhd.eligible).toBe(true);
    expect(qhd.reasons).toContain('1440p');
    expect(proxyEligibility(video({ width: 3840, height: 2160 }), RULES).reasons).toContain('2160p');
    // Vertical 1440p phone footage counts too; a 2560-wide 1080-tall clip does not.
    expect(proxyEligibility(video({ width: 1440, height: 2560 }), RULES).eligible).toBe(true);
    expect(proxyEligibility(video({ width: 2560, height: 1080 }), RULES).eligible).toBe(false);
  });

  it('flags high average bitrates', () => {
    const heavy = video({ size: (80e6 / 8) * 10 }); // 80 Mbit/s for 10 s
    expect(averageMbps(heavy)).toBeCloseTo(80, 5);
    const e = proxyEligibility(heavy, RULES);
    expect(e.eligible).toBe(true);
    expect(e.reasons).toEqual(['80 Mbit/s']);
    expect(proxyEligibility(heavy, { ...RULES, minMbps: 0 }).eligible).toBe(false);
  });

  it('flags 10-bit HEVC whatever its size', () => {
    expect(isHevc10Bit('hvc1.2.4.L153.B0')).toBe(true);
    expect(isHevc10Bit('hev1.2.4.L120.90')).toBe(true);
    expect(isHevc10Bit('hvc1.1.6.L120.90')).toBe(false); // Main (8-bit)
    expect(isHevc10Bit('avc1.640028')).toBe(false);
    expect(isHevc10Bit(null)).toBe(false);
    const phone = video({ videoCodec: 'hevc' });
    expect(proxyEligibility(phone, RULES, 'hvc1.2.4.L153.B0').reasons).toEqual(['10-bit HEVC']);
    expect(proxyEligibility(phone, RULES, 'hvc1.1.6.L153.B0').eligible).toBe(false);
    expect(proxyEligibility(phone, { ...RULES, hevc10: false }, 'hvc1.2.4.L153.B0').eligible).toBe(false);
  });

  it('never proxies audio, images or generated media', () => {
    expect(proxyEligibility(video({ kind: 'audio', hasVideo: false, width: 4000, height: 4000 }), RULES).eligible).toBe(false);
    expect(proxyEligibility(video({ kind: 'image', width: 6000, height: 4000 }), RULES).eligible).toBe(false);
    expect(proxyEligibility(video({ source: { type: 'generated', soundId: 'x' }, width: 4000, height: 4000 }), RULES).eligible).toBe(false);
  });

  it('sizes proxies by the shorter side, even, never upscaled', () => {
    expect(proxyDimensions(3840, 2160, 540)).toEqual({ width: 960, height: 540 });
    expect(proxyDimensions(2160, 3840, 540)).toEqual({ width: 540, height: 960 });
    expect(proxyDimensions(2560, 1440, 720)).toEqual({ width: 1280, height: 720 });
    expect(proxyDimensions(4096, 2160, 540)).toEqual({ width: 1024, height: 540 });
    expect(proxyDimensions(640, 360, 540)).toEqual({ width: 640, height: 360 });
    const odd = proxyDimensions(1999, 1125, 540);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
    expect(proxyBitrate(960, 540, 30)).toBeGreaterThan(1.5e6);
    expect(proxyBitrate(960, 540, 30)).toBeLessThan(4e6);
  });

  it('names proxy files stably per source and size', () => {
    const a = video({ width: 3840, height: 2160 });
    expect(proxyFileName(a, 540)).toBe(proxyFileName(video({ id: 'other', width: 3840, height: 2160 }), 540));
    expect(proxyFileName(a, 540)).not.toBe(proxyFileName(a, 720));
    expect(proxyFileName(a, 540)).not.toBe(proxyFileName({ ...a, source: { type: 'file', path: 'C:/media/other.mp4' } }, 540));
    expect(proxyFileName({ ...a, source: { type: 'file', path: 'C:/MEDIA/CLIP.MP4' } }, 540)).toBe(proxyFileName(a, 540));
    expect(proxyFileName(a, 540)).toMatch(/^clip-540p-[0-9a-f]{12}\.mp4$/);
    expect(safeStem('../..\\evil name?.mov')).toBe('evil_name');
  });
});

// ---------------------------------------------------------------------------------------------
// Render cache keys
// ---------------------------------------------------------------------------------------------

/** 6 s project: background 0–6 s, title 2–3 s on its own track, video 4–6 s. */
function cacheProject(): Project {
  const p = createProject({ width: 1920, height: 1080, fps: 30 });
  const v1 = p.tracks[0];
  const v2 = makeTrack('visual', 'V2');
  const v3 = makeTrack('visual', 'V3');
  p.tracks.unshift(v3, v2);
  const asset = video();
  p.assets[asset.id] = asset;
  const bg = makeGenerator('aurora', { start: 0, duration: 6, effects: [makeEffect('glow')] });
  const title = makeText('Hello', { start: 2, duration: 1 });
  const clip = makeVideo(asset, { start: 4, duration: 2 });
  bg.trackId = v1.id;
  title.trackId = v2.id;
  clip.trackId = v3.id;
  for (const c of [bg, title, clip]) p.clips[c.id] = c;
  return p;
}

const size = { width: 1280, height: 720 };
const keysOf = (p: Project, s = size): (string | null)[] => computeSegments(p, { size: s, salt: 'test' }, projectDuration(p)).map((x) => x.key);
const changed = (a: (string | null)[], b: (string | null)[]): number[] => a.map((k, i) => (k !== b[i] ? i : -1)).filter((i) => i >= 0);

describe('render cache keys', () => {
  it('cuts the timeline into one-second segments with deterministic keys', () => {
    const p = cacheProject();
    const segs = computeSegments(p, { size, salt: 'test' }, projectDuration(p));
    expect(segs.map((s) => [s.start, s.end, s.frames])).toEqual([0, 1, 2, 3, 4, 5].map((i) => [i, i + 1, 30]));
    expect(new Set(segs.map((s) => s.key)).size).toBe(6);
    // A structurally identical copy (fresh objects, other key order) hashes the same.
    const copy = JSON.parse(JSON.stringify(p)) as Project;
    expect(keysOf(copy)).toEqual(keysOf(p));
  });

  it('invalidates exactly the segments an edit touches', () => {
    const p = cacheProject();
    const before = keysOf(p);
    const titleId = Object.values(p.clips).find((c) => c.type === 'text')!.id;
    const edited = produce(p, (d) => {
      const t = d.clips[titleId];
      if (t.type === 'text') t.text.content = 'Changed';
    });
    expect(changed(before, keysOf(edited))).toEqual([2]);

    const videoId = Object.values(p.clips).find((c) => c.type === 'video')!.id;
    const graded = produce(p, (d) => {
      const v = d.clips[videoId];
      if (v.type === 'video') v.adjust = { exposure: 0.5 };
    });
    expect(changed(before, keysOf(graded))).toEqual([4, 5]);

    const bgId = Object.values(p.clips).find((c) => c.type === 'generator')!.id;
    const fx = produce(p, (d) => {
      const g = d.clips[bgId];
      if (g.type === 'generator') g.effects[0].params.radius = 40;
    });
    expect(changed(before, keysOf(fx))).toEqual([0, 1, 2, 3, 4, 5]);

    // Moving the title by half a second touches the seconds it leaves and enters.
    const moved = produce(p, (d) => void (d.clips[titleId].start = 2.5));
    expect(changed(before, keysOf(moved))).toEqual([2, 3]);
  });

  it('ignores things that do not change pixels', () => {
    const p = cacheProject();
    const before = keysOf(p);
    const meta = produce(p, (d) => {
      d.name = 'Renamed';
      d.markers.push({ id: 'm', time: 1, label: 'x', color: '#fff' });
      d.assets.as_v.proxy = { path: 'C:/proxies/clip.mp4', width: 960, height: 540 };
      d.tracks[0].name = 'Titles';
    });
    expect(keysOf(meta)).toEqual(before);
    // A muted (audio-only) change on the video clip also leaves picture keys alone? No: the clip
    // object is part of the key, so even its volume invalidates — conservative but correct.
    const vol = produce(p, (d) => {
      const v = Object.values(d.clips).find((c) => c.type === 'video')!;
      if (v.type === 'video') v.volume = 0.5;
    });
    expect(changed(before, keysOf(vol))).toEqual([4, 5]);
  });

  it('includes track visibility, stacking order, the media file and the render size', () => {
    const p = cacheProject();
    const before = keysOf(p);
    const hidden = produce(p, (d) => void (d.tracks[1].hidden = true)); // the title's track
    expect(changed(before, keysOf(hidden))).toEqual([2]);
    const relinked = produce(p, (d) => {
      d.assets.as_v.source = { type: 'file', path: 'C:/media/new.mp4' };
    });
    expect(changed(before, keysOf(relinked))).toEqual([4, 5]);
    const reordered = produce(p, (d) => {
      const [a, b] = [d.tracks[0], d.tracks[2]];
      d.tracks[0] = b;
      d.tracks[2] = a;
    });
    expect(changed(before, keysOf(reordered))).toEqual([2, 4, 5]);
    expect(changed(before, keysOf(p, { width: 1920, height: 1080 }))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(keysOf(produce(p, (d) => void (d.settings.background = '#ffffff')))).not.toContain(before[0]);
  });

  it('leaves empty segments without a key', () => {
    const p = cacheProject();
    const gap = produce(p, (d) => {
      for (const c of Object.values(d.clips)) if (c.type === 'generator') c.duration = 2;
      for (const c of Object.values(d.clips)) if (c.type === 'text') c.start = 0;
    });
    const keys = keysOf(gap);
    expect(keys[2]).toBeNull();
    expect(keys[3]).toBeNull();
    expect(keys[4]).not.toBeNull();
  });

  it('estimates heavy frames and picks the cache resolution', () => {
    const p = cacheProject();
    expect(frameCost(p, 2.5)).toBeLessThan(HEAVY_COST);
    const heavy = produce(p, (d) => {
      for (const c of Object.values(d.clips)) if (c.type === 'generator') c.effects = ['lens-blur', 'glow', 'box-blur', 'god-rays'].map((id) => makeEffect(id));
    });
    expect(frameCost(heavy, 0.5)).toBeGreaterThanOrEqual(HEAVY_COST);
    expect(cacheRenderSize(3840, 2160, 1)).toEqual({ width: 1920, height: 1080 });
    expect(cacheRenderSize(1920, 1080, 0.5)).toEqual({ width: 960, height: 540 });
    expect(cacheRenderSize(1080, 1920, 1)).toEqual({ width: 1080, height: 1920 });
    expect(stableStringify({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
  });
});

// ---------------------------------------------------------------------------------------------
// FFmpeg
// ---------------------------------------------------------------------------------------------

describe('ffmpeg helpers', () => {
  it('parses -progress output across arbitrary chunk boundaries', () => {
    const text = [
      'frame=48',
      'fps=24.0',
      'out_time_us=2000000',
      'out_time_ms=2000000',
      'out_time=00:00:02.000000',
      'speed=1.5x',
      'progress=continue',
      'frame=120',
      'out_time_us=N/A',
      'out_time=00:00:05.500000',
      'speed=N/A',
      'progress=end',
      '',
    ].join('\r\n');
    for (const cut of [1, 7, 33, 64]) {
      const parser = new FfmpegProgressParser();
      const out = [...parser.push(text.slice(0, cut)), ...parser.push(text.slice(cut))];
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({ outTime: 2, speed: 1.5, frame: 48, fps: 24, done: false });
      expect(out[1].outTime).toBeCloseTo(5.5, 6);
      expect(out[1].speed).toBeNull();
      expect(out[1].done).toBe(true);
    }
    expect(progressRatio({ outTime: 2, speed: 1, frame: 1, fps: 1, done: false }, 8)).toBeCloseTo(0.25, 6);
    expect(progressRatio({ outTime: 9, speed: 1, frame: 1, fps: 1, done: false }, 8)).toBeLessThan(1);
    expect(progressRatio({ outTime: 0, speed: 1, frame: 1, fps: 1, done: true }, null)).toBe(1);
    expect(progressRatio({ outTime: 3, speed: 1, frame: 1, fps: 1, done: false }, null)).toBe(0);
  });

  it('reads the banner: duration, version and encoders', () => {
    expect(parseFfmpegDuration("Input #0, mov,mp4, from 'a.mov':\n  Duration: 01:02:03.50, start: 0.000000, bitrate: 1 kb/s")).toBeCloseTo(3723.5, 6);
    expect(parseFfmpegDuration('  Duration: N/A, bitrate: N/A')).toBeNull();
    expect(parseFfmpegVersion('ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024')).toBe('7.1-full_build-www.gyan.dev');
    expect(parseFfmpegVersion('something else')).toBeNull();
    const enc = parseEncoders('Encoders:\n V..... = Video\n ------\n V....D libx264              libx264 H.264\n VF.... h264_nvenc   NVIDIA\n A....D aac                  AAC\n');
    expect(enc).toEqual(['libx264', 'h264_nvenc', 'aac']);
    expect(pickEncoder('h264', ['h264_mf', 'libx264'])).toBe('libx264');
    expect(pickEncoder('hevc', ['hevc_nvenc', 'libx264'])).toBe('hevc_nvenc');
    expect(pickEncoder('hevc', ['libx264'])).toBeNull();
  });

  it('builds an argv array (never a shell string) for the intermediate', () => {
    const src = 'C:\\Footage\\shot 01 "final".mov';
    const out = 'C:\\Users\\me\\AppData\\Roaming\\Kinora\\converted\\shot.mp4.part';
    const args = buildFfmpegArgs(src, out, { codec: 'h264', videoBitrate: 60e6, audioBitrate: 320e3 }, ['libx264', 'aac']);
    // Paths stay single, unquoted arguments.
    expect(args[args.indexOf('-i') + 1]).toBe(src);
    expect(args[args.length - 1]).toBe(out);
    expect(args).toEqual(expect.arrayContaining(['-progress', 'pipe:1', '-nostdin', '-y', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-f', 'mp4']));
    expect(args.join(' ')).toContain('-map 0:v:0 -map 0:a:0?');
    const hw = buildFfmpegArgs(src, out, { codec: 'hevc', tenBit: true, videoBitrate: 40e6, audioBitrate: 256e3 }, ['hevc_nvenc']);
    expect(hw).toEqual(expect.arrayContaining(['-c:v', 'hevc_nvenc', '-b:v', '40000k', '-pix_fmt', 'p010le', '-tag:v', 'hvc1']));
    const x265 = buildFfmpegArgs(src, out, { codec: 'hevc', tenBit: true, videoBitrate: 40e6, audioBitrate: 256e3 }, ['libx265']);
    expect(x265).toEqual(expect.arrayContaining(['-profile:v', 'main10', '-pix_fmt', 'yuv420p10le']));
    expect(() => buildFfmpegArgs(src, out, { codec: 'hevc', videoBitrate: 1e6, audioBitrate: 1e5 }, ['libx264'])).toThrow(/HEVC/);
  });

  it('finds ffmpeg.exe on a Windows PATH', () => {
    const files = new Set(['D:\\tools\\ffmpeg\\bin\\ffmpeg.exe']);
    const exists = (p: string): boolean => files.has(p);
    expect(findOnPath('C:\\Windows;"D:\\tools\\ffmpeg\\bin\\";C:\\other', 'ffmpeg.exe', exists)).toBe('D:\\tools\\ffmpeg\\bin\\ffmpeg.exe');
    expect(findOnPath('C:\\Windows;;C:\\other', 'ffmpeg.exe', exists)).toBeNull();
    expect(findOnPath('', 'ffmpeg.exe', exists)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// HDR tone mapping
// ---------------------------------------------------------------------------------------------

describe('HDR tone mapping', () => {
  it('round-trips the PQ and sRGB transfer functions', () => {
    for (const nits of [0.01, 1, 100, 203, 1000, 4000, 10000]) expect(pqDecode(pqEncode(nits)) / nits).toBeCloseTo(1, 6);
    expect(pqEncode(10000)).toBeCloseTo(1, 6);
    expect(pqEncode(100)).toBeCloseTo(0.5081, 3);
    expect(pqEncode(SDR_WHITE_NITS)).toBeCloseTo(0.5806, 3);
    expect(hlgDecode(0.5)).toBeCloseTo(1 / 12, 6);
    expect(hlgDecode(1)).toBeCloseTo(1, 3);
    expect(srgbEncode(0)).toBe(0);
    expect(srgbEncode(1)).toBeCloseTo(1, 6);
  });

  const ops = TONE_MAP_OPERATORS.map((o) => o.id);

  it('every operator is monotonic, starts at black and stays in 0..1', () => {
    expect(ops.sort()).toEqual((Object.keys(OPERATOR_INDEX) as ToneMapOperator[]).sort());
    for (const op of ops) {
      for (const peakNits of [400, 1000, 4000, 10000]) {
        const peak = peakNits / SDR_WHITE_NITS;
        expect(toneMap(op, 0, peak)).toBeCloseTo(0, 6);
        let prev = -1;
        for (let i = 0; i <= 400; i++) {
          const x = (i / 400) * peak * 1.5;
          const y = toneMap(op, x, peak);
          expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
          prev = y;
        }
      }
    }
  });

  it('compresses highlights into SDR while keeping mid-tones', () => {
    const peak = 1000 / SDR_WHITE_NITS;
    // The source peak reaches (or nearly reaches) SDR white with the highlight-aware operators.
    for (const op of ['reinhard', 'hable', 'bt2390'] as ToneMapOperator[]) expect(toneMap(op, peak, peak)).toBeGreaterThan(0.97);
    // BT.2390 leaves dark and mid tones alone (below the knee) and compresses only highlights.
    expect(toneMap('bt2390', 0.05, peak)).toBeCloseTo(0.05, 3);
    expect(toneMap('bt2390', 0.3, peak)).toBeCloseTo(0.3, 2);
    expect(toneMap('bt2390', 1, peak)).toBeLessThan(1);
    expect(toneMap('bt2390', 1, peak)).toBeGreaterThan(0.75);
    // Clip saturates at SDR white; others keep detail above it.
    expect(toneMap('clip', 2, peak)).toBe(1);
    expect(toneMap('hable', 2, peak)).toBeLessThan(toneMap('hable', 4, peak));
    // A brighter mastering peak maps a fixed highlight darker (more room above it).
    expect(toneMap('reinhard', 2, 4000 / SDR_WHITE_NITS)).toBeLessThan(toneMap('reinhard', 2, 1000 / SDR_WHITE_NITS));
  });
});
