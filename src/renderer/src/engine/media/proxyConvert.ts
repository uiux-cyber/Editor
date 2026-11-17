/**
 * The proxy transcode itself (Mediabunny Conversion). Runs inside the proxy worker so the UI
 * stays smooth, or on the main thread as a fallback; the caller supplies the byte sink.
 *
 * Output: H.264 at the proxy size, a short key-frame interval (snappy scrubbing), AAC audio
 * (copied when the source already is AAC), timestamps identical to the source.
 */

import { ALL_FORMATS, Conversion, ConversionCanceledError, Input, Mp4OutputFormat, Output, Quality, StreamTarget, UrlSource, canEncodeAudio, type StreamTargetChunk, type VideoSample } from 'mediabunny';
import { drawRawSignal } from './hdr';

export interface ProxySpec {
  /** Streamable URL of the original (kinora://media/…). */
  url: string;
  /** Proxy display size. */
  width: number;
  height: number;
  bitrate: number;
  keyFrameInterval: number;
  /** Keep the raw HDR signal (resize through WebGL instead of a 2D canvas). */
  hdrRaw: boolean;
}

export interface ProxyIO {
  write: (position: number, data: Uint8Array) => Promise<void>;
  progress: (ratio: number) => void;
}

export interface ProxyRun {
  promise: Promise<void>;
  cancel: () => void;
}

export class ProxyCanceled extends Error {
  constructor() {
    super('Proxy creation cancelled');
  }
}

export function runProxyConversion(spec: ProxySpec, io: ProxyIO): ProxyRun {
  let conversion: Conversion | null = null;
  let canceled = false;
  const promise = (async () => {
    const input = new Input({ source: new UrlSource(spec.url, { maxCacheSize: 64 * 1024 * 1024 }), formats: ALL_FORMATS });
    try {
      const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => io.write(chunk.position, chunk.data) });
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable, { chunked: true, chunkSize: 2 * 1024 * 1024 }) });
      const aac = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 }).catch(() => false);
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw new Error('The file has no video track.');
      const rotation = await videoTrack.getRotation();
      const swap = rotation === 90 || rotation === 270;
      // Raw-signal frames are drawn in coded orientation; the rotation stays as metadata.
      const codedW = swap ? spec.height : spec.width;
      const codedH = swap ? spec.width : spec.height;
      let canvas: OffscreenCanvas | null = null;
      conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        trim: { start: 0 },
        showWarnings: false,
        video: spec.hdrRaw
          ? {
              codec: 'avc',
              quality: new Quality({ bitrate: spec.bitrate }),
              keyFrameInterval: spec.keyFrameInterval,
              forceTranscode: true,
              processedWidth: codedW,
              processedHeight: codedH,
              process: (sample: VideoSample) => {
                canvas ??= new OffscreenCanvas(codedW, codedH);
                drawRawSignal(sample, canvas, { ignoreRotation: true });
                return canvas;
              },
            }
          : {
              codec: 'avc',
              width: spec.width,
              height: spec.height,
              fit: 'fill',
              quality: new Quality({ bitrate: spec.bitrate }),
              keyFrameInterval: spec.keyFrameInterval,
              forceTranscode: true,
            },
        audio: { codec: aac ? 'aac' : 'opus', quality: new Quality({ bitrate: 160000 }), numberOfChannels: 2 },
      });
      if (!conversion.isValid) {
        const why = conversion.discardedTracks.map((d) => d.reason).join(', ');
        throw new Error(`This file cannot be converted${why ? ` (${why})` : ''}.`);
      }
      conversion.onProgress = (p) => io.progress(p);
      if (canceled) throw new ProxyCanceled();
      await conversion.execute();
    } catch (err) {
      if (canceled || err instanceof ConversionCanceledError) throw new ProxyCanceled();
      throw err;
    } finally {
      input.dispose();
    }
  })();
  return {
    promise,
    cancel: () => {
      canceled = true;
      void conversion?.cancel();
    },
  };
}
