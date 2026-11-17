/** Commands of the vision feature area (palette, menus, shortcuts). */

import { Crop, Crosshair, Palette, Scissors, UserRoundX } from 'lucide-react';
import { createElement } from 'react';
import type { Clip, VisualClip } from '@/core/types';
import { getProject } from '@/store/project';
import { useUI } from '@/store/ui';
import '@/vision';
import { isMediaClip, matchColor } from '@/vision/colorMatch';
import { ASPECTS, autoReframe } from '@/vision/reframe';
import { detectScenes } from '@/vision/scenes';
import { useVision } from '@/vision/store';
import { defaultTarget, isFollower, startDrawing, trackMotion } from '@/vision/tracking';
import { editVisual } from '../../actions';
import type { Command } from '../index';

const selected = (): Clip[] => {
  const p = getProject();
  return useUI
    .getState()
    .selection.map((id) => p.clips[id])
    .filter(Boolean);
};
const icon = (C: typeof Crop) => createElement(C, { size: 14 });
const inEditor = (): boolean => useUI.getState().screen === 'editor';

const commands: Command[] = [
  {
    id: 'vision.removeBackground',
    title: 'Remove background (toggle)',
    group: 'Smart',
    keywords: ['cutout', 'background', 'person', 'segment', 'matte'],
    icon: icon(UserRoundX),
    when: () => inEditor() && selected().some(isMediaClip),
    run: () => {
      const clips = selected().filter(isMediaClip);
      const on = !clips.every((c) => c.cutout?.enabled);
      editVisual(
        clips.map((c) => c.id),
        (c: VisualClip) => {
          if (c.type === 'video' || c.type === 'image') c.cutout = { feather: 0.25, choke: 0, ...(c.cutout ?? {}), enabled: on };
        },
      );
    },
  },
  ...ASPECTS.map(
    (a): Command => ({
      id: `vision.autoReframe.${a.id.replace(':', 'x')}`,
      title: `Auto-reframe to ${a.label}`,
      group: 'Smart',
      keywords: ['reframe', 'aspect', a.hint.toLowerCase()],
      icon: icon(Crop),
      when: () => inEditor() && Object.values(getProject().clips).some((c) => c.type === 'video' || c.type === 'image'),
      run: () => autoReframe(a.id),
    }),
  ),
  {
    id: 'vision.detectScenes',
    title: 'Detect scenes in clip',
    group: 'Smart',
    keywords: ['scene', 'shot', 'cut', 'split'],
    icon: icon(Scissors),
    when: () => inEditor() && selected()[0]?.type === 'video',
    run: async () => {
      const clip = selected()[0];
      const st = await detectScenes(clip.id);
      if (st) useUI.getState().toast({ kind: 'info', message: `${st.cuts.length} scene change${st.cuts.length === 1 ? '' : 's'} found`, detail: 'Review and split them in the inspector (Scene detection).' });
    },
  },
  {
    id: 'vision.matchColor',
    title: 'Match colour to the other selected clip',
    group: 'Smart',
    keywords: ['colour', 'color', 'match', 'grade'],
    icon: icon(Palette),
    when: () => inEditor() && selected().filter(isMediaClip).length === 2,
    run: () => {
      const [target, reference] = selected().filter(isMediaClip);
      return matchColor(target.id, reference.id);
    },
  },
  {
    id: 'vision.trackMotion',
    title: 'Track motion',
    group: 'Smart',
    keywords: ['track', 'follow', 'motion', 'pin'],
    icon: icon(Crosshair),
    when: () => inEditor() && isFollower(selected()[0]),
    run: () => {
      const follower = selected()[0];
      const draw = useVision.getState().draw;
      if (draw && draw.followerId === follower.id && draw.box) return trackMotion(follower.id, draw.videoId, draw.box);
      const video = defaultTarget(getProject(), follower.id);
      if (!video) {
        useUI.getState().toast({ kind: 'info', message: 'Put the layer above a video clip first' });
        return;
      }
      startDrawing(follower.id, video.id);
      useUI.getState().toast({ kind: 'info', message: 'Drag a box around the object on the preview', detail: 'Then run Track motion again (or use the button in the inspector).' });
    },
  },
];

export default commands;
