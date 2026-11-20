/**
 * Panels of the vision features, shared by the Smart tools tab and the inspector sections.
 */

import { Ban, Crosshair, Film, ScanFace, SquareDashedMousePointer, Undo2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatSeconds, formatTimecode } from '@/core/time';
import type { Cutout, ID, ImageClip, VideoClip, VisualClip } from '@/core/types';
import { engine } from '@/engine/engine';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { matchColor, referenceCandidates, revertColorMatch } from '@/vision/colorMatch';
import { ASPECTS, autoReframe, focusTrack, onFocusChanged, reframeAssets, type AspectId } from '@/vision/reframe';
import { detectScenes, retune, selectedCuts, shotStarts, splitAtCuts, thumbFor, timelineTime, toggleCut } from '@/vision/scenes';
import { useVision, type VisionJob } from '@/vision/store';
import { clearTracking, defaultTarget, startDrawing, stopDrawing, trackMotion, trackTargets } from '@/vision/tracking';
import { editVisual } from '../actions';
import { Field, Segmented, Select, SliderField, Toggle } from '../common/controls';
import { formatNumber, tMaybe, useT } from '../i18n';
import '@/styles/vision.css';

export const DEFAULT_CUTOUT: Cutout = { enabled: true, feather: 0.25, choke: 0 };

/** A number with a fixed count of decimals in the interface language. */
const fixed = (n: number, digits: number): string => formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });

// ---------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------

export function JobProgress({ job }: { job: VisionJob }): ReactNode {
  const t = useT();
  const pct = job.progress < 0 ? null : Math.round(job.progress * 100);
  return (
    <div className="vision-job" data-job={job.kind}>
      <div className="vision-job__row">
        <span className="vision-job__label truncate">{job.detail ?? job.label}</span>
        <span className="mono vision-job__pct">{pct === null ? '…' : `${pct}%`}</span>
        <button type="button" className="icon-btn icon-btn--sm" title={t('Cancel')} onClick={job.cancel} data-action="cancel-job">
          <Ban size={13} />
        </button>
      </div>
      <div className={`progress ${pct === null ? 'progress--busy' : ''}`}>
        <div className="progress__bar" style={{ width: `${pct ?? 30}%` }} />
      </div>
    </div>
  );
}

function SelectHint({ children }: { children: ReactNode }): ReactNode {
  return <p className="hint vision-hint">{children}</p>;
}

/** The primary selected clip (re-renders when it changes). */
export function useSelectedClip(): VisualClip | null {
  const id = useUI((s) => s.selection[0]);
  const clip = useProjectStore((s) => (id ? s.project.clips[id] : undefined));
  return clip && clip.type !== 'audio' ? clip : null;
}

// ---------------------------------------------------------------------------------------------
// Background removal
// ---------------------------------------------------------------------------------------------

export function CutoutControls({ clip, ids }: { clip: VideoClip | ImageClip; ids: ID[] }): ReactNode {
  const t = useT();
  const status = useVision((s) => s.cutout[clip.id]);
  const c = { ...DEFAULT_CUTOUT, enabled: false, ...(clip.cutout ?? {}) };
  const set = (patch: Partial<Cutout>, coalesce?: string): void =>
    editVisual(
      ids,
      (x) => {
        if (x.type === 'video' || x.type === 'image') x.cutout = { ...DEFAULT_CUTOUT, enabled: false, ...(x.cutout ?? {}), ...patch };
      },
      coalesce,
    );
  const label =
    !c.enabled ? null : status?.state === 'error' ? (
      <span className="vision-status vision-status--error" title={status.message}>
        {t('Unavailable')}
      </span>
    ) : status?.state === 'ready' ? (
      <span className="vision-status vision-status--ok">{status.ms !== undefined ? `${Math.round(status.ms)} ms · ${status.delegate ?? ''}` : t('Ready')}</span>
    ) : (
      <span className="vision-status">{t('Preparing…')}</span>
    );
  return (
    <div className="vision-cutout" data-cutout={c.enabled ? 'on' : 'off'}>
      <Field label={t('Enabled')} title={t('Remove the background behind people')}>
        <Toggle value={c.enabled} onChange={(v) => set({ enabled: v })} title={t('Cut out people and remove the background')} />
        {label}
      </Field>
      <SliderField label={t('Feather')} value={c.feather} min={0} max={1} step={0.01} scale={100} suffix="%" defaultValue={DEFAULT_CUTOUT.feather} disabled={!c.enabled} onChange={(v) => set({ feather: v })} />
      <SliderField label={t('Choke')} value={c.choke} min={-1} max={1} step={0.01} scale={100} suffix="%" bipolar defaultValue={0} disabled={!c.enabled} onChange={(v) => set({ choke: v })} />
      <p className="hint">{t('Keeps the people in the shot; layers below show through. Negative choke tightens the edge, positive grows it.')}</p>
    </div>
  );
}

export function CutoutTool(): ReactNode {
  const t = useT();
  const clip = useSelectedClip();
  const ids = useUI((s) => s.selection);
  if (!clip || (clip.type !== 'video' && clip.type !== 'image')) return <SelectHint>{t('Select a video or image clip with a person in it.')}</SelectHint>;
  return <CutoutControls clip={clip} ids={ids} />;
}

// ---------------------------------------------------------------------------------------------
// Auto-reframe
// ---------------------------------------------------------------------------------------------

export function ReframePanel(): ReactNode {
  const t = useT();
  const [aspect, setAspect] = useState<AspectId>('9:16');
  const project = useProjectStore((s) => s.project);
  const job = useVision((s) => s.jobs.reframe);
  const [, bump] = useState(0);
  useEffect(() => onFocusChanged(() => bump((n) => n + 1)), []);
  const assets = useMemo(() => reframeAssets(project), [project]);
  const current = project.settings.width / project.settings.height;
  return (
    <div className="vision-reframe">
      <div className="format-grid format-grid--4">
        {ASPECTS.map((a) => (
          <button key={a.id} type="button" data-aspect={a.id} className={`format-tile ${aspect === a.id ? 'is-active' : ''}`} onClick={() => setAspect(a.id)} title={tMaybe(a.hint)}>
            <span className="format-tile__shape" style={{ aspectRatio: `${a.w} / ${a.h}` }} />
            <strong>{a.label}</strong>
            {Math.abs(a.w / a.h - current) < 0.01 && <small>{t('current')}</small>}
          </button>
        ))}
      </div>
      {job ? (
        <JobProgress job={job} />
      ) : (
        <button type="button" className="btn btn--sm btn--primary btn--block" data-action="auto-reframe" disabled={assets.length === 0} onClick={() => void autoReframe(aspect)}>
          <Wand2 size={13} /> {t('Create {aspect} copy', { aspect })}
        </button>
      )}
      {assets.length === 0 ? (
        <SelectHint>{t('Add video or photos to the timeline first.')}</SelectHint>
      ) : (
        <ul className="vision-assets">
          {assets.map((a) => {
            const tr = focusTrack(a);
            const share = (k: string): number => Math.round((tr?.sources[k] ?? 0) * 100);
            const shares: [number, (percent: number) => string][] = [
              [share('face'), (percent) => t('faces {percent}%', { percent })],
              [share('object'), (percent) => t('subjects {percent}%', { percent })],
              [share('saliency'), (percent) => t('saliency {percent}%', { percent })],
            ];
            const parts = shares.filter(([v]) => v >= 5).map(([v, text]) => text(v));
            return (
              <li key={a.id} title={tr ? t('How the subject was found in the analysed frames') : undefined}>
                <Film size={12} />
                <span className="truncate">{a.name}</span>
                <small>{tr ? parts.join(' · ') || t('centre') : t('not analysed')}</small>
              </li>
            );
          })}
        </ul>
      )}
      <p className="hint">{t('Finds faces, then people and other subjects (falling back to visual saliency), and pans a smooth virtual camera to keep them in frame. Opens a new unsaved project — this one is not changed.')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Scene detection
// ---------------------------------------------------------------------------------------------

export function ScenePanel({ clip }: { clip: VideoClip }): ReactNode {
  const t = useT();
  const state = useVision((s) => s.scenes[clip.id]);
  const job = useVision((s) => s.jobs[`scenes:${clip.id}`]);
  const fps = useProjectStore((s) => s.project.settings.fps);
  if (job) return <JobProgress job={job} />;
  if (!state) {
    return (
      <>
        <p className="hint">{t('Finds the cuts inside this clip so you can split it into its shots.')}</p>
        <button type="button" className="btn btn--sm btn--primary btn--block" data-action="detect-scenes" onClick={() => void detectScenes(clip.id)}>
          <ScanFace size={13} /> {t('Detect scenes')}
        </button>
      </>
    );
  }
  const selected = selectedCuts(state);
  const shots = shotStarts(state);
  return (
    <div className="vision-scenes">
      <SliderField label={t('Sensitivity')} value={state.sensitivity} min={0} max={1} step={0.05} scale={100} suffix="%" defaultValue={0.5} onChange={(v) => retune(clip.id, { sensitivity: v })} />
      <SliderField label={t('Min. shot')} value={state.minShot} min={0.2} max={3} step={0.1} precision={1} suffix="s" defaultValue={0.6} onChange={(v) => retune(clip.id, { minShot: v })} />
      <div className="scene-list" data-scenes={shots.length}>
        {shots.map((s, i) => {
          const end = i + 1 < shots.length ? shots[i + 1] : state.end;
          const isCut = i > 0;
          const on = isCut && !state.excluded.some((x) => Math.abs(x - s) < 1e-6);
          const thumb = thumbFor(state, s);
          return (
            <div key={s} className={`scene-row ${isCut && !on ? 'is-off' : ''}`} data-scene={i}>
              <button type="button" className="scene-row__thumb" title={t('Show this shot')} onClick={() => engine.seek(timelineTime(clip, s) + 0.5 / fps)}>
                {thumb ? <img src={thumb} alt="" /> : <span />}
              </button>
              <div className="scene-row__text">
                <strong>{t('Shot {number}', { number: i + 1 })}</strong>
                <small className="mono">
                  {formatTimecode(timelineTime(clip, s), fps)} · {formatSeconds((end - s) / (clip.speed || 1))}
                </small>
              </div>
              {isCut && (
                <label className="scene-row__check" title={t('Split here')}>
                  <input type="checkbox" checked={on} onChange={(e) => toggleCut(clip.id, s, e.target.checked)} />
                  <span>{t('cut')}</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
      <div className="btn-row">
        <button type="button" className="btn btn--sm btn--primary" data-action="split-scenes" disabled={selected.length === 0} onClick={() => splitAtCuts(clip.id, selected)}>
          {t('{count, plural, one {Split at # cut} other {Split at # cuts}}', { count: selected.length })}
        </button>
        <button type="button" className="btn btn--sm btn--outline" onClick={() => void detectScenes(clip.id)}>
          {t('Re-analyse')}
        </button>
      </div>
      <p className="hint">
        {t('{count, plural, one {# frame analysed in {seconds} s.} other {# frames analysed in {seconds} s.}}', { count: state.stats.length, seconds: fixed(state.ms / 1000, 1) })} {state.cuts.length === 0 ? t('No cuts found — try a higher sensitivity.') : ''}
      </p>
    </div>
  );
}

export function SceneTool(): ReactNode {
  const t = useT();
  const clip = useSelectedClip();
  if (!clip || clip.type !== 'video') return <SelectHint>{t('Select a video clip to find its scene changes.')}</SelectHint>;
  return <ScenePanel clip={clip} />;
}

// ---------------------------------------------------------------------------------------------
// Colour match
// ---------------------------------------------------------------------------------------------

function Compare({ before, after, w, h }: { before: string; after: string; w: number; h: number }): ReactNode {
  const t = useT();
  const [split, setSplit] = useState(0.5);
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent): void => {
    if (!ref.current || (e.type === 'pointermove' && !(e.buttons & 1))) return;
    const r = ref.current.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  return (
    <div ref={ref} className="vision-compare" style={{ aspectRatio: `${w} / ${h}` }} onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e); }} onPointerMove={move} title={t('Drag to compare')}>
      <img src={after} alt={t('After')} draggable={false} />
      <div className="vision-compare__before" style={{ width: `${split * 100}%` }}>
        <img src={before} alt={t('Before')} draggable={false} style={{ width: `${100 / Math.max(0.001, split)}%` }} />
      </div>
      <div className="vision-compare__line" style={{ left: `${split * 100}%` }} />
      <span className="vision-compare__tag vision-compare__tag--l">{t('Before')}</span>
      <span className="vision-compare__tag vision-compare__tag--r">{t('After')}</span>
    </div>
  );
}

export function ColorMatchPanel({ clip }: { clip: VideoClip | ImageClip }): ReactNode {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const candidates = useMemo(() => referenceCandidates(project, clip.id), [project, clip.id]);
  const state = useVision((s) => s.color[clip.id]);
  const job = useVision((s) => s.jobs[`color:${clip.id}`]);
  const [refId, setRefId] = useState<ID>(state?.referenceId ?? '');
  const [mode, setMode] = useState<'clip' | 'playhead'>('clip');
  const [strength, setStrength] = useState(1);
  const reference = candidates.find((c) => c.id === refId) ?? candidates[0];
  if (candidates.length === 0) return <SelectHint>{t('Add another video or image clip to use as the reference.')}</SelectHint>;
  return (
    <div className="vision-color">
      <Field label={t('Reference')}>
        <Select value={reference?.id ?? ''} options={candidates.map((c) => ({ value: c.id, label: `${c.name} · ${formatSeconds(c.start)}` }))} onChange={(v) => setRefId(v)} />
      </Field>
      <Field label={t('Sample')}>
        <Segmented
          value={mode}
          style={{ flex: 1 }}
          onChange={setMode}
          options={[
            { value: 'clip', label: t('Whole clip'), title: t('Average look of the reference clip') },
            { value: 'playhead', label: t('Frame at playhead'), title: t('Only the reference frame under the playhead') },
          ]}
        />
      </Field>
      <SliderField label={t('Strength')} value={strength} min={0} max={1} step={0.05} scale={100} suffix="%" defaultValue={1} onChange={setStrength} />
      {job ? (
        <JobProgress job={job} />
      ) : (
        <button type="button" className="btn btn--sm btn--primary btn--block" data-action="match-color" disabled={!reference} onClick={() => reference && void matchColor(clip.id, reference.id, { strength, referenceFrame: mode })}>
          <Wand2 size={13} /> {t('Match colour')}
        </button>
      )}
      {state && (
        <div className="vision-color__result" data-color-result>
          <div className="vision-color__thumbs">
            <figure>
              <img src={state.previews.reference} alt="" />
              <figcaption>{t('Reference')}</figcaption>
            </figure>
            <div className="vision-color__compare">
              <Compare before={state.previews.before} after={state.previews.after} w={state.previews.w} h={state.previews.h} />
            </div>
          </div>
          <p className="hint">
            {t('Difference {before} → {after}. Values are in the Adjust tab and stay editable.', { before: fixed(state.distanceBefore, 2), after: fixed(state.distanceAfter, 2) })}
          </p>
          <button type="button" className="btn btn--sm btn--outline" onClick={() => revertColorMatch(clip.id)}>
            <Undo2 size={13} /> {t('Revert')}
          </button>
        </div>
      )}
    </div>
  );
}

export function ColorTool(): ReactNode {
  const t = useT();
  const clip = useSelectedClip();
  if (!clip || (clip.type !== 'video' && clip.type !== 'image')) return <SelectHint>{t('Select the clip to correct, then pick the reference clip to match.')}</SelectHint>;
  return <ColorMatchPanel clip={clip} />;
}

// ---------------------------------------------------------------------------------------------
// Motion tracking
// ---------------------------------------------------------------------------------------------

export function TrackPanel({ follower }: { follower: VisualClip }): ReactNode {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const targets = useMemo(() => trackTargets(project, follower.id), [project, follower.id]);
  const draw = useVision((s) => (s.draw?.followerId === follower.id ? s.draw : null));
  const job = useVision((s) => s.jobs[`track:${follower.id}`]);
  const track = useVision((s) => s.tracks[follower.id]);
  const [videoId, setVideoId] = useState<ID>(() => defaultTarget(project, follower.id)?.id ?? '');
  const video = targets.find((t) => t.id === videoId) ?? targets[0];
  useEffect(() => () => stopDrawing(), []);
  if (!video) return <SelectHint>{t('Put this layer above a video clip (on a higher track, at the same time) to make it follow something in the video.')}</SelectHint>;
  const hasKeys = !!(follower.keyframes?.x?.length || follower.keyframes?.y?.length);
  return (
    <div className="vision-track">
      <Field label={t('Video')}>
        <Select
          value={video.id}
          options={targets.map((v) => ({ value: v.id, label: v.name }))}
          onChange={(v) => {
            setVideoId(v);
            if (draw?.active) startDrawing(follower.id, v);
          }}
        />
      </Field>
      <div className="btn-row">
        <button
          type="button"
          className={`btn btn--sm ${draw?.active ? 'btn--primary' : 'btn--outline'}`}
          data-action="draw-box"
          onClick={() => (draw?.active ? stopDrawing() : startDrawing(follower.id, video.id))}
          title={t('Drag a box around the object on the preview')}
        >
          <SquareDashedMousePointer size={13} /> {draw?.active ? t('Drawing…') : draw?.box ? t('Redraw box') : t('Draw box')}
        </button>
        {job ? null : (
          <button type="button" className="btn btn--sm btn--primary" data-action="track-motion" disabled={!draw?.box} onClick={() => draw?.box && void trackMotion(follower.id, video.id, draw.box)}>
            <Crosshair size={13} /> {t('Track motion')}
          </button>
        )}
      </div>
      {job && <JobProgress job={job} />}
      {draw?.active && <p className="hint">{t('Drag a box around the object at the playhead. Pick something with texture and contrast.')}</p>}
      {track && !job && (
        <p className="hint" data-track-result>
          {t('{frames, plural, one {Tracked # frame} other {Tracked # frames}} in {seconds} s → {keyframes, plural, one {# keyframe} other {# keyframes}} on position.', { frames: track.frames, seconds: fixed(track.ms / 1000, 1), keyframes: track.keyframes })}
        </p>
      )}
      {hasKeys && !job && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => clearTracking(follower.id)}>
          {t('Clear position keyframes')}
        </button>
      )}
      <p className="hint">{t('The layer keeps its current offset from the object. Tracking runs forward and backward from the playhead.')}</p>
    </div>
  );
}

export function TrackTool(): ReactNode {
  const t = useT();
  const clip = useSelectedClip();
  if (!clip || !['text', 'sticker', 'shape'].includes(clip.type)) return <SelectHint>{t('Select a text, sticker or shape that sits above a video, then draw a box around what it should follow.')}</SelectHint>;
  return <TrackPanel follower={clip} />;
}
