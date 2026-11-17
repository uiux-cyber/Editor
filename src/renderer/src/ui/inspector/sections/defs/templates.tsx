/**
 * Inspector › Edit: "Brand & template" section — restyle the selection with the brand kit, or
 * save it as a reusable template.
 */

import { LayoutTemplate, SwatchBook } from 'lucide-react';
import type { ReactNode } from 'react';
import { isBrandStylable } from '@/library/brandStyle';
import { useUI } from '@/store/ui';
import { Section } from '../../../common/controls';
import { applyBrandToSelection } from '../../../templates/apply';
import { useTemplates } from '../../../templates/store';
import { openTemplatesWindow } from '../../../templates/windows';
import type { InspectorSectionDef, InspectorSectionProps } from '../index';

function BrandSection({ clip }: InspectorSectionProps): ReactNode {
  const brandSet = useTemplates((s) => s.brandSet);
  const colors = useTemplates((s) => s.brand.colors);
  const count = useUI((s) => s.selection.length);
  return (
    <Section title="Brand & template" id="brand-template">
      <div className="btn-row btn-row--wrap">
        {isBrandStylable(clip) && (
          <button type="button" className="btn btn--sm btn--outline" onClick={() => (brandSet ? applyBrandToSelection() : openTemplatesWindow({ kind: 'brand' }))} title={brandSet ? 'Restyle the selection with your brand colours and fonts' : 'Set up your brand kit'}>
            <SwatchBook size={13} /> {brandSet ? 'Apply brand' : 'Set up brand kit…'}
            {brandSet && (
              <span className="tpl-toggle__swatches" aria-hidden>
                <i style={{ background: colors.primary }} />
                <i style={{ background: colors.secondary }} />
                <i style={{ background: colors.accent }} />
              </span>
            )}
          </button>
        )}
        <button type="button" className="btn btn--sm btn--outline" onClick={() => openTemplatesWindow({ kind: 'save' })} title="Save the selected layers as a reusable template">
          <LayoutTemplate size={13} /> Save {count > 1 ? `${count} layers` : 'as template'}…
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
