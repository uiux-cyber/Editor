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
import { KeyframeButton, useLiveProp } from '../../shared';
import { localTimeOf } from '../../../keyframeOps';
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
    <Section title="Speed" id="speed">
      <Segmented
        value={curve ? 'curve' : 'normal'}
        options={[
          { value: 'normal', label: 'Normal', title: 'One speed for the whole clip' },
          { value: 'curve', label: 'Curve', title: 'Speed ramp: the speed changes along the clip' },
        ]}
        onChange={setMode}
      />
      {!curve ? (
        <>
          <Field label="Speed">
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
              <button key={p.id} type="button" className={`ramp-tile ${samePoints(p.points, points) ? 'is-active' : ''}`} title={`${p.name} (average ${formatSpeed(curveAverage(p.points))})`} onClick={() => setClipSpeed(media, p.points, {})} data-ramp={p.id}>
                <CurveThumb points={p.points} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
          <SpeedCurve clip={clip} ids={media} />
        </>
      )}
      <Field label="Duration">
        <span className="mono" style={{ color: 'var(--text-0)' }}>
          {formatSeconds(clip.duration)}
        </span>
        <span style={{ color: 'var(--text-3)' }}>
          {formatSeconds(range.to - range.from)} of media{Number.isFinite(max) && max > clip.duration + 0.05 ? ` · up to ${formatSeconds(max)}` : ''}
        </span>
      </Field>
      <p className="hint">The clip keeps its content when the speed changes, so its length follows. {curve ? 'Drag points on the curve; hold Alt to move them freely.' : ''}</p>
    </Section>
  );
}

function PlaybackSection({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  if (!isMedia(clip)) return null;
  const changed = !!clip.speedRamp?.length || Math.abs(clip.speed - 1) > 1e-4;
  return (
    <Section title="Playback" id="playback">
      <Field label="Reverse" title="Play the clip backwards">
        <Toggle value={!!clip.reverse} onChange={(v) => setReverse(ids, v)} />
        <Rewind size={14} style={{ color: clip.reverse ? 'var(--accent-hi)' : 'var(--text-3)' }} />
      </Field>
      <Field label="Keep pitch" title="Preserve the pitch of the sound when the speed changes">
        <Toggle value={!!clip.preservePitch} onChange={(v) => setPreservePitch(ids, v)} />
      </Field>
      <p className="hint">
        {clip.preservePitch
          ? changed
            ? 'The sound is time-stretched so voices and music keep their pitch, also through speed ramps. Above about 4× it becomes choppy.'
            : 'Takes effect when the speed is not 1×.'
          : 'Off: like tape, the pitch rises when the clip is faster and drops when it is slower.'}
      </p>
    </Section>
  );
}

function FreezeSection({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const fps = useProjectStore((s) => s.project.settings.fps);
  if (clip.type !== 'video' || !clip.freeze) return null;
  return (
    <Section title="Freeze frame" id="freeze">
      <div className="freeze-card">
        <Snowflake size={16} />
        <span>
          Holds the frame at <span className="mono">{formatTimecode(clip.trimIn, fps)}</span> of the source. The sound is silent while the picture is frozen.
        </span>
      </div>
      <Field label="Hold for">
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
  if (clip.type !== 'compound') return null;
  const sum = compoundSummary(clip);
  return (
    <>
      <Section title="Compound clip" id="compound">
        <div className="compound-card">
          <Layers size={18} />
          <div>
            <strong>
              {sum.clips} clip{sum.clips === 1 ? '' : 's'} on {sum.tracks} track{sum.tracks === 1 ? '' : 's'}
            </strong>
            <span>
              {sum.visual} visual · {sum.audio} audio · shows {formatSeconds(clip.duration)} from {formatSeconds(clip.trimIn)}
            </span>
          </div>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn--sm btn--outline" style={{ flex: 1 }} onClick={() => openCompound(clip.id)} title="Edit the clips inside (or double-click it on the timeline)">
            <FolderOpen size={13} /> Open
          </button>
          <button type="button" className="btn btn--sm btn--outline" style={{ flex: 1 }} onClick={breakApartSelection} title="Put its clips back on the timeline (Alt+Shift+G)">
            <Ungroup size={13} /> Break apart
          </button>
        </div>
        <p className="hint">Transform, animate, grade and add effects here to treat everything inside as one layer.</p>
      </Section>
      <CropSection clip={clip} ids={ids} />
    </>
  );
}

function CompoundAudioSection({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
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
    <Section title="Volume" id="compound-volume">
      <SliderField label="Volume" value={volume} min={0} max={2} step={0.01} scale={100} suffix="%" defaultValue={1} disabled={clip.muted} onChange={setVolume} lead={<KeyframeButton clip={clip} ids={ids} props={['volume']} />} />
      <Field label="Mute">
        <Toggle value={clip.muted} onChange={(v) => edit((c) => void (c.muted = v))} />
        {clip.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </Field>
      <SliderField label="Fade in" value={Math.min(clip.fadeIn, maxFade)} min={0} max={Math.min(10, maxFade)} step={0.05} precision={2} suffix="s" defaultValue={0} onChange={(v) => edit((c) => void (c.fadeIn = v))} />
      <SliderField label="Fade out" value={Math.min(clip.fadeOut, maxFade)} min={0} max={Math.min(10, maxFade)} step={0.05} precision={2} suffix="s" defaultValue={0} onChange={(v) => edit((c) => void (c.fadeOut = v))} />
      <p className="hint">Applies on top of the levels of the clips inside.</p>
    </Section>
  );
}

const sections: InspectorSectionDef[] = [
  { id: 'time.speed', tab: 'speed', tabLabel: 'Speed', order: 10, applies: (c) => isMedia(c) && !c.freeze, Component: SpeedSection },
  { id: 'time.playback', tab: 'speed', order: 20, applies: (c) => isMedia(c) && !c.freeze, Component: PlaybackSection },
  { id: 'time.freeze', tab: 'speed', tabLabel: 'Speed', order: 10, applies: (c) => c.type === 'video' && !!c.freeze, Component: FreezeSection },
  { id: 'compound.panel', tab: 'edit', order: 5, applies: (c) => c.type === 'compound', Component: CompoundSection },
  { id: 'compound.audio', tab: 'sound', tabLabel: 'Audio', order: 10, applies: (c) => c.type === 'compound', Component: CompoundAudioSection },
];

export default sections;
