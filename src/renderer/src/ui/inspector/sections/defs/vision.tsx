/** Inspector sections of the vision feature area. */

import { Section } from '../../../common/controls';
import { useT } from '../../../i18n';
import { ColorMatchPanel, CutoutControls, ScenePanel, TrackPanel } from '../../../vision/panels';
import type { InspectorSectionDef } from '../index';
import '@/vision';

const sections: InspectorSectionDef[] = [
  {
    id: 'vision-cutout',
    tab: 'edit',
    order: 60,
    applies: (c) => c.type === 'video' || c.type === 'image',
    Component: function CutoutSection({ clip, ids }) {
      const t = useT();
      return clip.type === 'video' || clip.type === 'image' ? (
        <Section title={t('Background removal')} id="vision-cutout" defaultOpen={!!clip.cutout?.enabled}>
          <CutoutControls clip={clip} ids={ids} />
        </Section>
      ) : null;
    },
  },
  {
    id: 'vision-scenes',
    tab: 'edit',
    order: 70,
    applies: (c) => c.type === 'video',
    Component: function ScenesSection({ clip }) {
      const t = useT();
      return clip.type === 'video' ? (
        <Section title={t('Scene detection')} id="vision-scenes" defaultOpen={false}>
          <ScenePanel clip={clip} />
        </Section>
      ) : null;
    },
  },
  {
    id: 'vision-track',
    tab: 'edit',
    order: 60,
    applies: (c) => c.type === 'text' || c.type === 'sticker' || c.type === 'shape',
    Component: function TrackSection({ clip }) {
      const t = useT();
      return clip.type === 'text' || clip.type === 'sticker' || clip.type === 'shape' ? (
        <Section title={t('Motion tracking')} id="vision-track" defaultOpen={false}>
          <TrackPanel follower={clip} />
        </Section>
      ) : null;
    },
  },
  {
    id: 'vision-color',
    tab: 'adjust',
    order: 40,
    applies: (c) => c.type === 'video' || c.type === 'image',
    Component: function ColorMatchSection({ clip }) {
      const t = useT();
      return clip.type === 'video' || clip.type === 'image' ? (
        <Section title={t('Colour match')} id="vision-color" defaultOpen={false}>
          <ColorMatchPanel clip={clip} />
        </Section>
      ) : null;
    },
  },
];

export default sections;
