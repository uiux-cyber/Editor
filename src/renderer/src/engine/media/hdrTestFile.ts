/**
 * Synthetic HDR test media. Builds a short MP4 whose frames are PQ / BT.2020 encoded (10-bit
 * when the PC has a 10-bit encoder, else 8-bit samples carrying the same PQ tags). Used by the
 * automated tests and by the HDR pipeline probe — never by user-facing code paths.
 *
 * Picture: a horizontal ramp from 0 to 10,000 nits (PQ code values 0..1) in the top half, and
 * patches of 100 / 203 / 1000 / 4000 nits in the bottom half, so tone-mapping is easy to verify.
 */

import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output, type VideoCodec } from 'mediabunny';
import { pqEncode } from '../gl/hdrMath';

export interface SyntheticHdrOptions {
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  /** Tag the stream as PQ (true) or leave it SDR BT.709 (false) with identical code values. */
  pq?: boolean;
}

export interface SyntheticHdrResult {
  bytes: Uint8Array;
  codec: string;
  bitDepth: 8 | 10;
}

// The DOM typings predate the HDR enum values.
const PQ_SPACE = { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl', fullRange: false } as unknown as VideoColorSpaceInit;
const SDR_SPACE: VideoColorSpaceInit = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

/** Patch luminances (nits) shown in the lower half, left to right. */
export const HDR_TEST_PATCHES = [100, 203, 1000, 4000];

/** PQ signal value (0..1) at horizontal position x (0..1) of the test picture. */
export function hdrTestSignal(x: number, y: number): number {
  if (y < 0.5) return Math.min(1, Math.max(0, x));
  const i = Math.min(HDR_TEST_PATCHES.length - 1, Math.floor(x * HDR_TEST_PATCHES.length));
  return pqEncode(HDR_TEST_PATCHES[i]);
}

const CANDIDATES: { codec: string; mb: VideoCodec; bits: 8 | 10 }[] = [
  { codec: 'hvc1.2.4.L120.90', mb: 'hevc', bits: 10 },
  { codec: 'vp09.02.10.10', mb: 'vp9', bits: 10 },
  { codec: 'av01.0.04M.10', mb: 'av1', bits: 10 },
  { codec: 'avc1.640028', mb: 'avc', bits: 8 },
];

async function pickEncoder(width: number, height: number, fps: number): Promise<(typeof CANDIDATES)[number]> {
  for (const c of CANDIDATES) {
    try {
      const res = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate: 6e6, framerate: fps });
      if (res.supported) return c;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('No video encoder available');
}

/** Limited-range Y'CbCr planes for a neutral (grey) picture with the given signal per pixel. */
function makeFrame(width: number, height: number, bits: 8 | 10, ts: number, tagged: boolean): VideoFrame {
  const lumaMax = bits === 10 ? 940 : 235;
  const lumaMin = bits === 10 ? 64 : 16;
  const mid = bits === 10 ? 512 : 128;
  const cw = width / 2;
  const chh = height / 2;
  const n = width * height + 2 * cw * chh;
  const data = bits === 10 ? new Uint16Array(n) : new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = hdrTestSignal((x + 0.5) / width, (y + 0.5) / height);
      data[y * width + x] = Math.round(lumaMin + s * (lumaMax - lumaMin));
    }
  }
  data.fill(mid, width * height);
  return new VideoFrame(data, {
    format: bits === 10 ? 'I420P10' : 'I420',
    codedWidth: width,
    codedHeight: height,
    timestamp: ts,
    colorSpace: tagged ? PQ_SPACE : SDR_SPACE,
  } as VideoFrameBufferInit);
}

/** Encode the synthetic HDR clip into an in-memory MP4. */
export async function makeSyntheticHdrVideo(opts: SyntheticHdrOptions = {}): Promise<SyntheticHdrResult> {
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;
  const frames = opts.frames ?? 30;
  const fps = opts.fps ?? 30;
  const tagged = opts.pq !== false;
  const enc = await pickEncoder(width, height, fps);
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new EncodedVideoPacketSource(enc.mb);
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const pending: Promise<void>[] = [];
  let first = true;
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      // Force the container colour description: encoders do not always carry it over.
      const m: EncodedVideoChunkMetadata | undefined = meta?.decoderConfig ? { ...meta, decoderConfig: { ...meta.decoderConfig, colorSpace: tagged ? PQ_SPACE : SDR_SPACE } } : first ? meta : undefined;
      first = false;
      pending.push(source.add(EncodedPacket.fromEncodedChunk(chunk), m));
    },
    error: (e) => (failure = e),
  });
  encoder.configure({ codec: enc.codec, width, height, bitrate: 8e6, framerate: fps, latencyMode: 'quality' });
  for (let i = 0; i < frames; i++) {
    const frame = makeFrame(width, height, enc.bits, Math.round((i * 1e6) / fps), tagged);
    encoder.encode(frame, { keyFrame: i % fps === 0 });
    frame.close();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  await Promise.all(pending);
  await output.finalize();
  return { bytes: new Uint8Array(target.buffer!), codec: enc.codec, bitDepth: enc.bits };
}
