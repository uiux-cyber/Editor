/**
 * Inspector › Edit: "Brand & template" section — restyle the selection with the brand kit, or
 * save it as a reusable template.
 */

import { LayoutTemplate, SwatchBook } from 'lucide-react';
import type { ReactNode } from 'react';
import { isBrandStylable } from '@/library/brandStyle';
import { useUI } from '@/store/ui';
import { Section } from '../../../common/controls';
import { useT } from '../../../i18n';
import { applyBrandToSelection } from '../../../templates/apply';
import { useTemplates } from '../../../templates/store';
import { openTemplatesWindow } from '../../../templates/windows';
import type { InspectorSectionDef, InspectorSectionProps } from '../index';

function BrandSection({ clip }: InspectorSectionProps): ReactNode {
  const t = useT();
  const brandSet = useTemplates((s) => s.brandSet);
  const colors = useTemplates((s) => s.brand.colors);
  const count = useUI((s) => s.selection.length);
  return (
    <Section title={t('Brand & template')} id="brand-template">
      <div className="btn-row btn-row--wrap">
        {isBrandStylable(clip) && (
          <button type="button" className="btn btn--sm btn--outline" onClick={() => (brandSet ? applyBrandToSelection() : openTemplatesWindow({ kind: 'brand' }))} title={brandSet ? t('Restyle the selection with your brand colours and fonts') : t('Set up your brand kit')}>
            <SwatchBook size={13} /> {brandSet ? t('Apply brand') : t('Set up brand kit…')}
            {brandSet && (
              <span className="tpl-toggle__swatches" aria-hidden>
                <i style={{ background: colors.primary }} />
                <i style={{ background: colors.secondary }} />
                <i style={{ background: colors.accent }} />
              </span>
            )}
          </button>
        )}
        <button type="button" className="btn btn--sm btn--outline" onClick={() => openTemplatesWindow({ kind: 'save' })} title={t('Save the selected layers as a reusable template')}>
          <LayoutTemplate size={13} /> {count > 1 ? t('Save {count, plural, one {# layer} other {# layers}}…', { count }) : t('Save as template…')}
        </button>
      </div>
    </Section>
  );
}

const sections: InspectorSectionDef[] = [
  {
    id: 'templates.brand',
    tab: 'edit',
    order: 900,
    applies: (clip) => clip.type !== 'audio',
    Component: BrandSection,
  },
];

export default sections;
