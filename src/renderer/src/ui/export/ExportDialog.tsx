import { AlertTriangle, CircleCheck, Download, FolderOpen, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { projectDuration } from '@/core/project';
import { getAudioClips } from '@/core/scene';
import { formatBytes, formatDuration } from '@/core/time';
import { engine } from '@/engine/engine';
import { ExportCancelled, estimateSize, exportProject, exportWarnings, getCapabilities, type Capabilities, type ExportContainer, type ExportProgress, type ExportSettings, type QualityLevel } from '@/engine/export/exporter';
import { useAssetRuntime } from '@/engine/media/assets';
import { api } from '@/platform/api';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import type { VideoCodec } from 'mediabunny';
import { Field, Segmented, Select, Toggle } from '../common/controls';
import { Modal } from '../common/overlays';

interface FormatOption {
  id: string;
  label: string;
  hint: string;
  container: ExportContainer;
  codec: VideoCodec;
  ext: string;
  kind: 'video' | 'gif' | 'audio' | 'image';
}

const FORMATS: FormatOption[] = [
  { id: 'mp4-avc', label: 'MP4 · H.264', hint: 'Plays everywhere. Best choice for YouTube, TikTok, Instagram and sharing.', container: 'mp4', codec: 'avc', ext: 'mp4', kind: 'video' },
  { id: 'mp4-hevc', label: 'MP4 · HEVC (H.265)', hint: 'About 30% smaller files at the same quality. Great for 4K.', container: 'mp4', codec: 'hevc', ext: 'mp4', kind: 'video' },
  { id: 'mp4-av1', label: 'MP4 · AV1', hint: 'Smallest files; slower to encode and not supported by every player yet.', container: 'mp4', codec: 'av1', ext: 'mp4', kind: 'video' },
  { id: 'webm-vp9', label: 'WebM · VP9', hint: 'Open format for the web.', container: 'webm', codec: 'vp9', ext: 'webm', kind: 'video' },
  { id: 'mov-avc', label: 'MOV · H.264', hint: 'QuickTime container for Apple workflows.', container: 'mov', codec: 'avc', ext: 'mov', kind: 'video' },
  { id: 'gif', label: 'Animated GIF', hint: 'Short silent loops for chat and docs. Keep it small and brief.', container: 'gif', codec: 'avc', ext: 'gif', kind: 'gif' },
  { id: 'mp3', label: 'MP3 audio', hint: 'Sound only.', container: 'mp3', codec: 'avc', ext: 'mp3', kind: 'audio' },
  { id: 'wav', label: 'WAV audio', hint: 'Uncompressed sound only.', container: 'wav', codec: 'avc', ext: 'wav', kind: 'audio' },
  { id: 'png', label: 'PNG — current frame', hint: 'A full-resolution still of the frame under the playhead.', container: 'png', codec: 'avc', ext: 'png', kind: 'image' },
];

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

type Stage = { name: 'setup' } | { name: 'running'; progress: ExportProgress } | { name: 'done'; path: string; seconds: number; bytes: number } | { name: 'error'; message: string };

export function ExportDialog({ onClose }: { onClose: () => void }): ReactNode {
  const project = useProjectStore((s) => s.project);
  const runtime = useAssetRuntime((s) => s.items);
  const duration = projectDuration(project);
  const { width: pw, height: ph, fps: pfps } = project.settings;

  const [formatId, setFormatId] = useState('mp4-avc');
  const [shortSide, setShortSide] = useState<number>(Math.min(pw, ph));
  const [fps, setFps] = useState<number>(pfps);
  const [quality, setQuality] = useState<QualityLevel>('high');
  const [audio, setAudio] = useState(true);
  const [hardware, setHardware] = useState<ExportSettings['hardware']>('no-preference');
  const [fastStart, setFastStart] = useState(false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [stage, setStage] = useState<Stage>({ name: 'setup' });
  const abort = useRef<AbortController | null>(null);
  const mirror = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    void getCapabilities().then(setCaps);
  }, []);

  const format = FORMATS.find((f) => f.id === formatId) ?? FORMATS[0];
  const isVideo = format.kind === 'video';
  const isGif = format.kind === 'gif';
  const hasPicture = format.kind !== 'audio';
  const hasAudio = useMemo(() => getAudioClips(project).length > 0, [project]);
  const missing = useMemo(() => new Set(Object.keys(runtime).filter((id) => runtime[id].status === 'missing')), [runtime]);
  const warnings = useMemo(() => exportWarnings(project, missing), [project, missing]);

  // GIFs get sensible small defaults when selected.
  useEffect(() => {
    if (isGif) {
      setShortSide((s) => Math.min(s, 480));
      setFps((f) => Math.min(f, 15));
    }
  }, [isGif]);

  const projShort = Math.min(pw, ph);
  const scale = shortSide / projShort;
  const width = even(pw * scale);
  const height = even(ph * scale);

  const settings: ExportSettings = {
    container: format.container,
    videoCodec: format.codec,
    width,
    height,
    fps,
    quality,
    audio,
    start: format.kind === 'image' ? engine.time : 0,
    end: format.kind === 'image' ? engine.time : duration,
    hardware,
    fastStart,
  };

  const resolutions = useMemo(() => {
    const list = [2160, 1440, 1080, 720, 480, 360].filter((r) => r <= Math.max(projShort, 1080) * 2 && r !== projShort);
    const opts = [{ value: projShort, label: `Project — ${pw} × ${ph}` }, ...list.map((r) => ({ value: r, label: `${r === 2160 ? '4K' : `${r}p`} — ${even((pw * r) / projShort)} × ${even((ph * r) / projShort)}` }))];
    return opts.sort((a, b) => b.value - a.value);
  }, [pw, ph, projShort]);

  const fpsOptions = useMemo(() => {
    const base = isGif ? [8, 10, 12, 15, 20, 24, 30] : [24, 25, 30, 50, 60];
    const all = [...new Set([...base, ...(isGif ? [] : [pfps])])].sort((a, b) => a - b);
    return all.map((f) => ({ value: f, label: `${f} fps${f === pfps ? ' (project)' : ''}` }));
  }, [isGif, pfps]);

  const unsupported = isVideo && caps ? !caps.video[format.codec] : false;
  const empty = duration <= 0;
  const noAudio = format.kind === 'audio' && !hasAudio;
  const canStart = !empty && !unsupported && !noAudio && stage.name === 'setup';

  // Mirror the frame being rendered into the dialog.
  useEffect(() => {
    if (stage.name !== 'running') return;
    const timer = window.setInterval(() => {
      const src = source.current;
      const dst = mirror.current;
      if (!src || !dst) return;
      const ctx = dst.getContext('2d');
      if (!ctx) return;
      const k = Math.min(dst.width / src.width, dst.height / src.height);
      const w = src.width * k;
      const h = src.height * k;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, dst.width, dst.height);
      ctx.drawImage(src, (dst.width - w) / 2, (dst.height - h) / 2, w, h);
    }, 400);
    return () => window.clearInterval(timer);
  }, [stage.name]);

  const start = async (): Promise<void> => {
    const path = await api.dialog.saveFile(`${project.name}.${format.ext}`, [{ name: format.label, extensions: [format.ext] }]);
    if (!path) return;
    const controller = new AbortController();
    abort.current = controller;
    source.current = null;
    setStage({ name: 'running', progress: { phase: 'preparing', ratio: 0, frame: 0, totalFrames: 1, speed: 0, eta: 0 } });
    engine.setSuspended(true);
    void api.app.keepAwake(true);
    try {
      const result = await exportProject(
        project,
        settings,
        path,
        (progress) => {
          setStage({ name: 'running', progress });
          void api.app.setProgress(progress.ratio);
        },
        controller.signal,
        (handle) => {
          source.current = handle.canvas;
        },
      );
      const [info] = await api.fs.stat([path]);
      setStage({ name: 'done', path: result.path, seconds: result.seconds, bytes: info?.size ?? 0 });
    } catch (err) {
      if (err instanceof ExportCancelled) {
        setStage({ name: 'setup' });
        useUI.getState().toast({ kind: 'info', message: 'Export cancelled' });
      } else {
        console.error('[export]', err);
        setStage({ name: 'error', message: (err as Error).message || 'The export failed.' });
      }
    } finally {
      abort.current = null;
      engine.setSuspended(false);
      void api.app.keepAwake(false);
      void api.app.setProgress(-1);
    }
  };

  const running = stage.name === 'running';

  if (stage.name === 'running') {
    const p = stage.progress;
    const pct = Math.round(p.ratio * 100);
    return (
      <Modal title="Exporting…" subtitle={project.name} onClose={() => undefined} dismissable={false} width={520}>
        <div className="export-run">
          {hasPicture && <canvas ref={mirror} className="export-run__preview" width={480} height={270} />}
          <div className="progress">
            <div className="progress__bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="export-run__stats">
            <strong className="mono">{pct}%</strong>
            <span>{p.phase === 'preparing' ? 'Preparing media…' : p.phase === 'finalizing' ? 'Finishing the file…' : hasPicture ? `Frame ${p.frame.toLocaleString()} of ${p.totalFrames.toLocaleString()}` : 'Mixing audio…'}</span>
            {p.speed > 0 && hasPicture && <span className="mono">{p.speed.toFixed(1)} fps</span>}
            {p.eta > 1 && <span>{formatDuration(p.eta)} left</span>}
          </div>
          <p className="hint">You can keep this window in the background. The preview is paused while exporting.</p>
        </div>
        <div className="modal__foot modal__foot--inline">
          <button type="button" className="btn btn--outline" onClick={() => abort.current?.abort()}>
            Cancel export
          </button>
        </div>
      </Modal>
    );
  }

  if (stage.name === 'done') {
    return (
      <Modal title="Export complete" onClose={onClose} width={460}>
        <div className="export-done">
          <span className="export-done__icon">
            <CircleCheck size={30} />
          </span>
          <strong className="truncate" title={stage.path}>
            {stage.path.replace(/^.*[\\/]/, '')}
          </strong>
          <span>
            {formatBytes(stage.bytes)} · exported in {formatDuration(Math.max(1, stage.seconds))}
          </span>
        </div>
        <div className="modal__foot modal__foot--inline">
          <button type="button" className="btn btn--outline" onClick={() => void api.app.showItemInFolder(stage.path)}>
            <FolderOpen size={14} /> Show in folder
          </button>
          <button type="button" className="btn btn--outline" onClick={() => void api.app.openPath(stage.path)}>
            <Play size={14} /> Open
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  if (stage.name === 'error') {
    return (
      <Modal title="Export failed" onClose={onClose} width={480}>
        <div className="export-done">
          <span className="export-done__icon export-done__icon--error">
            <AlertTriangle size={28} />
          </span>
          <span style={{ userSelect: 'text' }}>{stage.message}</span>
        </div>
        <div className="modal__foot modal__foot--inline">
          <button type="button" className="btn btn--outline" onClick={() => setStage({ name: 'setup' })}>
            Back to settings
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Export"
      subtitle={`${project.name} · ${formatDuration(duration)} · ${pw} × ${ph}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <div className="export-estimate">
            {format.kind !== 'image' && !empty && (
              <>
                Estimated size <strong>{formatBytes(estimateSize(settings, hasAudio))}</strong>
              </>
            )}
          </div>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canStart || running} onClick={() => void start()}>
            <Download size={14} /> Export
          </button>
        </>
      }
    >
      {empty && (
        <div className="callout callout--warn">
          <AlertTriangle size={15} /> The timeline is empty. Add something to the timeline before exporting.
        </div>
      )}
      {(warnings.slots > 0 || warnings.missing > 0) && (
        <div className="callout callout--warn">
          <AlertTriangle size={15} />
          <span>
            {warnings.slots > 0 && `${warnings.slots} media placeholder${warnings.slots === 1 ? ' is' : 's are'} still empty and will appear as grey boxes. `}
            {warnings.missing > 0 && `${warnings.missing} clip${warnings.missing === 1 ? ' uses' : 's use'} media that could not be found and will be skipped.`}
          </span>
        </div>
      )}
      <Field label="Format" labelWidth={110}>
        <Select value={formatId} options={FORMATS.map((f) => ({ value: f.id, label: f.label + (f.kind === 'video' && caps && !caps.video[f.codec] ? ' — not available on this PC' : '') }))} onChange={setFormatId} />
      </Field>
      <p className="hint" style={{ marginLeft: 118 }}>
        {format.hint}
      </p>
      {unsupported && (
        <div className="callout callout--warn">
          <AlertTriangle size={15} /> This PC has no encoder for {format.label}. Choose MP4 · H.264 instead.
        </div>
      )}
      {noAudio && (
        <div className="callout callout--warn">
          <AlertTriangle size={15} /> This project has no audio to export.
        </div>
      )}
      {hasPicture && (
        <Field label="Resolution" labelWidth={110}>
          <Select value={shortSide} options={resolutions} onChange={setShortSide} />
        </Field>
      )}
      {(isVideo || isGif) && (
        <Field label="Frame rate" labelWidth={110}>
          <Select value={fpsOptions.some((o) => o.value === fps) ? fps : fpsOptions[fpsOptions.length - 1].value} options={fpsOptions} onChange={setFps} />
        </Field>
      )}
      {(isVideo || format.container === 'mp3') && (
        <Field label="Quality" labelWidth={110}>
          <Segmented
            value={quality}
            style={{ flex: 1 }}
            options={[
              { value: 'low', label: 'Smaller file' },
              { value: 'medium', label: 'Balanced' },
              { value: 'high', label: 'High' },
              { value: 'best', label: 'Best' },
            ]}
            onChange={setQuality}
          />
        </Field>
      )}
      {isVideo && (
        <>
          <Field label="Include audio" labelWidth={110}>
            <Toggle value={audio && hasAudio} disabled={!hasAudio} onChange={setAudio} />
            {!hasAudio && <span style={{ color: 'var(--text-3)' }}>No audio in this project</span>}
          </Field>
          <details className="advanced">
            <summary>Advanced</summary>
            <Field label="Encoder" labelWidth={110}>
              <Select
                value={hardware}
                options={[
                  { value: 'no-preference', label: 'Automatic' },
                  { value: 'prefer-hardware', label: 'Prefer GPU (faster)' },
                  { value: 'prefer-software', label: 'Prefer CPU (most compatible)' },
                ]}
                onChange={setHardware}
              />
            </Field>
            {format.container !== 'webm' && (
              <Field label="Web optimised" labelWidth={110} title="Places the index at the start of the file so it starts playing sooner when streamed. Uses more memory while exporting.">
                <Toggle value={fastStart} onChange={setFastStart} />
                <span style={{ color: 'var(--text-3)' }}>Fast start for streaming</span>
              </Field>
            )}
          </details>
        </>
      )}
      {isGif && <p className="hint">GIFs are limited to 256 colours per frame and get large quickly — keep them short, small and at a low frame rate.</p>}
    </Modal>
  );
}
