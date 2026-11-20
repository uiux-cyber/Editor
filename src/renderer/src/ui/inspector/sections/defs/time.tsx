/**
 * Inspector sections for time remapping (Speed tab of video / audio clips) and compound clips
 * (Compound clip panel on the edit tab, Audio tab of compound clips).
 */

import { FolderOpen, Layers, Rewind, Snowflake, Ungroup, Volume2, VolumeX } from 'lucide-react';
import type { ReactNode } from 'react';
import { compoundSummary } from '@/core/compound';
import { withKeyframe } from '@/core/keyframes';
import { formatSeconds, formatTimecode } from '@/core/time';
import { RAMP_PRESETS, averageSpeed, curveAverage, maxDurationFor, sourceRange, type CurvePoint } from '@/core/timemap';
import type { AudioClip, Clip, CompoundClip, ID, VideoClip } from '@/core/types';
import { useProjectStore } from '@/store/project';
import { editClips } from '../../../actions';
import { Field, NumberInput, Section, Segmented, Slider, SliderField, Toggle } from '../../../common/controls';
import { CropSection } from '../../EditTab';
import { KeyframeButton, rich, useLiveProp } from '../../shared';
import { localTimeOf } from '../../../keyframeOps';
import { tk, useT } from '../../../i18n';
import { CurveThumb, SpeedCurve, clipCurve, formatSpeed } from '../../../time/SpeedCurve';
import { breakApartSelection, openCompound, setClipSpeed, setPreservePitch, setReverse } from '../../../time/timeActions';
import type { InspectorSectionDef } from '../index';

type Media = VideoClip | AudioClip;
const isMedia = (c: Clip): c is Media => c.type === 'video' || c.type === 'audio';

const CHIPS = [0.25, 0.5, 1, 1.5, 2, 4, 8];

const samePoints = (a: CurvePoint[], b: CurvePoint[]): boolean => a.length === b.length && a.every((p, i) => Math.abs(p.u - b[i].u) < 0.005 && Math.abs(p.v - b[i].v) < 0.01);

// ---------------------------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------------------------

function SpeedSection({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const t = useT();
  const asset = useProjectStore((s) => (isMedia(clip) ? s.project.assets[clip.assetId] : undefined));
  if (!isMedia(clip)) return null;
  const media = ids;
  const curve = !!clip.speedRamp?.length;
  const points = clipCurve(clip);
  const range = sourceRange(clip);
  const max = maxDurationFor(clip, asset ? { [asset.id]: asset } : {});
  const setMode = (mode: 'normal' | 'curve'): void => {
    if (mode === 'curve' && !curve) setClipSpeed(media, [0, 0.25, 0.5, 0.75, 1].map((u) => ({ u, v: clip.speed })), {});
    // Back to a constant speed: the average keeps the clip's length and content.
    if (mode === 'normal' && curve) setClipSpeed(media, Math.round(averageSpeed(clip) * 100) / 100, {});
  };
  return (
    <Section title={t('Speed')} id="speed">
      <Segmented
        value={curve ? 'curve' : 'normal'}
        options={[
          { value: 'normal', label: t('Normal'), title: t('One speed for the whole clip') },
          { value: 'curve', label: t('Curve'), title: t('Speed ramp: the speed changes along the clip') },
        ]}
        onChange={setMode}
      />
      {!curve ? (
        <>
          <Field label={t('Speed')}>
            <Slider value={Math.log2(clip.speed)} min={Math.log2(0.1)} max={4} step={0.01} defaultValue={0} onChange={(v) => setClipSpeed(media, Math.round(Math.pow(2, v) * 100) / 100)} />
            <NumberInput value={clip.speed} min={0.1} max={16} step={0.05} precision={2} suffix="×" onChange={(v) => setClipSpeed(media, v, {})} style={{ flex: 'none', width: 64 }} />
          </Field>
          <div className="btn-row btn-row--wrap">
            {CHIPS.map((s) => (
              <button key={s} type="button" className={`chip ${Math.abs(clip.speed - s) < 0.001 ? 'is-active' : ''}`} onClick={() => setClipSpeed(media, s, {})}>
                {s}×
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="ramp-presets">
            {RAMP_PRESETS.map((p) => (
              <button key={p.id} type="button" className={`ramp-tile ${samePoints(p.points, points) ? 'is-active' : ''}`} title={t('{name} (average {speed})', { name: p.name, speed: formatSpeed(curveAverage(p.points)) })} onClick={() => setClipSpeed(media, p.points, {})} data-ramp={p.id}>
                <CurveThumb points={p.points} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
          <SpeedCurve clip={clip} ids={media} />
        </>
      )}
      <Field label={t('Duration')}>
        <span className="mono" style={{ color: 'var(--text-0)' }}>
          {formatSeconds(clip.duration)}
        </span>
        <span style={{ color: 'var(--text-3)' }}>
          {t('{duration} of media', { duration: formatSeconds(range.to - range.from) })}
          {Number.isFinite(max) && max > clip.duration + 0.05 ? ` · ${t('up to {duration}', { duration: formatSeconds(max) })}` : ''}
        </span>
      </Field>
      <p className="hint">
        {t('The clip keeps its content when the speed changes, so its length follows.')} {curve ? t('Drag points on the curve; hold Alt to move them freely.') : ''}
      </p>
    </Section>
  );
}

function PlaybackSection({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const t = useT();
  if (!isMedia(clip)) return null;
  const changed = !!clip.speedRamp?.length || Math.abs(clip.speed - 1) > 1e-4;
  return (
    <Section title={t('Playback')} id="playback">
      <Field label={t('Reverse')} title={t('Play the clip backwards')}>
        <Toggle value={!!clip.reverse} onChange={(v) => setReverse(ids, v)} />
        <Rewind size={14} style={{ color: clip.reverse ? 'var(--accent-hi)' : 'var(--text-3)' }} />
      </Field>
      <Field label={t('Keep pitch')} title={t('Preserve the pitch of the sound when the speed changes')}>
        <Toggle value={!!clip.preservePitch} onChange={(v) => setPreservePitch(ids, v)} />
      </Field>
      <p className="hint">
        {clip.preservePitch
          ? changed
            ? t('The sound is time-stretched so voices and music keep their pitch, also through speed ramps. Above about 4× it becomes choppy.')
            : t('Takes effect when the speed is not 1×.')
          : t('Off: like tape, the pitch rises when the clip is faster and drops when it is slower.')}
      </p>
    </Section>
  );
}

function FreezeSection({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const t = useT();
  const fps = useProjectStore((s) => s.project.settings.fps);
  if (clip.type !== 'video' || !clip.freeze) return null;
  return (
    <Section title={t('Freeze frame')} id="freeze">
      <div className="freeze-card">
        <Snowflake size={16} />
        <span>
          {rich(t('Holds the frame at {time} of the source. The sound is silent while the picture is frozen.'), {
            time: <span className="mono">{formatTimecode(clip.trimIn, fps)}</span>,
          })}
        </span>
      </div>
      <Field label={t('Hold for')}>
        <NumberInput
          value={clip.duration}
          min={1 / fps}
          max={600}
          step={0.1}
          precision={2}
          suffix="s"
          onChange={(v) =>
            editClips(ids, (c) => {
              if (c.type === 'video' && c.freeze) c.duration = Math.max(1 / fps, Math.round(v * fps) / fps);
            })
          }
        />
      </Field>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Compound clips
// ---------------------------------------------------------------------------------------------

function CompoundSection({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const t = useT();
  if (clip.type !== 'compound') return null;
  const sum = compoundSummary(clip);
  return (
    <>
      <Section title={t('Compound clip')} id="compound">
        <div className="compound-card">
          <Layers size={18} />
          <div>
            <strong>{t('{clips, plural, one {# clip} other {# clips}} on {tracks, plural, one {# track} other {# tracks}}', { clips: sum.clips, tracks: sum.tracks })}</strong>
            <span>
              {t('{visual, plural, one {# visual} other {# visual}} · {audio, plural, one {# audio} other {# audio}} · shows {duration} from {start}', {
                visual: sum.visual,
                audio: sum.audio,
                duration: formatSeconds(clip.duration),
                start: formatSeconds(clip.trimIn),
              })}
            </span>
          </div>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn--sm btn--outline" style={{ flex: 1 }} onClick={() => openCompound(clip.id)} title={t('Edit the clips inside (or double-click it on the timeline)')}>
            <FolderOpen size={13} /> {t('Open')}
          </button>
          <button type="button" className="btn btn--sm btn--outline" style={{ flex: 1 }} onClick={breakApartSelection} title={t('Put its clips back on the timeline (Alt+Shift+G)')}>
            <Ungroup size={13} /> {t('Break apart')}
          </button>
        </div>
        <p className="hint">{t('Transform, animate, grade and add effects here to treat everything inside as one layer.')}</p>
      </Section>
      <CropSection clip={clip} ids={ids} />
    </>
  );
}

function CompoundAudioSection({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const t = useT();
  const volume = useLiveProp(clip, 'volume');
  if (clip.type !== 'compound') return null;
  const maxFade = Math.max(0, clip.duration / 2);
  const edit = (recipe: (c: CompoundClip) => void): void =>
    editClips(ids, (c) => {
      if (c.type === 'compound') recipe(c);
    });
  const setVolume = (v: number): void =>
    edit((c) => {
      const frames = c.keyframes?.volume;
      if (frames?.length) c.keyframes!.volume = withKeyframe(frames, localTimeOf(c), v);
      else c.volume = v;
    });
  return (
    <Section title={t('Volume')} id="compound-volume">
      <SliderField label={t('Volume')} value={volume} min={0} max={2} step={0.01} scale={100} suffix="%" defaultValue={1} disabled={clip.muted} onChange={setVolume} lead={<KeyframeButton clip={clip} ids={ids} props={['volume']} />} />
      <Field label={t('Mute')}>
        <Toggle value={clip.muted} onChange={(v) => edit((c) => void (c.muted = v))} />
        {clip.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </Field>
      <SliderField label={t('Fade in')} value={Math.min(clip.fadeIn, maxFade)} min={0} max={Math.min(10, maxFade)} step={0.05} precision={2} suffix="s" defaultValue={0} onChange={(v) => edit((c) => void (c.fadeIn = v))} />
      <SliderField label={t('Fade out')} value={Math.min(clip.fadeOut, maxFade)} min={0} max={Math.min(10, maxFade)} step={0.05} precision={2} suffix="s" defaultValue={0} onChange={(v) => edit((c) => void (c.fadeOut = v))} />
      <p className="hint">{t('Applies on top of the levels of the clips inside.')}</p>
    </Section>
  );
}

const sections: InspectorSectionDef[] = [
  { id: 'time.speed', tab: 'speed', tabLabel: tk('Speed'), order: 10, applies: (c) => isMedia(c) && !c.freeze, Component: SpeedSection },
  { id: 'time.playback', tab: 'speed', order: 20, applies: (c) => isMedia(c) && !c.freeze, Component: PlaybackSection },
  { id: 'time.freeze', tab: 'speed', tabLabel: tk('Speed'), order: 10, applies: (c) => c.type === 'video' && !!c.freeze, Component: FreezeSection },
  { id: 'compound.panel', tab: 'edit', order: 5, applies: (c) => c.type === 'compound', Component: CompoundSection },
  { id: 'compound.audio', tab: 'sound', tabLabel: tk('Audio'), order: 10, applies: (c) => c.type === 'compound', Component: CompoundAudioSection },
];

export default sections;
