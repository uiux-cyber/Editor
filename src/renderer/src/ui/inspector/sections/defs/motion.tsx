/**
 * Inspector ▸ Edit ▸ "Motion clip": the settings a Motion clip declares (text, colours, fonts,
 * numbers, switches, choices, pictures), applied live. Settings belong to the clip's media asset;
 * clips sharing it can be given their own copy.
 */

import { Copy, Palette, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MediaAsset } from '@/core/types';
import { useProjectStore } from '@/store/project';
import { toast } from '@/store/ui';
import { motionParamValues, MOTION_FONTS, type MotionParam, type MotionValue } from '@shared/motion';
import { ColorInput, Field, Section, Select, SliderField, Toggle } from '../../../common/controls';
import { tMaybe, useT } from '../../../i18n';
import { applyBrandToMotion, clipsUsingAsset, hasBrand, makeMotionUnique, motionAssetOf, resetMotionValues, setMotionValues, useMotionFile } from '../../../motion/actions';
import type { InspectorSectionDef, InspectorSectionProps } from '../index';
import '../../../motion/motion.css';

const fontLabel = (f: string): string => f.replace(/ Variable$/, '');

function ParamField({ p, params, value, asset, images }: { p: MotionParam; params: MotionParam[]; value: MotionValue; asset: MediaAsset; images: MediaAsset[] }): ReactNode {
  const t = useT();
  const set = (v: MotionValue, coalesce?: string): void => setMotionValues(asset.id, params, { [p.id]: v }, coalesce);
  const label = tMaybe(p.label);
  switch (p.type) {
    case 'text':
      return (
        <Field label={label}>
          {p.multiline ? (
            <textarea className="textarea" rows={3} value={String(value)} spellCheck={false} data-motion-param={p.id} onChange={(e) => set(e.target.value, p.id)} onKeyDown={(e) => e.stopPropagation()} />
          ) : (
            <input className="input" value={String(value)} spellCheck={false} data-motion-param={p.id} onChange={(e) => set(e.target.value, p.id)} onKeyDown={(e) => e.stopPropagation()} />
          )}
        </Field>
      );
    case 'color':
      return (
        <Field label={label}>
          <ColorInput value={String(value)} onChange={(v) => set(v, p.id)} swatches />
        </Field>
      );
    case 'number': {
      const step = p.step ?? 0.01;
      const precision = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
      return <SliderField label={label} value={Number(value)} min={p.min ?? 0} max={p.max ?? 100} step={step} defaultValue={Number(p.default)} precision={precision} suffix={p.suffix} onChange={(v) => set(v, p.id)} />;
    }
    case 'font':
      return (
        <Field label={label}>
          <Select value={String(value)} options={MOTION_FONTS.map((f) => ({ value: f, label: fontLabel(f) }))} onChange={(v) => set(v)} />
        </Field>
      );
    case 'toggle':
      return (
        <Field label={label}>
          <Toggle value={value === true} onChange={(v) => set(v)} />
        </Field>
      );
    case 'select':
      return (
        <Field label={label}>
          <Select value={String(value)} options={(p.options ?? []).map((o) => ({ value: o, label: tMaybe(o) }))} onChange={(v) => set(v)} />
        </Field>
      );
    case 'image':
      return (
        <Field label={label}>
          <Select value={String(value)} options={[{ value: '', label: t('None') }, ...images.map((a) => ({ value: a.id, label: a.name }))]} onChange={(v) => set(v)} />
        </Field>
      );
  }
}

function MotionSection({ clip }: InspectorSectionProps): ReactNode {
  const t = useT();
  const assets = useProjectStore((s) => s.root.assets);
  // Re-render when clips change so the "shared by" count stays right.
  useProjectStore((s) => s.root.clips);
  const asset = motionAssetOf(clip, assets);
  const file = useMotionFile(asset);
  if (!asset) return null;
  const params = file?.meta.params ?? [];
  const values = motionParamValues(params, asset.motionValues);
  const images = Object.values(assets).filter((a) => a.kind === 'image' || (a.kind === 'animation' && a.format !== 'motion'));
  const shared = clipsUsingAsset(asset.id);
  const changed = !!asset.motionValues && Object.keys(asset.motionValues).length > 0;
  const branded = params.some((p) => p.brand);

  return (
    <Section
      title={t('Motion clip')}
      id="motion"
      actions={
        params.length > 0 && (
          <button type="button" className="icon-btn icon-btn--sm" title={t('Reset to the clip’s defaults')} disabled={!changed} onClick={() => resetMotionValues(asset.id)}>
            <RotateCcw size={12} />
          </button>
        )
      }
    >
      {file === undefined && <p className="hint">{t('Loading…')}</p>}
      {file === null && <p className="hint">{t('The clip’s file could not be read.')}</p>}
      {file && params.length === 0 && <p className="hint">{t('This clip has no settings to change. Ask Claude to “make the text and colours editable” to add some.')}</p>}
      {params.map((p) => (
        <ParamField key={p.id} p={p} params={params} value={values[p.id]} asset={asset} images={images} />
      ))}
      {(branded || shared > 1) && (
        <div className="motion-actions">
          {branded && (
            <button
              type="button"
              className="btn btn--sm btn--outline"
              data-motion-brand
              title={hasBrand() ? t('Use the colours, fonts, name and logo of your brand kit') : t('Set up your brand kit first (Templates ▸ Brand kit)')}
              onClick={() => {
                if (!hasBrand()) {
                  toast('info', t('Set up your brand kit first'), t('Templates ▸ Brand kit: add your colours, fonts and logo.'));
                  return;
                }
                const n = applyBrandToMotion(asset.id, params);
                if (!n) toast('info', t('Nothing to change'), t('Your brand kit has no values for this clip’s settings.'));
              }}
            >
              <Palette size={13} />
              {t('Use my brand')}
            </button>
          )}
          {shared > 1 && (
            <button type="button" className="btn btn--sm btn--outline" data-motion-unique title={t('Give this clip its own copy so its settings can differ from the others')} onClick={() => makeMotionUnique(clip.id)}>
              <Copy size={13} />
              {t('Make unique')}
            </button>
          )}
        </div>
      )}
      {shared > 1 && <p className="hint">{t('{count, plural, other {Used by # clips: changes apply to all of them.}}', { count: shared })}</p>}
    </Section>
  );
}

const sections: InspectorSectionDef[] = [
  {
    id: 'motion-settings',
    tab: 'edit',
    order: 0,
    placement: 'top',
    applies: (clip) => clip.type === 'image' && useProjectStore.getState().root.assets[clip.assetId]?.format === 'motion',
    Component: MotionSection,
  },
];

export default sections;
