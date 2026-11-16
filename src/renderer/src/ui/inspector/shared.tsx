import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react';
import type { ReactNode } from 'react';
import { hasKeyframes, propAt } from '@/core/keyframes';
import type { Clip, ID, KeyframeProp, Paint, ParamValue } from '@/core/types';
import { usePlayback } from '@/engine/engine';
import type { ParamDef } from '@/library/types';
import { ColorInput, Field, NumberInput, Segmented, Select, SliderField, Toggle } from '../common/controls';
import { clearKeyframes, hasKeyframeAtPlayhead, jumpKeyframe, localTimeOf, toggleKeyframe } from '../keyframeOps';
import { openContextMenu } from '../common/overlays';

/** Current (possibly keyframed) value of a property at the playhead. */
export function useLiveProp(clip: Clip, prop: KeyframeProp): number {
  // Re-evaluate as the playhead moves.
  usePlayback((s) => s.time);
  return propAt(clip, prop, localTimeOf(clip));
}

/** Keyframe toggle with previous / next navigation for one or more linked properties. */
export function KeyframeButton({ clip, ids, props }: { clip: Clip; ids: ID[]; props: KeyframeProp[] }): ReactNode {
  usePlayback((s) => s.time);
  const animated = props.some((p) => hasKeyframes(clip, p));
  const here = props.every((p) => hasKeyframeAtPlayhead(clip, p));
  return (
    <span className="kf">
      {animated && (
        <button type="button" className="kf__nav" title="Previous keyframe" onClick={() => jumpKeyframe(clip, props, -1)}>
          <ChevronLeft size={11} />
        </button>
      )}
      <button
        type="button"
        className={`kf__btn ${here ? 'is-on' : animated ? 'is-animated' : ''}`}
        title={here ? 'Remove keyframe at the playhead' : 'Add keyframe at the playhead'}
        onClick={() => toggleKeyframe(ids, props)}
        onContextMenu={(e) =>
          animated &&
          openContextMenu(e, [{ label: 'Remove all keyframes', danger: true, run: () => clearKeyframes(ids, props) }])
        }
      >
        <Diamond size={11} fill={here ? 'currentColor' : 'none'} />
      </button>
      {animated && (
        <button type="button" className="kf__nav" title="Next keyframe" onClick={() => jumpKeyframe(clip, props, 1)}>
          <ChevronRight size={11} />
        </button>
      )}
    </span>
  );
}

/** Controls generated from a pack item's parameter definitions. */
export function ParamControls({ defs, values, onChange }: { defs: ParamDef[]; values: Record<string, ParamValue>; onChange: (key: string, value: ParamValue) => void }): ReactNode {
  if (defs.length === 0) return <p className="hint">This item has no adjustable settings.</p>;
  return (
    <>
      {defs.map((def) => {
        const raw = values[def.key] ?? def.default;
        if (def.type === 'color') {
          return (
            <Field key={def.key} label={def.label}>
              <ColorInput value={typeof raw === 'string' ? raw : String(def.default)} onChange={(v) => onChange(def.key, v.slice(0, 7))} />
            </Field>
          );
        }
        if (def.type === 'bool') {
          return (
            <Field key={def.key} label={def.label}>
              <Toggle value={raw === true || raw === 1} onChange={(v) => onChange(def.key, v)} />
            </Field>
          );
        }
        if (def.type === 'select') {
          return (
            <Field key={def.key} label={def.label}>
              <Select value={Number(raw)} options={(def.options ?? []).map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => onChange(def.key, v)} />
            </Field>
          );
        }
        const min = def.min ?? 0;
        const max = def.max ?? 1;
        const step = def.step ?? (def.type === 'int' ? 1 : (max - min) / 100);
        const precision = def.type === 'int' ? 0 : step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
        return (
          <SliderField
            key={def.key}
            label={def.label}
            value={Number(raw)}
            min={min}
            max={max}
            step={step}
            precision={precision}
            defaultValue={Number(def.default)}
            bipolar={min < 0 && max > 0}
            suffix={def.unit === '°' ? '°' : undefined}
            onChange={(v) => onChange(def.key, def.type === 'int' ? Math.round(v) : v)}
          />
        );
      })}
    </>
  );
}

/** Solid / gradient paint editor. Gradients are edited as start + end colour and an angle. */
export function PaintEditor({ paint, onChange }: { paint: Paint; onChange: (p: Paint) => void }): ReactNode {
  const first = paint.type === 'solid' ? paint.color : (paint.stops[0]?.color ?? '#ffffff');
  const last = paint.type === 'solid' ? paint.color : (paint.stops[paint.stops.length - 1]?.color ?? '#ffffff');
  return (
    <>
      <Field label="Fill">
        <Segmented
          value={paint.type}
          style={{ flex: 1 }}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
          ]}
          onChange={(type) => {
            if (type === paint.type) return;
            if (type === 'solid') onChange({ type: 'solid', color: first });
            else {
              const stops = paint.type === 'solid' ? [{ offset: 0, color: first }, { offset: 1, color: '#22d3ee' }] : paint.stops;
              onChange(type === 'linear' ? { type: 'linear', angle: paint.type === 'linear' ? paint.angle : 90, stops } : { type: 'radial', stops });
            }
          }}
        />
      </Field>
      {paint.type === 'solid' ? (
        <Field label="Color">
          <ColorInput value={paint.color} alpha swatches onChange={(color) => onChange({ type: 'solid', color })} />
        </Field>
      ) : (
        <>
          <Field label={paint.type === 'radial' ? 'Centre' : 'Start'}>
            <ColorInput
              value={first}
              onChange={(color) => {
                const stops = paint.stops.map((s, i) => (i === 0 ? { ...s, color } : s));
                onChange({ ...paint, stops });
              }}
            />
          </Field>
          <Field label={paint.type === 'radial' ? 'Edge' : 'End'}>
            <ColorInput
              value={last}
              onChange={(color) => {
                const stops = paint.stops.map((s, i) => (i === paint.stops.length - 1 ? { ...s, color } : s));
                onChange({ ...paint, stops });
              }}
            />
          </Field>
          {paint.type === 'linear' && (
            <SliderField label="Angle" value={paint.angle} min={0} max={360} step={1} suffix="°" defaultValue={90} onChange={(angle) => onChange({ ...paint, angle })} />
          )}
        </>
      )}
    </>
  );
}

export { NumberInput };
