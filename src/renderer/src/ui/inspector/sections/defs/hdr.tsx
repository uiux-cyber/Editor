/**
 * Inspector ▸ Adjust ▸ "HDR tone mapping" for video clips whose source is HDR (PQ / HLG):
 * operator, exposure and source peak of the `hdr` layer extension. Applies to the preview, the
 * render cache and the export alike.
 */

import { RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Clip, ToneMapSettings } from '@/core/types';
import { DEFAULT_TONE_MAP } from '@/engine/gl/ext/hdr';
import { TONE_MAP_OPERATORS } from '@/engine/gl/hdrMath';
import { hdrInfoById, hdrPassthrough } from '@/engine/media/hdr';
import { getProject, useProjectStore } from '@/store/project';
import { Field, Section, Select, SliderField } from '../../../common/controls';
import { editClips } from '../../../actions';
import { useT } from '../../../i18n';
import type { InspectorSectionDef, InspectorSectionProps } from '../index';
import '../../../media/media.css';

function HdrSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const t = useT();
  const asset = useProjectStore((s) => (clip.type === 'video' ? s.project.assets[clip.assetId] : undefined));
  if (clip.type !== 'video' || !asset?.hdr) return null;
  const tm: ToneMapSettings = { ...DEFAULT_TONE_MAP, ...clip.toneMap };
  const info = hdrInfoById(asset.id);
  const edit = (patch: Partial<ToneMapSettings>, coalesce?: string): void =>
    editClips(
      ids,
      (c) => {
        if (c.type === 'video') c.toneMap = { ...DEFAULT_TONE_MAP, ...c.toneMap, ...patch };
      },
      coalesce,
    );
  const op = TONE_MAP_OPERATORS.find((o) => o.id === tm.operator);
  return (
    <Section
      title={t('HDR tone mapping')}
      id="hdr"
      actions={
        <button type="button" className="icon-btn icon-btn--sm" title={t('Reset to defaults')} onClick={() => editClips(ids, (c) => c.type === 'video' && delete c.toneMap)}>
          <RotateCcw size={12} />
        </button>
      }
    >
      <div className="mx-hdr-note">
        <span className="mt-badge mt-badge--hdr">HDR</span>
        {info?.transfer === 'hlg' ? 'HLG' : 'PQ (HDR10)'} · {info?.wideGamut === false ? 'BT.709' : 'BT.2020'} → SDR Rec.709
      </div>
      {!hdrPassthrough() && <p className="hint">{t("This PC's video decoder already converts HDR to SDR; these controls have no effect.")}</p>}
      <Field label={t('Operator')} title={op?.hint}>
        <Select value={tm.operator} onChange={(v) => edit({ operator: v })} options={TONE_MAP_OPERATORS.map((o) => ({ value: o.id, label: o.label }))} />
      </Field>
      <SliderField label={t('Exposure')} value={tm.exposure} min={-3} max={3} step={0.05} defaultValue={0} bipolar precision={2} suffix=" EV" onChange={(v) => edit({ exposure: v }, 'hdr-exposure')} />
      <SliderField label={t('Peak (nits)')} value={tm.peak} min={400} max={10000} step={50} defaultValue={1000} onChange={(v) => edit({ peak: v }, 'hdr-peak')} />
      <p className="hint">
        {op?.hint}. {t('The same mapping is used for the preview and the export.')}
      </p>
    </Section>
  );
}

const sections: InspectorSectionDef[] = [
  {
    id: 'hdr-tone-map',
    tab: 'adjust',
    order: 5,
    applies: (clip: Clip) => clip.type === 'video' && !!getProject().assets[clip.assetId]?.hdr,
    Component: HdrSection,
  },
];

export default sections;
