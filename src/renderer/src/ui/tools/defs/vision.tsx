/** Smart tools of the vision feature area (all on-device). */

import { Crop, Crosshair, Palette, Scissors, UserRoundX } from 'lucide-react';
import '@/vision';
import { tk } from '../../i18n';
import { ColorTool, CutoutTool, ReframePanel, SceneTool, TrackTool } from '../../vision/panels';
import type { ToolDef } from '../index';

// Titles, descriptions and groups are English marked with tk(); the Smart tab translates them.
const tools: ToolDef[] = [
  {
    id: 'vision.cutout',
    title: tk('Remove background'),
    description: tk('Cut people out of video and photos — no green screen.'),
    group: tk('Vision'),
    icon: <UserRoundX size={16} />,
    keywords: ['background', 'remove', 'cutout', 'segment', 'person', 'matte', 'green screen', 'mask'],
    Panel: CutoutTool,
  },
  {
    id: 'vision.reframe',
    title: tk('Auto-reframe'),
    description: tk('Make a 9:16, 1:1, 4:5 or 16:9 copy that follows the subject.'),
    group: tk('Vision'),
    icon: <Crop size={16} />,
    keywords: ['reframe', 'aspect', 'vertical', 'shorts', 'reels', 'tiktok', 'square', 'crop', 'face'],
    Panel: ReframePanel,
  },
  {
    id: 'vision.track',
    title: tk('Motion tracking'),
    description: tk('Make text, stickers or shapes follow something in the video.'),
    group: tk('Vision'),
    icon: <Crosshair size={16} />,
    keywords: ['track', 'tracking', 'follow', 'pin', 'attach', 'motion'],
    Panel: TrackTool,
  },
  {
    id: 'vision.scenes',
    title: tk('Scene detection'),
    description: tk('Find the cuts inside a clip and split it into shots.'),
    group: tk('Edit'),
    icon: <Scissors size={16} />,
    keywords: ['scene', 'shot', 'cut', 'split', 'detect', 'boundary'],
    Panel: SceneTool,
  },
  {
    id: 'vision.color',
    title: tk('Colour match'),
    description: tk('Match a clip’s look to another clip or frame.'),
    group: tk('Colour'),
    icon: <Palette size={16} />,
    keywords: ['color', 'colour', 'match', 'grade', 'white balance', 'exposure'],
    Panel: ColorTool,
  },
];

export default tools;
