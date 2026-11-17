/**
 * Inspector sections for text & graphics: count-up numbers (text clips), pen paths (path
 * shapes) and animated media (image clips showing an animated GIF / WebP / APNG or a Lottie).
 */

import type { ReactNode } from 'react';
import { MAX_COUNTER_DECIMALS, counterFromText, counterSpan, formatCounter } from '@/core/counter';
import { EASE_IDS, EASE_LABELS } from '@/core/easing';
import { isSmooth, smoothHandles } from '@/core/path';
import { clipsOnTrack } from '@/core/project';
import { formatSeconds } from '@/core/time';
import type { Clip, CounterSettings, ImageClip, ShapeClip, TextClip } from '@/core/types';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { editClips } from '../../../actions';
import { Field, NumberInput, Section, Segmented, Select, Toggle } from '../../../common/controls';
import { editPath } from '../../../preview/pen/pathOps';
import type { InspectorSectionDef, InspectorSectionProps } from '../index';

// ---------------------------------------------------------------------------------------------
// Count-up
// ---------------------------------------------------------------------------------------------

const EASES = EASE_IDS.filter((e) => e !== 'hold');

function TextInput({ value, onChange, placeholder, title }: { value: string; onChange: (v: string) => void; placeholder?: string; title?: string }): ReactNode {
  return <input className="input" value={value} placeholder={placeholder} title={title} spellCheck={false} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />;
}

function CounterSection({ clip, ids }: InspectorSectionProps): ReactNode {
  if (clip.type !== 'text') return null;
  const c = clip.counter;
  const textIds = ids.filter((id) => getProject().clips[id]?.type === 'text');
  const edit = (recipe: (x: TextClip) => void, coalesce?: string): void =>
    editClips(
      textIds,
      (x) => {
        if (x.type === 'text') recipe(x);
      },
      coalesce,
    );
  /** Change the counter; the clip's text becomes the final value so labels and exports read right. */
  const set = (patch: Partial<CounterSettings>, coalesce?: string): void =>
    edit((x) => {
      if (!x.counter) return;
      Object.assign(x.counter, patch);
      if (patch.duration === undefined && 'duration' in patch) delete x.counter.duration;
      x.text.content = formatCounter(x.counter, x.counter.to);
    }, coalesce);
  const toggle = (on: boolean): void =>
    edit((x) => {
      if (on) {
        x.counter = counterFromText(x.text.content);
        x.text.content = formatCounter(x.counter, x.counter.to);
      } else delete x.counter;
    });
  const step = c ? Math.pow(10, -Math.min(2, c.decimals)) : 1;
  const span = c ? counterSpan(c, clip.duration) : 0;

  return (
    <Section title="Count-up" id="counter" defaultOpen={!!c} actions={<Toggle value={!!c} title="Animate the text as a counting number" onChange={toggle} />}>
      {!c ? (
        <p className="hint">Turn the text into a number that counts up (or down) while the clip plays.</p>
      ) : (
        <>
          <Field label="From">
            <NumberInput value={c.from} onChange={(v) => set({ from: v }, `counter-from:${clip.id}`)} step={step} precision={c.decimals} title="Value at the start" />
          </Field>
          <Field label="To">
            <NumberInput value={c.to} onChange={(v) => set({ to: v }, `counter-to:${clip.id}`)} step={step} precision={c.decimals} title="Value at the end" />
          </Field>
          <Field label="Decimals">
            <Segmented
              value={Math.min(c.decimals, 3)}
              style={{ flex: 1 }}
              options={[0, 1, 2, 3].map((d) => ({ value: d, label: d === 0 ? '0' : `0.${'0'.repeat(d)}`, title: `${d} decimal place${d === 1 ? '' : 's'}` }))}
              onChange={(d) => set({ decimals: Math.min(MAX_COUNTER_DECIMALS, d) })}
            />
          </Field>
          <Field label="Prefix">
            <TextInput value={c.prefix} placeholder="e.g. $" onChange={(v) => set({ prefix: v }, `counter-prefix:${clip.id}`)} />
          </Field>
          <Field label="Suffix">
            <TextInput value={c.suffix} placeholder="e.g. %" onChange={(v) => set({ suffix: v }, `counter-suffix:${clip.id}`)} />
          </Field>
          <Field label="Separators" title="Group thousands with commas (1,000,000)">
            <Toggle value={c.separator} onChange={(v) => set({ separator: v })} />
          </Field>
          <Field label="Easing">
            <Select value={c.ease} options={EASES.map((e) => ({ value: e, label: EASE_LABELS[e] }))} onChange={(ease) => set({ ease })} />
          </Field>
          <Field label="Count for" title="How long the number takes to reach its end value">
            <Segmented
              value={c.duration === undefined ? 'clip' : 'custom'}
              style={{ flex: 1 }}
              options={[
                { value: 'clip', label: 'Whole clip' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(mode) => set({ duration: mode === 'clip' ? undefined : Math.max(0.1, Math.round(Math.min(2, clip.duration) * 10) / 10) })}
            />
          </Field>
          {c.duration !== undefined && (
            <Field label="Duration" title="Seconds from the start of the clip">
              <NumberInput value={c.duration} onChange={(v) => set({ duration: Math.max(0.1, v) }, `counter-dur:${clip.id}`)} min={0.1} max={600} step={0.1} precision={1} suffix="s" />
            </Field>
          )}
          <p className="hint">
            Counts to <b style={{ color: 'var(--text-0)' }}>{formatCounter(c, c.to)}</b> in {formatSeconds(span)}, replacing the text while it plays. Digits keep a fixed width, so the number never wobbles.
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Pen path
// ---------------------------------------------------------------------------------------------

function PathSection({ clip, ids }: InspectorSectionProps): ReactNode {
  if (clip.type !== 'shape' || clip.shape.kind !== 'path' || !clip.shape.path) return null;
  const path = clip.shape.path;
  const pathIds = ids.filter((id) => {
    const c = getProject().clips[id];
    return c?.type === 'shape' && c.shape.kind === 'path';
  });
  const smoothCount = path.points.filter(isSmooth).length;
  const setAll = (smooth: boolean): void =>
    editPath(pathIds, (pts, closed) => ({
      points: pts.map((p, i) => {
        if (!smooth) return { ...p, in: null, out: null };
        const h = smoothHandles(pts, closed, i);
        return { ...p, in: h.in, out: h.out };
      }),
      closed,
    }));
  return (
    <Section title="Path" id="path">
      <Field label="Closed" title="Join the last point to the first and fill the shape">
        <Toggle value={path.closed} disabled={path.points.length < 3} onChange={(v) => editPath(pathIds, (pts) => ({ points: pts, closed: v && pts.length > 2 }))} />
        <span style={{ color: 'var(--text-3)' }}>{path.closed ? 'Filled shape' : 'Open line'}</span>
      </Field>
      <Field label="Points">
        <span className="mono" style={{ color: 'var(--text-0)' }}>
          {path.points.length}
        </span>
        <span style={{ color: 'var(--text-3)' }}>{smoothCount ? `${smoothCount} smooth` : 'all corners'}</span>
      </Field>
      <Field label="Make">
        <div className="btn-row">
          <button type="button" className="btn btn--sm btn--outline" title="Give every point smooth bezier handles" onClick={() => setAll(true)}>
            Smooth
          </button>
          <button type="button" className="btn btn--sm btn--outline" title="Turn every point into a sharp corner" onClick={() => setAll(false)}>
            Corners
          </button>
        </div>
      </Field>
      <p className="hint">Drag points and handles on the canvas. Alt-click a point to switch smooth / corner, double-click the outline to add a point, press Delete to remove the selected point.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Animated media
// ---------------------------------------------------------------------------------------------

const FORMAT_LABEL: Record<string, string> = { gif: 'Animated GIF', webp: 'Animated WebP', apng: 'Animated PNG', lottie: 'Lottie animation' };

function AnimationSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const asset = useProjectStore((s) => (clip.type === 'image' ? s.project.assets[clip.assetId] : undefined));
  if (clip.type !== 'image' || !asset || asset.kind !== 'animation') return null;
  const loop = asset.duration;
  const loops = loop > 0 ? clip.duration / loop : 0;
  /** Set the clip to `n` loops, never running into the next clip on its track. */
  const setLoops = (n: number): void =>
    updateProject((p) => {
      for (const id of ids) {
        const c = p.clips[id];
        if (!c || c.type !== 'image') continue;
        const a = p.assets[c.assetId];
        if (!a || a.kind !== 'animation' || !(a.duration > 0)) continue;
        const f = p.settings.fps;
        const next = clipsOnTrack(p, c.trackId).find((o) => o.id !== c.id && o.start >= c.start + 1e-6);
        let duration = Math.max(1 / f, Math.round(a.duration * n * f) / f);
        if (next) duration = Math.min(duration, next.start - c.start);
        c.duration = duration;
      }
    });
  return (
    <Section title="Animation" id="animation">
      <Field label="Format">
        <span style={{ color: 'var(--text-0)' }}>{FORMAT_LABEL[asset.format ?? ''] ?? 'Animation'}</span>
        <span className="mono" style={{ color: 'var(--text-3)' }}>
          {asset.width}×{asset.height}
        </span>
      </Field>
      <Field label="Loop">
        <span className="mono" style={{ color: 'var(--text-0)' }}>
          {formatSeconds(loop)}
        </span>
        {asset.fps > 0 && <span style={{ color: 'var(--text-3)' }}>{Math.round(asset.fps * 10) / 10} fps</span>}
      </Field>
      <Field label="Length" title="Make the clip last a whole number of loops">
        <div className="btn-row btn-row--wrap">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" className={`chip ${Math.abs(loops - n) < 0.01 ? 'is-active' : ''}`} title={`${n} loop${n === 1 ? '' : 's'}`} onClick={() => setLoops(n)}>
              {n}×
            </button>
          ))}
        </div>
      </Field>
      <p className="hint">The animation loops for as long as the clip lasts — trim or extend it on the timeline.</p>
    </Section>
  );
}

const isAnimationClip = (clip: Clip): clip is ImageClip => clip.type === 'image' && getProject().assets[clip.assetId]?.kind === 'animation';
const isPathClip = (clip: Clip): clip is ShapeClip => clip.type === 'shape' && clip.shape.kind === 'path';

const sections: InspectorSectionDef[] = [
  { id: 'graphics.counter', tab: 'edit', order: 20, applies: (clip) => clip.type === 'text' && !clip.caption, Component: CounterSection },
  { id: 'graphics.path', tab: 'edit', order: 20, applies: isPathClip, Component: PathSection },
  { id: 'graphics.animation', tab: 'edit', order: 20, applies: isAnimationClip, Component: AnimationSection },
];

export default sections;
