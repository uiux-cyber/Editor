/**
 * Optional FFmpeg integration (renderer side): detection status, the import-time offer to
 * convert files WebCodecs cannot decode (ProRes, DNxHD / HR, CineForm, MXF…) into a
 * high-quality intermediate, conversion jobs with progress + cancel, and importing the result
 * with `asset.transcodedFrom` pointing at the original. FFmpeg itself runs in the main process.
 */

import { create } from 'zustand';
import type { FileInfo } from '@shared/ipc';
import type { FfmpegConvertOptions, FfmpegInfo } from '@shared/media';
import { uid } from '@/core/factory';
import type { MediaAsset } from '@/core/types';
import { api, hasBridge } from '@/platform/api';
import { toast, useUI } from '@/store/ui';
import { importMediaFiles } from './assets';
import { mediaPrefs } from './prefs';

export interface ConvertJob {
  id: string;
  name: string;
  src: string;
  /** 0..1 */
  ratio: number;
  speed: number | null;
  state: 'running' | 'error';
  error?: string;
}

interface FfmpegState {
  info: FfmpegInfo | null;
  detecting: boolean;
  /** Can this PC decode HEVC (Main / Main 10)? Decides whether HEVC intermediates are offered. */
  hevc: { main: boolean; main10: boolean } | null;
  jobs: Record<string, ConvertJob>;
  /** Files waiting for the user's decision in the conversion dialog. */
  offer: { name: string; path: string; reason: string }[] | null;
}

export const useFfmpeg = create<FfmpegState>()(() => ({ info: null, detecting: false, hevc: null, jobs: {}, offer: null }));

const patchJob = (id: string, patch: Partial<ConvertJob> | null): void =>
  useFfmpeg.setState((s) => {
    const jobs = { ...s.jobs };
    if (patch === null) delete jobs[id];
    else jobs[id] = { ...jobs[id], ...patch } as ConvertJob;
    return { jobs };
  });

export async function detectFfmpeg(force = false): Promise<FfmpegInfo> {
  useFfmpeg.setState({ detecting: true });
  try {
    const info = await api.call<FfmpegInfo>('x:media:ffmpegDetect', force);
    useFfmpeg.setState({ info });
    return info;
  } finally {
    useFfmpeg.setState({ detecting: false });
  }
}

/** Let the user locate ffmpeg.exe. Returns the new status (null when the dialog was cancelled). */
export async function browseFfmpeg(): Promise<FfmpegInfo | null> {
  const info = await api.call<FfmpegInfo | null>('x:media:ffmpegBrowse');
  if (info) {
    useFfmpeg.setState({ info: info.found ? info : useFfmpeg.getState().info });
    if (!info.found) toast('error', 'That is not a working FFmpeg', info.error);
    else toast('success', `FFmpeg ${info.version} is ready`);
  }
  return info;
}

/** Forget a chosen FFmpeg and search PATH again. */
export async function resetFfmpeg(): Promise<FfmpegInfo> {
  const info = await api.call<FfmpegInfo>('x:media:ffmpegReset');
  useFfmpeg.setState({ info });
  return info;
}

export async function hevcSupport(): Promise<{ main: boolean; main10: boolean }> {
  const cached = useFfmpeg.getState().hevc;
  if (cached) return cached;
  const check = async (codec: string): Promise<boolean> => {
    try {
      return !!(await VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 })).supported;
    } catch {
      return false;
    }
  };
  const hevc = { main: await check('hvc1.1.6.L120.90'), main10: await check('hvc1.2.4.L120.90') };
  useFfmpeg.setState({ hevc });
  return hevc;
}

/** Show the conversion dialog for files that could not be imported. */
export function offerConversion(files: { name: string; path: string; reason: string }[]): void {
  if (files.length === 0) return;
  useFfmpeg.setState({ offer: files });
  void detectFfmpeg();
  void hevcSupport();
}

export function dismissOffer(): void {
  useFfmpeg.setState({ offer: null });
}

/** Convert one file and import the result. Resolves with the new asset (null when cancelled). */
export async function convertAndImport(file: { name: string; path: string }): Promise<MediaAsset | null> {
  const id = uid('cv_');
  let codec = mediaPrefs().convertCodec;
  if (codec === 'hevc') {
    const support = await hevcSupport();
    const info = useFfmpeg.getState().info;
    if (!support.main || !info?.encoders.some((e) => e.startsWith('lib') ? e === 'libx265' : e.startsWith('hevc_'))) codec = 'h264';
  }
  const opts: FfmpegConvertOptions = { codec, tenBit: codec === 'hevc' && (useFfmpeg.getState().hevc?.main10 ?? false), videoBitrate: 60e6, audioBitrate: 320e3 };
  patchJob(id, { id, name: file.name, src: file.path, ratio: 0, speed: null, state: 'running' });
  try {
    const out = await api.call<FileInfo>('x:media:ffmpegConvert', id, file.path, opts);
    const res = await importMediaFiles([out], { transcodedFrom: { [out.path.toLowerCase()]: file.path } });
    patchJob(id, null);
    if (res.failures.length || !res.assets[0]) throw new Error(res.failures[0]?.reason ?? 'The converted file could not be imported.');
    useUI.getState().setLibraryTab('media');
    toast('success', `Converted "${file.name}"`, 'The high-quality copy is in your media. The original file is untouched.');
    return res.assets[0];
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err);
    if (/cancelled/i.test(message)) {
      patchJob(id, null);
      return null;
    }
    patchJob(id, { state: 'error', error: message });
    toast('error', `Could not convert "${file.name}"`, message);
    setTimeout(() => patchJob(id, null), 8000);
    return null;
  }
}

export async function cancelConversion(jobId: string): Promise<void> {
  await api.call('x:media:ffmpegCancel', jobId).catch(() => undefined);
}

let started = false;

export function startFfmpegService(): void {
  if (started || !hasBridge) return;
  started = true;
  api.on('x:media:ffmpegProgress', (jobId: string, p: { ratio: number; speed: number | null }) => {
    if (useFfmpeg.getState().jobs[jobId]) patchJob(jobId, { ratio: p.ratio, speed: p.speed });
  });
}
