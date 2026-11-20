import { AlertTriangle, Captions, Check, CircleCheck, FolderOpen, Info, ListPlus, Music, Play, Scissors, Sparkles } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { captionTracks } from '@/core/captions';
import { projectDuration } from '@/core/project';
import { getAudioClips } from '@/core/scene';
import { formatDuration, formatSeconds, formatTimecode } from '@/core/time';
import { engine } from '@/engine/engine';
import { canEncodeSize, estimateSize, exportCaptionCues, exportWarnings, getCapabilities, supportsEmbeddedSubtitles, supportsSidecars, withoutBurnedCaptions, type Capabilities, type SubtitleFormat } from '@/engine/export/exporter';
import { FramingPreview } from '@/engine/export/framingPreview';
import { ASPECTS, PLATFORM_PRESETS, PRESET_GROUPS, frameFor, presetFrame, presetSpec, type AspectId, type PlatformPreset } from '@/engine/export/presets';
import { cancelJob, enqueue, jobCanvas, setPreviewMode, unwatch, useExportQueue, watch } from '@/engine/export/queue';
import { isFinished } from '@/engine/export/queueState';
import { defaultRangeMode, resolveRange, type RangeMode } from '@/engine/export/range';
import { ALPHA_FORMATS, FORMATS, customFormat, defaultCustom, outputName, planTarget, type CustomSettings, type PlannedTarget } from '@/engine/export/targets';
import { useAssetRuntime } from '@/engine/media/assets';
import { api } from '@/platform/api';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { Field, Segmented, Select, Toggle } from '../common/controls';
import { Modal } from '../common/overlays';
import { formatNumber, formatSize, tk, tMaybe, useT } from '../i18n';
import { JobRow, baseName } from './JobRow';
import { getExportPrefs, saveExportPrefs } from './prefs';
import './export.css';

const LABEL_W = 110;

/** Put React nodes where a translated message has `{name}` placeholders. */
function richText(message: string, nodes: Record<string, ReactNode>): ReactNode {
  return message.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? <Fragment key={i}>{nodes[name]}</Fragment> : part;
  });
}

// ---------------------------------------------------------------------------------------------
// Preset gallery
// ---------------------------------------------------------------------------------------------

function Tile({ selected, onToggle, w, h, tint, name, spec, title, id }: { selected: boolean; onToggle: () => void; w: number; h: number; tint?: string; name: string; spec: ReactNode; title?: string; id: string }): ReactNode {
  const k = 30 / Math.max(w, h);
  return (
    <button type="button" className={`xd-tile ${selected ? 'is-selected' : ''}`} aria-pressed={selected} title={title} data-target={id} onClick={onToggle}>
      <span className="xd-tile__frame">
        <span className="xd-tile__shape" style={{ width: Math.max(8, w * k), height: Math.max(8, h * k), ['--tint' as string]: tint }} />
      </span>
      <span className="xd-tile__text">
        <span className="xd-tile__name">{name}</span>
        <span className="xd-tile__spec">{spec}</span>
      </span>
      <span className="xd-tile__check">
        <Check size={10} strokeWidth={3.5} />
      </span>
    </button>
  );
}

function presetSpecLines(p: PlatformPreset, settings: { width: number; height: number; fps: number }): ReactNode {
  const [size, fps, ...rest] = presetSpec(p, settings).split(' · ');
  return (
    <>
      {size} · {fps}
      <br />
      {rest.join(' · ')}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Framing previews
// ---------------------------------------------------------------------------------------------

function TargetPreview({ plan, time, renderer, box }: { plan: PlannedTarget; time: number; renderer: FramingPreview | null; box: { w: number; h: number } }): ReactNode {
  const tr = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = plan.settings;
  const k = Math.min(box.w / width, box.h / height);
  const cssW = Math.max(40, Math.round(width * k));
  const cssH = Math.max(40, Math.round(height * k));
  const audioOnly = plan.settings.container === 'mp3' || plan.settings.container === 'wav';
  const transparent = !!plan.settings.transparent;
  // Show exactly what the export renders: captions disappear when they are not burned in.
  const scene = useMemo(() => (plan.settings.burnInCaptions === false ? withoutBurnedCaptions(plan.project) : plan.project), [plan.project, plan.settings.burnInCaptions]);

  useEffect(() => {
    if (audioOnly || !renderer) return;
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(cssW * dpr);
    el.height = Math.round(cssH * dpr);
    const timer = window.setTimeout(() => void renderer.draw(scene, time, el, { transparent }), 90);
    return () => window.clearTimeout(timer);
  }, [scene, time, renderer, cssW, cssH, transparent, audioOnly]);

  return (
    <div className="xd-preview" style={{ width: box.w }} data-preview-target={plan.key}>
      <div className="xd-preview__stage" style={{ height: audioOnly ? 54 : box.h }}>
        {audioOnly ? (
          <div className="xd-preview__frame xd-preview__frame--audio">
            <Music size={18} color="var(--text-2)" />
          </div>
        ) : (
          <div className="xd-preview__frame" style={{ width: cssW, height: cssH }}>
            <canvas ref={canvas} />
            <span className="xd-preview__badge">{plan.aspect}</span>
          </div>
        )}
      </div>
      <span className="xd-preview__label" title={tMaybe(plan.label)}>
        {tMaybe(plan.label)}
      </span>
      <span className="xd-preview__sub">{plan.reframed ? tr('Reframed to fit') : audioOnly ? tr('Sound only') : transparent ? tr('Transparent background') : tr('Original framing')}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Running / finished view
// ---------------------------------------------------------------------------------------------

function WatchView({ ids, onClose, onBack }: { ids: string[]; onClose: () => void; onBack: () => void }): ReactNode {
  const tr = useT();
  const all = useExportQueue((s) => s.jobs);
  const previewMode = useExportQueue((s) => s.previewMode);
  const jobs = useMemo(() => all.filter((j) => ids.includes(j.id)), [all, ids]);
  const stage = useRef<HTMLCanvasElement>(null);
  const running = jobs.find((j) => j.status === 'running' || j.status === 'cancelling');
  const finished = jobs.length > 0 && jobs.every((j) => isFinished(j.status));
  const ahead = all.filter((j) => !ids.includes(j.id) && (j.status === 'running' || j.status === 'queued')).length;

  // Leaving the dialog: further completions are announced with toasts again.
  useEffect(() => {
    watch(ids);
    return () => unwatch(ids);
  }, [ids]);

  useEffect(() => {
    if (jobs.length === 0) onClose();
  }, [jobs.length, onClose]);

  // Mirror the frame being rendered.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const src = jobCanvas(running.id);
      const dst = stage.current;
      if (!src || !dst) return;
      const k = Math.min(560 / src.width, 280 / src.height);
      const w = Math.max(2, Math.round(src.width * k));
      const h = Math.max(2, Math.round(src.height * k));
      if (dst.width !== w || dst.height !== h) {
        dst.width = w;
        dst.height = h;
      }
      dst.getContext('2d')?.drawImage(src, 0, 0, w, h);
    }, 350);
    return () => window.clearInterval(timer);
  }, [running?.id]);

  if (finished) {
    const done = jobs.filter((j) => j.status === 'done');
    const failed = jobs.filter((j) => j.status === 'failed');
    const single = jobs.length === 1 ? jobs[0] : null;
    const ok = failed.length === 0 && done.length > 0;
    const extraFiles = single?.result?.extraFiles.map((f) => baseName(f)).join(', ') ?? '';
    return (
      <Modal title={ok ? tr('Export complete') : done.length ? tr('Some exports failed') : tr('Export failed')} onClose={onClose} width={520}>
        <div className="export-done">
          <span className={`export-done__icon ${ok ? '' : 'export-done__icon--error'}`}>{ok ? <CircleCheck size={30} /> : <AlertTriangle size={28} />}</span>
          {single ? (
            <>
              <strong className="truncate" title={single.output.path}>
                {baseName(single.output.path)}
              </strong>
              {single.status === 'done' ? (
                <span>
                  {tr('{size} · exported in {time}', { size: formatSize(single.result?.bytes ?? 0), time: formatDuration(Math.max(1, single.result?.seconds ?? 0)) })}
                  {extraFiles ? ` · ${tr('with {files}', { files: extraFiles })}` : ''}
                </span>
              ) : (
                <span style={{ userSelect: 'text' }}>{single.error ?? tr('The export was cancelled.')}</span>
              )}
            </>
          ) : (
            <strong>{tr('{done} of {total} exports finished', { done: done.length, total: jobs.length })}</strong>
          )}
        </div>
        {!single && (
          <div className="xq-list" style={{ marginTop: 6 }}>
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}
        <div className="modal__foot modal__foot--inline">
          {single && single.status !== 'done' && (
            <button type="button" className="btn btn--outline" onClick={onBack}>
              {tr('Back to settings')}
            </button>
          )}
          {done[0] && (
            <button type="button" className="btn btn--outline" onClick={() => void api.app.showItemInFolder(done[0].output.path)}>
              <FolderOpen size={14} /> {tr('Show in folder')}
            </button>
          )}
          {single?.status === 'done' && (
            <button type="button" className="btn btn--outline" onClick={() => void api.app.openPath(single.output.path)}>
              <Play size={14} /> {tr('Open')}
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {tr('Done')}
          </button>
        </div>
      </Modal>
    );
  }

  const ratio = jobs.reduce((sum, j) => sum + (j.status === 'done' || j.status === 'failed' ? 1 : j.status === 'running' ? (j.progress?.ratio ?? 0) : 0), 0) / Math.max(1, jobs.filter((j) => j.status !== 'cancelled').length);
  const pct = Math.round(ratio * 100);
  const p = running?.progress;
  const audioOnly = running && (running.settings.container === 'mp3' || running.settings.container === 'wav');
  return (
    <Modal title={jobs.length > 1 ? tr('Exporting {count} files…', { count: jobs.length }) : tr('Exporting…')} subtitle={running ? `${tMaybe(running.label)} · ${running.detail}` : tr('Waiting in the export queue')} onClose={onClose} width={600}>
      <div className="xd-watch">
        <div className="xd-watch__stage">{audioOnly ? <Music size={28} color="var(--text-3)" /> : <canvas ref={stage} />}</div>
        <div className="progress">
          <div className="progress__bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="xd-watch__stats">
          <strong className="mono">{pct}%</strong>
          {running ? (
            <span>{!p || p.phase === 'preparing' ? tr('Preparing media…') : p.phase === 'finalizing' ? tr('Finishing the file…') : audioOnly ? tr('Mixing audio…') : tr('Frame {frame} of {total}', { frame: formatNumber(p.frame), total: formatNumber(p.totalFrames) })}</span>
          ) : (
            <span>{ahead > 0 ? tr('{count, plural, one {Waiting for # export ahead in the queue…} other {Waiting for # exports ahead in the queue…}}', { count: ahead }) : tr('Starting…')}</span>
          )}
          {p && p.speed > 0 && !audioOnly && <span className="mono">{formatNumber(p.speed, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} fps</span>}
          {p && p.eta > 1 && <span>{tr('{time} left', { time: formatDuration(p.eta) })}</span>}
        </div>
        {jobs.length > 1 && (
          <div className="xq-list">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}
        <div className="xd-note">
          <Info size={13} />
          <span>
            {richText(tr('Exports run in the background — choose {button} to keep working; progress stays in the title bar.'), { button: <b>{tr('Continue editing')}</b> })}{' '}
            {previewMode === 'paused' ? tr('The preview is paused while exporting so exports finish sooner.') : tr('The preview stays live while exporting; pause it for faster exports.')}
          </span>
        </div>
      </div>
      <div className="modal__foot modal__foot--inline">
        <div className="xd-watch__mode">
          <span>{tr('Preview')}</span>
          <Segmented
            value={previewMode}
            options={[
              { value: 'live', label: tr('Live'), title: tr('Keep the preview playable while exporting') },
              { value: 'paused', label: tr('Paused (faster)'), title: tr('Pause the preview so exports finish sooner') },
            ]}
            onChange={setPreviewMode}
          />
        </div>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => {
            for (const j of jobs) if (j.status === 'queued' || j.status === 'running') cancelJob(j.id);
          }}
        >
          {jobs.length > 1 ? tr('Cancel all') : tr('Cancel export')}
        </button>
        <button type="button" className="btn btn--outline" data-continue onClick={onClose}>
          {tr('Continue editing')}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------------------------

const RANGE_OPTIONS: { value: RangeMode; label: string }[] = [
  { value: 'all', label: tk('Whole project') },
  { value: 'inout', label: tk('In–Out') },
  { value: 'selection', label: tk('Selected clips') },
];

/** Range messages and preset group / aspect names from engine/export, translated where shown. */
const ENGINE_TEXT = new Set<string>([
  tk('The timeline is empty.'),
  tk('The range is shorter than one frame.'),
  tk('Mark an In and / or Out point first (I / O at the playhead).'),
  tk('Select one or more clips on the timeline first.'),
  tk('Social'),
  tk('Video platforms'),
  tk('General'),
  tk('Landscape 16:9'),
  tk('Vertical 9:16'),
  tk('Square 1:1'),
  tk('Portrait 4:5'),
]);
const engineText = (s: string): string => (ENGINE_TEXT.has(s) ? tMaybe(s) : s);

export function ExportDialog({ onClose }: { onClose: () => void }): ReactNode {
  const tr = useT();
  const project = useProjectStore((s) => s.project);
  const runtime = useAssetRuntime((s) => s.items);
  const selection = useUI((s) => s.selection);
  const duration = projectDuration(project);
  const { width: pw, height: ph, fps: pfps } = project.settings;
  const prefs = useMemo(() => getExportPrefs(), []);

  const [selected, setSelected] = useState<string[]>(() => (prefs.selected?.length ? prefs.selected.filter((k) => k === 'custom' || PLATFORM_PRESETS.some((p) => p.id === k)) : ['custom']));
  const [custom, setCustom] = useState<CustomSettings>(() => ({ ...defaultCustom(project), ...prefs.custom, fps: pfps }));
  const [rangeMode, setRangeMode] = useState<RangeMode>(() => defaultRangeMode(project));
  const [audio, setAudio] = useState(prefs.audio ?? true);
  const [burnIn, setBurnIn] = useState(prefs.burnInCaptions ?? true);
  const [sidecars, setSidecars] = useState<SubtitleFormat[]>(prefs.sidecars ?? []);
  const [embed, setEmbed] = useState(prefs.embedSubtitles ?? false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [sizeOk, setSizeOk] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<{ name: 'setup' } | { name: 'watch'; ids: string[] }>({ name: 'setup' });
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Throwaway renderer for the framing previews; created per mount (StrictMode-safe).
  const [renderer, setRenderer] = useState<FramingPreview | null>(null);

  useEffect(() => {
    void getCapabilities().then(setCaps);
    const preview = new FramingPreview();
    setRenderer(preview);
    return () => void preview.dispose();
  }, []);

  const hasAudio = useMemo(() => getAudioClips(project).length > 0, [project]);
  const missing = useMemo(() => new Set(Object.keys(runtime).filter((id) => runtime[id].status === 'missing')), [runtime]);
  const warnings = useMemo(() => exportWarnings(project, missing), [project, missing]);
  const range = resolveRange(project, rangeMode, selection);
  const capTracks = captionTracks(project);
  const cueCount = useMemo(() => exportCaptionCues(project, range).length, [project, range.start, range.end]);
  const hasCaptions = capTracks.length > 0;
  const fmt = customFormat(custom);

  // GIFs get sensible small defaults when selected.
  useEffect(() => {
    if (fmt.kind === 'gif') setCustom((c) => ({ ...c, shortSide: c.shortSide === 0 || c.shortSide > 480 ? Math.min(480, Math.min(pw, ph)) : c.shortSide, fps: Math.min(c.fps, 15) }));
  }, [fmt.kind, pw, ph]);

  const plans = useMemo(() => {
    const opts = { range: { start: range.start, end: range.end }, time: engine.time, audio: audio && hasAudio, burnInCaptions: burnIn || !hasCaptions, sidecars: hasCaptions ? sidecars : [], embedSubtitles: hasCaptions && embed };
    const order = ['custom', ...PLATFORM_PRESETS.map((p) => p.id)];
    return [...selected]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((key) => planTarget(project, key, custom, opts))
      .filter((p): p is PlannedTarget => !!p);
  }, [project, selected, custom, range.start, range.end, audio, hasAudio, burnIn, sidecars, embed, hasCaptions]);

  // Can this PC encode each output at its size (e.g. H.264 at 4K)?
  useEffect(() => {
    let alive = true;
    for (const t of plans) {
      const s = t.settings;
      if (!['mp4', 'webm', 'mov'].includes(s.container)) continue;
      const key = `${s.videoCodec}:${s.width}x${s.height}`;
      if (key in sizeOk) continue;
      void canEncodeSize(s.videoCodec, s.width, s.height).then((ok) => alive && setSizeOk((m) => ({ ...m, [key]: ok })));
    }
    return () => {
      alive = false;
    };
  }, [plans]);

  const problems = (t: PlannedTarget): string[] => {
    const s = t.settings;
    const out: string[] = [];
    const video = ['mp4', 'webm', 'mov'].includes(s.container);
    const target = tMaybe(t.label);
    const codec = s.videoCodec.toUpperCase();
    if (video && caps && !caps.video[s.videoCodec]) out.push(tr('{target}: this PC has no {codec} encoder — choose MP4 · H.264 instead.', { target, codec }));
    else if (video && sizeOk[`${s.videoCodec}:${s.width}x${s.height}`] === false) out.push(tr('{target}: this PC cannot encode {codec} at {width} × {height}.', { target, codec, width: String(s.width), height: String(s.height) }));
    if ((s.container === 'mp3' || s.container === 'wav') && !hasAudio) out.push(tr('{target}: this project has no audio to export.', { target }));
    return out;
  };
  const blocking = plans.flatMap(problems);
  const notes: string[] = [];
  for (const t of plans) {
    if (t.maxDuration && range.end - range.start > t.maxDuration + 0.01) notes.push(tr('{target} accepts videos up to {max} — this export is {length}.', { target: tMaybe(t.label), max: formatDuration(t.maxDuration), length: formatDuration(range.end - range.start) }));
  }
  const stillOnly = plans.length > 0 && plans.every((t) => t.settings.container === 'png');
  const rangeOk = stillOnly || range.valid;
  const canExport = !busy && duration > 0 && plans.length > 0 && rangeOk && blocking.length === 0;

  const previewTime = (() => {
    if (previewAt !== null && previewAt >= range.start && previewAt <= range.end) return previewAt;
    const t = engine.time;
    const last = Math.max(range.start, range.end - 1 / pfps);
    return Math.min(Math.max(t, range.start), last);
  })();

  const toggle = (key: string): void => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const setC = (patch: Partial<CustomSettings>): void => setCustom((c) => ({ ...c, ...patch }));

  const submit = async (watch: boolean): Promise<void> => {
    if (!canExport) return;
    setBusy(true);
    try {
      const batch = plans.length > 1;
      const outputs: { path: string; kind: 'file' | 'folder' }[] = [];
      if (!batch) {
        const t = plans[0];
        if (t.kind === 'folder') {
          const dir = await api.call<string | null>('x:export:pickFolder', tr('Choose where to save the PNG sequence'));
          if (!dir) return;
          outputs.push({ path: await api.call<string>('x:export:subfolder', dir, outputName(project.name, t, true)), kind: 'folder' });
        } else {
          const path = await api.dialog.saveFile(outputName(project.name, t, false), [{ name: t.label === 'Custom' ? fmt.label : t.label, extensions: [t.ext] }]);
          if (!path) return;
          outputs.push({ path, kind: 'file' });
        }
      } else {
        const dir = await api.call<string | null>('x:export:pickFolder', tr('Choose a folder for the {count} exports', { count: plans.length }));
        if (!dir) return;
        for (const t of plans) {
          const name = outputName(project.name, t, true);
          outputs.push(t.kind === 'folder' ? { path: await api.call<string>('x:export:subfolder', dir, name), kind: 'folder' } : { path: await api.call<string>('x:export:fileInFolder', dir, name), kind: 'file' });
        }
      }
      const { fps: _fps, ...rememberCustom } = custom;
      saveExportPrefs({ selected, custom: rememberCustom, audio, burnInCaptions: burnIn, sidecars, embedSubtitles: embed });
      const ids = enqueue(
        plans.map((t, i) => ({
          label: t.label,
          detail: t.detail,
          aspect: t.aspect,
          output: outputs[i],
          project: t.project,
          settings: t.kind === 'folder' ? { ...t.settings, sequenceName: baseName(outputs[i].path) } : t.settings,
          weight: t.weight,
        })),
        { watch },
      );
      if (watch) setView({ name: 'watch', ids });
      else {
        onClose();
        useUI.getState().toast({ kind: 'info', message: tr('{count, plural, =1 {Added to the export queue} other {Added # exports to the queue}}', { count: plans.length }), detail: tr('Follow the progress from the title bar.') });
      }
    } catch (err) {
      useUI.getState().toast({ kind: 'error', message: tr('Could not start the export'), detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (view.name === 'watch') return <WatchView ids={view.ids} onClose={onClose} onBack={() => setView({ name: 'setup' })} />;

  // ---- Setup view ------------------------------------------------------------------------------
  const projShort = Math.min(pw, ph);
  const customFrame = frameFor(custom.aspect, project.settings, custom.shortSide || undefined);
  const resolutions = (() => {
    const list = [2160, 1440, 1080, 720, 480, 360].filter((r) => r <= Math.max(projShort, 1080) * 2 && r !== projShort);
    const opts = [{ value: 0, label: tr('Project — {width} × {height}', { width: String(frameFor(custom.aspect, project.settings).width), height: String(frameFor(custom.aspect, project.settings).height) }) }, ...list.map((r) => {
      const f = frameFor(custom.aspect, project.settings, r);
      return { value: r, label: `${r === 2160 ? '4K' : `${r}p`} — ${f.width} × ${f.height}` };
    })];
    return opts;
  })();
  const isGif = fmt.kind === 'gif';
  const fpsOptions = (() => {
    const base = isGif ? [8, 10, 12, 15, 20, 24, 30] : [24, 25, 30, 50, 60];
    const all = [...new Set([...base, ...(isGif ? [] : [pfps])])].sort((a, b) => a - b);
    return all.map((f) => ({ value: f, label: f === pfps ? tr('{fps} fps (project)', { fps: String(f) }) : `${f} fps` }));
  })();
  const formatOptions = (custom.transparent ? ALPHA_FORMATS : FORMATS).map((f) => ({ value: f.id, label: f.kind === 'video' && caps && !caps.video[f.codec] ? tr('{format} — not available on this PC', { format: f.label }) : f.label }));
  const totalSize = plans.reduce((sum, t) => sum + estimateSize(t.settings, hasAudio), 0);
  const visualPlans = plans.filter((t) => !(t.settings.container === 'mp3' || t.settings.container === 'wav'));
  const box = plans.length <= 1 ? { w: 274, h: 230 } : { w: 129, h: 132 };
  const anyVideoContainer = plans.some((t) => supportsEmbeddedSubtitles(t.settings.container));
  const anySidecarTarget = plans.some((t) => supportsSidecars(t.settings.container));
  const customSelected = selected.includes('custom');
  const inOutAvailable = project.inPoint !== undefined || project.outPoint !== undefined;

  return (
    <Modal
      title={tr('Export')}
      subtitle={`${project.name} · ${formatDuration(duration)} · ${pw} × ${ph} · ${pfps} fps`}
      onClose={onClose}
      width={980}
      footer={
        <>
          <div className="xd-estimate">
            {plans.length > 0 && duration > 0 && !stillOnly && (
              <>
                {richText(plans.length > 1 ? tr('{count} exports · about {size}', { count: plans.length }) : tr('Estimated size {size}'), { size: <strong>{formatSize(totalSize)}</strong> })}
                {rangeMode !== 'all' && range.valid && <> · {tr('{duration} section', { duration: formatSeconds(range.end - range.start) })}</>}
              </>
            )}
          </div>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button type="button" className="btn btn--outline" disabled={!canExport} title={tr('Render in the background and keep editing')} data-add-to-queue onClick={() => void submit(false)}>
            <ListPlus size={14} /> {tr('Add to queue')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!canExport} data-export onClick={() => void submit(true)}>
            <Sparkles size={14} /> {plans.length > 1 ? tr('Export {count} files', { count: plans.length }) : tr('Export')}
          </button>
        </>
      }
    >
      {duration <= 0 && (
        <div className="callout callout--warn">
          <AlertTriangle size={15} /> {tr('The timeline is empty. Add something to the timeline before exporting.')}
        </div>
      )}
      {(warnings.slots > 0 || warnings.missing > 0) && (
        <div className="callout callout--warn">
          <AlertTriangle size={15} />
          <span>
            {warnings.slots > 0 && `${tr('{count, plural, one {# media placeholder is still empty and will appear as grey boxes.} other {# media placeholders are still empty and will appear as grey boxes.}}', { count: warnings.slots })} `}
            {warnings.missing > 0 && tr('{count, plural, one {# clip uses media that could not be found and will be skipped.} other {# clips use media that could not be found and will be skipped.}}', { count: warnings.missing })}
          </span>
        </div>
      )}
      <div className="xd">
        <div className="xd-main">
          {/* ---- Formats ---- */}
          <section className="xd-sec">
            <div className="xd-sec__head">
              <span className="xd-sec__title">{tr('Formats')}</span>
              <span className="xd-sec__meta">{selected.length === 0 ? tr('Pick one or more — each becomes its own file') : tr('{count, plural, =1 {# selected} other {# selected · exported one after another}}', { count: selected.length })}</span>
              <span className="xd-sec__actions">
                {selected.length > 0 && (
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelected([])}>
                    {tr('Clear')}
                  </button>
                )}
              </span>
            </div>
            {PRESET_GROUPS.map((g) => (
              <div key={g.id} className="xd-sec" style={{ gap: 6 }}>
                <div className="xd-group">{engineText(g.label)}</div>
                <div className="xd-grid">
                  {PLATFORM_PRESETS.filter((p) => p.group === g.id).map((p) => {
                    const f = presetFrame(p, project.settings);
                    return <Tile key={p.id} id={p.id} selected={selected.includes(p.id)} onToggle={() => toggle(p.id)} w={f.width} h={f.height} tint={p.tint} name={p.name} spec={presetSpecLines(p, project.settings)} title={tMaybe(p.hint)} />;
                  })}
                  {g.id === 'general' && (
                    <Tile
                      id="custom"
                      selected={customSelected}
                      onToggle={() => toggle('custom')}
                      w={fmt.kind === 'audio' ? 1 : customFrame.width}
                      h={fmt.kind === 'audio' ? 1 : customFrame.height}
                      name={tr('Custom')}
                      spec={
                        <>
                          {fmt.kind === 'audio' ? tr('Sound only') : `${customFrame.width} × ${customFrame.height}`}
                          <br />
                          {fmt.label.replace(' with transparency', ' + alpha')}
                        </>
                      }
                      title={tr('Choose the format, size and quality yourself')}
                    />
                  )}
                </div>
              </div>
            ))}
          </section>

          {/* ---- Custom settings ---- */}
          {customSelected && (
            <section className="xd-sec">
              <div className="xd-sec__head">
                <span className="xd-sec__title">{tr('Custom')}</span>
                <span className="xd-sec__meta">{tMaybe(fmt.hint)}</span>
              </div>
              <div className="xd-card">
                <Field label={tr('Transparent')} labelWidth={LABEL_W} title={tr('Export without a background — only the layers are kept (WebM VP9 with alpha or PNG).')}>
                  <Toggle value={custom.transparent} onChange={(v) => setC({ transparent: v, formatId: v ? (getFormatAlpha(custom.formatId) ? custom.formatId : 'webm-alpha') : custom.formatId === 'webm-alpha' ? 'webm-vp9' : custom.formatId })} />
                  <span className="xd-row__hint">{custom.transparent ? tr('Areas no layer covers stay see-through. Full-frame videos and backgrounds remain opaque.') : tr('Transparent background (WebM · VP9 alpha or PNG)')}</span>
                </Field>
                <Field label={tr('Format')} labelWidth={LABEL_W}>
                  <Select value={fmt.id} options={formatOptions} onChange={(id) => setC({ formatId: id })} />
                </Field>
                {fmt.kind !== 'audio' && (
                  <>
                    <Field label={tr('Frame', undefined, 'framing')} labelWidth={LABEL_W}>
                      <Select
                        value={custom.aspect}
                        options={[{ value: 'source' as AspectId, label: tr('Project — {width} × {height}', { width: String(pw), height: String(ph) }) }, ...ASPECTS.map((a) => ({ value: a.id as AspectId, label: Math.abs(a.w / a.h - pw / ph) < 0.01 ? tr('{aspect} (project)', { aspect: engineText(a.label) }) : tr('{aspect} — reframed', { aspect: engineText(a.label) }) }))]}
                        onChange={(v) => setC({ aspect: v })}
                      />
                    </Field>
                    <Field label={tr('Resolution')} labelWidth={LABEL_W}>
                      <Select value={resolutions.some((r) => r.value === custom.shortSide) ? custom.shortSide : 0} options={resolutions} onChange={(v) => setC({ shortSide: v })} />
                    </Field>
                  </>
                )}
                {(fmt.kind === 'video' || fmt.kind === 'gif' || fmt.kind === 'sequence') && (
                  <Field label={tr('Frame rate')} labelWidth={LABEL_W}>
                    <Select value={fpsOptions.some((o) => o.value === custom.fps) ? custom.fps : fpsOptions[fpsOptions.length - 1].value} options={fpsOptions} onChange={(v) => setC({ fps: v })} />
                  </Field>
                )}
                {(fmt.kind === 'video' || fmt.container === 'mp3') && (
                  <Field label={tr('Quality')} labelWidth={LABEL_W}>
                    <Segmented
                      value={custom.quality}
                      style={{ flex: 1 }}
                      options={[
                        { value: 'low', label: tr('Smaller file') },
                        { value: 'medium', label: tr('Balanced') },
                        { value: 'high', label: tr('High') },
                        { value: 'best', label: tr('Best') },
                      ]}
                      onChange={(v) => setC({ quality: v })}
                    />
                  </Field>
                )}
                {fmt.kind === 'video' && (
                  <details className="advanced">
                    <summary>{tr('Advanced')}</summary>
                    <Field label={tr('Encoder')} labelWidth={LABEL_W}>
                      <Select
                        value={custom.hardware}
                        options={[
                          { value: 'no-preference', label: tr('Automatic') },
                          { value: 'prefer-hardware', label: tr('Prefer GPU (faster)') },
                          { value: 'prefer-software', label: tr('Prefer CPU (most compatible)') },
                        ]}
                        onChange={(v) => setC({ hardware: v })}
                      />
                    </Field>
                    {fmt.container !== 'webm' && (
                      <Field label={tr('Web optimised')} labelWidth={LABEL_W} title={tr('Places the index at the start of the file so it starts playing sooner when streamed.')}>
                        <Toggle value={custom.fastStart} onChange={(v) => setC({ fastStart: v })} />
                        <span className="xd-row__hint">{tr('Fast start for streaming')}</span>
                      </Field>
                    )}
                  </details>
                )}
                {isGif && <p className="hint">{tr('GIFs are limited to 256 colours per frame and get large quickly — keep them short, small and at a low frame rate.')}</p>}
                {fmt.kind === 'sequence' && <p className="hint">{tr('Frames are saved as numbered PNG files in a new folder inside the folder you choose.')}</p>}
              </div>
            </section>
          )}

          {/* ---- Range ---- */}
          <section className="xd-sec">
            <div className="xd-sec__head">
              <span className="xd-sec__title">{tr('Range')}</span>
              <span className="xd-sec__meta">{tr('Mark a section on the timeline with I and O')}</span>
            </div>
            <div className="xd-row">
              <div className="segmented" style={{ flex: 'none' }} data-range-modes>
                {RANGE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={rangeMode === o.value ? 'is-active' : ''}
                    data-range={o.value}
                    disabled={(o.value === 'inout' && !inOutAvailable) || (o.value === 'selection' && selection.length === 0)}
                    title={o.value === 'inout' && !inOutAvailable ? tr('Mark In / Out on the timeline first (I / O)') : o.value === 'selection' && selection.length === 0 ? tr('Select clips on the timeline first') : undefined}
                    onClick={() => setRangeMode(o.value)}
                  >
                    {tMaybe(o.label)}
                  </button>
                ))}
              </div>
              {range.valid ? (
                <span className="xd-range" data-range-summary>
                  <Scissors size={12} />
                  <strong>{formatTimecode(range.start, pfps)}</strong>→<strong>{formatTimecode(range.end, pfps)}</strong>
                  <span>· {formatSeconds(range.end - range.start)}</span>
                </span>
              ) : (
                <span className="xd-note xd-note--warn">
                  <AlertTriangle size={13} />
                  {range.reason && engineText(range.reason)}
                </span>
              )}
            </div>
          </section>

          {/* ---- Captions ---- */}
          <section className="xd-sec">
            <div className="xd-sec__head">
              <span className="xd-sec__title">{tr('Captions')}</span>
              <span className="xd-sec__meta">{hasCaptions ? tr('{count, plural, one {# caption in this range} other {# captions in this range}}', { count: cueCount }) : tr('No caption track in this project')}</span>
            </div>
            {hasCaptions ? (
              <div className="xd-card">
                <div className="xd-row">
                  <span className="xd-row__label">{tr('Burn into the video')}</span>
                  <Toggle value={burnIn} onChange={setBurnIn} />
                  <span className="xd-row__hint">{burnIn ? tr('Captions are drawn into the picture') : tr('Caption tracks are hidden in this export')}</span>
                </div>
                <div className="xd-row">
                  <span className="xd-row__label">{tr('Subtitle files')}</span>
                  <div className="xd-chips">
                    {(['srt', 'vtt'] as SubtitleFormat[]).map((f) => (
                      <button key={f} type="button" className={`xd-chip ${sidecars.includes(f) ? 'is-on' : ''}`} data-sidecar={f} disabled={!anySidecarTarget} onClick={() => setSidecars((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]))}>
                        <Captions size={12} /> {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <span className="xd-row__hint">{tr('Saved next to each file, timed to the range')}</span>
                </div>
                <div className="xd-row">
                  <span className="xd-row__label">{tr('Embedded subtitles')}</span>
                  <Toggle value={embed && anyVideoContainer} disabled={!anyVideoContainer} onChange={setEmbed} />
                  <span className="xd-row__hint">{anyVideoContainer ? tr('A WebVTT track inside MP4 / WebM files — viewers can switch it on') : tr('Only MP4 and WebM files can carry a subtitle track')}</span>
                </div>
              </div>
            ) : (
              <div className="xd-note">
                <Info size={13} />
                <span>{tr('Captions are text clips on a captions track. Once the project has one you can burn them in, save SRT / VTT files and embed a subtitle track.')}</span>
              </div>
            )}
          </section>

          {/* ---- Audio ---- */}
          <section className="xd-sec">
            <div className="xd-row">
              <span className="xd-row__label xd-sec__title">{tr('Include audio')}</span>
              <Toggle value={audio && hasAudio} disabled={!hasAudio} onChange={setAudio} />
              <span className="xd-row__hint">{hasAudio ? tr('Mixed sound of every audible clip') : tr('No audio in this project')}</span>
            </div>
          </section>
        </div>

        {/* ---- Preview column ---- */}
        <aside className="xd-side">
          <div className="xd-sec__head">
            <span className="xd-sec__title">{tr('Preview')}</span>
            <span className="xd-sec__meta">{visualPlans.some((t) => t.reframed) ? tr('Adapted framing for each aspect') : tr('Frame of the export')}</span>
          </div>
          {plans.length === 0 ? (
            <div className="xd-empty">{tr('Pick a format to see how the export will look.')}</div>
          ) : (
            <div className="xd-previews">
              {plans.map((t) => (
                <TargetPreview key={t.key} plan={t} time={t.settings.container === 'png' ? engine.time : previewTime} renderer={renderer} box={box} />
              ))}
            </div>
          )}
          {visualPlans.length > 0 && range.valid && range.end - range.start > 1 / pfps && (
            <div className="xd-scrub">
              <span className="mono">{formatTimecode(previewTime, pfps)}</span>
              <input
                type="range"
                className="slider"
                min={range.start}
                max={Math.max(range.start, range.end - 1 / pfps)}
                step={1 / pfps}
                value={previewTime}
                style={{ ['--pct' as string]: `${((previewTime - range.start) / Math.max(1e-6, range.end - range.start)) * 100}%` }}
                title={tr('Preview another frame')}
                onChange={(e) => setPreviewAt(parseFloat(e.target.value))}
              />
            </div>
          )}
          {blocking.map((m) => (
            <div key={m} className="xd-note xd-note--warn">
              <AlertTriangle size={13} />
              <span>{m}</span>
            </div>
          ))}
          {notes.map((m) => (
            <div key={m} className="xd-note xd-note--warn">
              <Info size={13} />
              <span>{m}</span>
            </div>
          ))}
          {plans.length > 1 && (
            <div className="xd-note">
              <Info size={13} />
              <span>{tr('You will pick one folder; each export gets its own file name.')}</span>
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}

const getFormatAlpha = (id: string): boolean => !!FORMATS.find((f) => f.id === id)?.alpha;

