/** Smart tools of the vision feature area (all on-device). */

import { Crop, Crosshair, Palette, Scissors, UserRoundX } from 'lucide-react';
import '@/vision';
import { ColorTool, CutoutTool, ReframePanel, SceneTool, TrackTool } from '../../vision/panels';
import type { ToolDef } from '../index';

const tools: ToolDef[] = [
  {
    id: 'vision.cutout',
    title: 'Remove background',
    description: 'Cut people out of video and photos — no green screen.',
    group: 'Vision',
    icon: <UserRoundX size={16} />,
    keywords: ['background', 'remove', 'cutout', 'segment', 'person', 'matte', 'green screen', 'mask'],
    Panel: CutoutTool,
  },
  {
    id: 'vision.reframe',
    title: 'Auto-reframe',
    description: 'Make a 9:16, 1:1, 4:5 or 16:9 copy that follows the subject.',
    group: 'Vision',
    icon: <Crop size={16} />,
    keywords: ['reframe', 'aspect', 'vertical', 'shorts', 'reels', 'tiktok', 'square', 'crop', 'face'],
    Panel: ReframePanel,
  },
  {
    id: 'vision.track',
    title: 'Motion tracking',
    description: 'Make text, stickers or shapes follow something in the video.',
    group: 'Vision',
    icon: <Crosshair size={16} />,
    keywords: ['track', 'tracking', 'follow', 'pin', 'attach', 'motion'],
    Panel: TrackTool,
  },
  {
    id: 'vision.scenes',
    title: 'Scene detection',
    description: 'Find the cuts inside a clip and split it into shots.',
    group: 'Edit',
    icon: <Scissors size={16} />,
    keywords: ['scene', 'shot', 'cut', 'split', 'detect', 'boundary'],
    Panel: SceneTool,
  },
  {
    id: 'vision.color',
    title: 'Colour match',
    description: 'Match a clip’s look to another clip or frame.',
    group: 'Colour',
    icon: <Palette size={16} />,
    keywords: ['color', 'colour', 'match', 'grade', 'white balance', 'exposure'],
    Panel: ColorTool,
  },
];

export default tools;
