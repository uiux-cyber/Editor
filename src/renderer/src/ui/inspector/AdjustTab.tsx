import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { NEUTRAL_GRADE } from '@/core/factory';
import type { Clip, Grade, ID, VisualClip } from '@/core/types';
import { FILTERS, getEffect, getFilter } from '@/library';
import { useUI } from '@/store/ui';
import { editVisual } from '../actions';
import { ColorInput, Field, Section, Select, SliderField, Toggle } from '../common/controls';
import { tk, tMaybe, useT } from '../i18n';
import { ParamControls } from './shared';

type ScalarKey = Exclude<keyof Grade, 'shadowTint' | 'highlightTint' | 'monoTint' | 'curves' | 'wheels'>;

interface SliderSpec {
  key: ScalarKey;
  label: string;
  min: number;
  max: number;
  /** Display multiplier */
  scale?: number;
  suffix?: string;
  precision?: number;
}

const LIGHT: SliderSpec[] = [
  { key: 'exposure', label: tk('Exposure'), min: -2, max: 2, precision: 2 },
  { key: 'brightness', label: tk('Brightness'), min: -1, max: 1, scale: 100 },
  { key: 'contrast', label: tk('Contrast'), min: -1, max: 1, scale: 100 },
  { key: 'highlights', label: tk('Highlights'), min: -1, max: 1, scale: 100 },
  { key: 'shadows', label: tk('Shadows'), min: -1, max: 1, scale: 100 },
  { key: 'gamma', label: tk('Midtones'), min: -1, max: 1, scale: 100 },
];
const COLOR: SliderSpec[] = [
  { key: 'saturation', label: tk('Saturation'), min: -1, max: 1, scale: 100 },
  { key: 'vibrance', label: tk('Vibrance'), min: -1, max: 1, scale: 100 },
  { key: 'temperature', label: tk('Temperature'), min: -1, max: 1, scale: 100 },
  { key: 'tint', label: tk('Tint'), min: -1, max: 1, scale: 100 },
  { key: 'hue', label: tk('Hue'), min: -180, max: 180, suffix: '°' },
];
const DETAIL: SliderSpec[] = [
  { key: 'fade', label: tk('Fade'), min: 0, max: 1, scale: 100 },
  { key: 'sharpen', label: tk('Sharpen'), min: 0, max: 1, scale: 100 },
  { key: 'vignette', label: tk('Vignette'), min: 0, max: 1, scale: 100 },
  { key: 'grain', label: tk('Grain'), min: 0, max: 1, scale: 100 },
];

export function AdjustTab({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const t = useT();
  if (clip.type === 'audio') return null;
  const visual = clip as VisualClip;
  const g: Grade = { ...NEUTRAL_GRADE, ...(visual.adjust ?? {}) };
  const setGrade = <K extends keyof Grade>(key: K, value: Grade[K]): void =>
    editVisual(ids, (c) => {
      c.adjust = { ...(c.adjust ?? {}), [key]: value };
    });
  const dirty = !!visual.adjust && Object.keys(visual.adjust).length > 0;
  const filter = visual.filter;
  const filterDef = filter ? getFilter(filter.id) : undefined;

  const sliders = (specs: SliderSpec[]): ReactNode =>
    specs.map((s) => (
      <SliderField
        key={s.key}
        label={tMaybe(s.label)}
        value={g[s.key]}
        min={s.min}
        max={s.max}
        step={(s.max - s.min) / 200}
        scale={s.scale ?? 1}
        precision={s.precision ?? 0}
        suffix={s.suffix}
        defaultValue={0}
        bipolar={s.min < 0}
        onChange={(v) => setGrade(s.key, v)}
      />
    ));

  return (
    <>
      <Section title={t('Filter')} id="filter">
        <Field label={t('Look')}>
          <Select
            value={filter?.id ?? ''}
            options={[{ value: '', label: t('None') }, ...FILTERS.map((f) => ({ value: f.id, label: f.name }))]}
            onChange={(id) =>
              editVisual(ids, (c) => {
                if (id) c.filter = { id, intensity: c.filter?.intensity ?? 1 };
                else delete c.filter;
              })
            }
          />
        </Field>
        {filter && filterDef && (
          <SliderField label={t('Intensity')} value={filter.intensity} min={0} max={1} step={0.01} scale={100} suffix="%" defaultValue={1} onChange={(v) => editVisual(ids, (c) => c.filter && void (c.filter.intensity = v))} />
        )}
        <button type="button" className="btn btn--sm btn--outline btn--block" onClick={() => useUI.getState().setLibraryTab('filters')}>
          {t('Browse all filters')}
        </button>
      </Section>

      <Section
        title={t('Light', undefined, 'grade')}
        id="light"
        actions={
          dirty ? (
            <button type="button" className="icon-btn icon-btn--sm" title={t('Reset all adjustments')} onClick={() => editVisual(ids, (c) => void delete c.adjust)}>
              <RotateCcw size={12} />
            </button>
          ) : undefined
        }
      >
        {sliders(LIGHT)}
      </Section>
      <Section title={t('Color')} id="color">
        {sliders(COLOR)}
      </Section>
      <Section title={t('Detail')} id="detail">
        {sliders(DETAIL)}
      </Section>
      <Section title={t('Color toning')} id="toning" defaultOpen={g.shadowTintAmount > 0 || g.highlightTintAmount > 0 || g.mono > 0}>
        <Field label={t('Shadows')}>
          <ColorInput value={g.shadowTint} onChange={(v) => setGrade('shadowTint', v.slice(0, 7))} />
        </Field>
        <SliderField label={t('Amount')} value={g.shadowTintAmount} min={0} max={1} step={0.01} scale={100} defaultValue={0} onChange={(v) => setGrade('shadowTintAmount', v)} />
        <Field label={t('Highlights')}>
          <ColorInput value={g.highlightTint} onChange={(v) => setGrade('highlightTint', v.slice(0, 7))} />
        </Field>
        <SliderField label={t('Amount')} value={g.highlightTintAmount} min={0} max={1} step={0.01} scale={100} defaultValue={0} onChange={(v) => setGrade('highlightTintAmount', v)} />
        <SliderField label={t('Monochrome')} value={g.mono} min={0} max={1} step={0.01} scale={100} defaultValue={0} onChange={(v) => setGrade('mono', v)} />
        {g.mono > 0 && (
          <Field label={t('Tone')}>
            <ColorInput value={g.monoTint} onChange={(v) => setGrade('monoTint', v.slice(0, 7))} />
          </Field>
        )}
      </Section>
    </>
  );
}

export function EffectsTab({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const t = useT();
  if (clip.type === 'audio') return null;
  const visual = clip as VisualClip;
  // Effects are edited on the primary clip only: instances are not shared between clips.
  const target = [clip.id];
  const move = (index: number, dir: -1 | 1): void =>
    editVisual(target, (c) => {
      const j = index + dir;
      if (j < 0 || j >= c.effects.length) return;
      [c.effects[index], c.effects[j]] = [c.effects[j], c.effects[index]];
    });
  return (
    <>
      {visual.effects.length === 0 && (
        <div className="empty">
          <div className="empty__title">{t('No effects yet')}</div>
          <p>{clip.type === 'adjustment' ? t('Pick an effect from the library to stylise everything beneath this layer.') : t('Pick an effect from the library to stylise this clip.')}</p>
        </div>
      )}
      {visual.effects.map((fx, i) => {
        const def = getEffect(fx.effectId);
        return (
          <Section
            key={fx.uid}
            id={`fx-${fx.uid}`}
            title={def?.name ?? t('Unavailable effect')}
            actions={
              <>
                <button type="button" className="icon-btn icon-btn--sm" title={t('Apply earlier')} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ChevronUp size={13} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" title={t('Apply later')} disabled={i === visual.effects.length - 1} onClick={() => move(i, 1)}>
                  <ChevronDown size={13} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" title={t('Remove effect')} onClick={() => editVisual(target, (c) => void c.effects.splice(i, 1))}>
                  <Trash2 size={12} />
                </button>
                <Toggle value={fx.enabled} title={t('Enable effect')} onChange={(v) => editVisual(target, (c) => c.effects[i] && void (c.effects[i].enabled = v))} />
              </>
            }
          >
            {def ? (
              <ParamControls defs={def.params} values={fx.params} onChange={(key, value) => editVisual(target, (c) => c.effects[i] && void (c.effects[i].params[key] = value))} />
            ) : (
              <p className="hint">{t('This effect is not available in this version of Kinora.')}</p>
            )}
          </Section>
        );
      })}
      <div className="tab-footer">
        <button type="button" className="btn btn--outline btn--block" onClick={() => useUI.getState().setLibraryTab('effects')}>
          <Plus size={14} /> {t('Add an effect')}
        </button>
        {ids.length > 1 && <p className="hint">{t('Effects are edited on one clip at a time.')}</p>}
      </div>
    </>
  );
}
