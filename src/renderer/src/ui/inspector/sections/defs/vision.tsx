/** Inspector sections of the vision feature area. */

import { Section } from '../../../common/controls';
import { ColorMatchPanel, CutoutControls, ScenePanel, TrackPanel } from '../../../vision/panels';
import type { InspectorSectionDef } from '../index';
import '@/vision';

const sections: InspectorSectionDef[] = [
  {
    id: 'vision-cutout',
    tab: 'edit',
    order: 60,
    applies: (c) => c.type === 'video' || c.type === 'image',
    Component: ({ clip, ids }) =>
      clip.type === 'video' || clip.type === 'image' ? (
        <Section title="Background removal" id="vision-cutout" defaultOpen={!!clip.cutout?.enabled}>
          <CutoutControls clip={clip} ids={ids} />
        </Section>
      ) : null,
  },
  {
    id: 'vision-scenes',
    tab: 'edit',
    order: 70,
    applies: (c) => c.type === 'video',
    Component: ({ clip }) =>
      clip.type === 'video' ? (
        <Section title="Scene detection" id="vision-scenes" defaultOpen={false}>
          <ScenePanel clip={clip} />
        </Section>
      ) : null,
  },
  {
    id: 'vision-track',
    tab: 'edit',
    order: 60,
    applies: (c) => c.type === 'text' || c.type === 'sticker' || c.type === 'shape',
    Component: ({ clip }) =>
      clip.type === 'text' || clip.type === 'sticker' || clip.type === 'shape' ? (
        <Section title="Motion tracking" id="vision-track" defaultOpen={false}>
          <TrackPanel follower={clip} />
        </Section>
      ) : null,
  },
  {
    id: 'vision-color',
    tab: 'adjust',
    order: 40,
    applies: (c) => c.type === 'video' || c.type === 'image',
    Component: ({ clip }) =>
      clip.type === 'video' || clip.type === 'image' ? (
        <Section title="Colour match" id="vision-color" defaultOpen={false}>
          <ColorMatchPanel clip={clip} />
        </Section>
      ) : null,
  },
];

export default sections;
