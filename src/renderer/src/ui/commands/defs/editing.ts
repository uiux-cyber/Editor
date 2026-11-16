/** Timeline editing commands: trim tools, groups, links, magnetic main track, track sizes, history. */

import { getProject } from '@/store/project';
import { useUI, type Tool } from '@/store/ui';
import {
  groupSelection,
  linkSelection,
  setTrackSize,
  toggleMagneticMain,
  ungroupSelection,
  unlinkSelection,
} from '../../actions';
import { useHistoryPanel } from '../../timeline/HistoryPanel';
import type { Command } from '../index';

const inEditor = (): boolean => useUI.getState().screen === 'editor';
const selected = (): string[] => useUI.getState().selection.filter((id) => getProject().clips[id]);
const tool = (id: Tool, title: string, shortcut: string, keywords: string[]): Command => ({
  id: `timeline.tool.${id}`,
  title,
  group: 'Timeline',
  shortcut,
  keywords,
  when: inEditor,
  run: () => useUI.getState().setTool(id),
});

const commands: Command[] = [
  tool('ripple', 'Ripple tool', 'E', ['trim', 'ripple edit', 'close gap']),
  tool('roll', 'Roll tool', 'R', ['trim', 'rolling edit', 'cut']),
  tool('slip', 'Slip tool', 'Y', ['trim', 'slip edit', 'in out']),
  tool('slide', 'Slide tool', 'U', ['trim', 'slide edit']),
  {
    id: 'clip.group',
    title: 'Group clips',
    group: 'Clip',
    shortcut: 'Ctrl+G',
    keywords: ['group'],
    when: () => inEditor() && selected().length > 1,
    run: groupSelection,
  },
  {
    id: 'clip.ungroup',
    title: 'Ungroup clips',
    group: 'Clip',
    shortcut: 'Ctrl+Shift+G',
    keywords: ['ungroup'],
    when: () => inEditor() && selected().some((id) => getProject().clips[id]?.groupId),
    run: ungroupSelection,
  },
  {
    id: 'clip.link',
    title: 'Link clips',
    group: 'Clip',
    shortcut: 'Ctrl+L',
    keywords: ['link', 'sync', 'audio video'],
    when: () => inEditor() && selected().length > 1,
    run: linkSelection,
  },
  {
    id: 'clip.unlink',
    title: 'Unlink clips',
    group: 'Clip',
    shortcut: 'Ctrl+Shift+L',
    keywords: ['unlink', 'separate audio'],
    when: () => inEditor() && selected().some((id) => getProject().clips[id]?.linkId),
    run: unlinkSelection,
  },
  {
    id: 'timeline.magneticMain',
    title: 'Magnetic main track',
    group: 'Timeline',
    keywords: ['magnet', 'main track', 'gaps', 'ripple'],
    when: inEditor,
    run: toggleMagneticMain,
  },
  {
    id: 'view.history',
    title: 'Show history',
    group: 'View',
    shortcut: 'Ctrl+H',
    keywords: ['undo', 'redo', 'history', 'steps'],
    when: inEditor,
    run: () => useHistoryPanel.getState().toggle(),
  },
  { id: 'view.trackSize.small', title: 'Track size: Small', group: 'View', keywords: ['track height'], when: inEditor, run: () => setTrackSize('small') },
  { id: 'view.trackSize.medium', title: 'Track size: Medium', group: 'View', keywords: ['track height'], when: inEditor, run: () => setTrackSize('medium') },
  { id: 'view.trackSize.large', title: 'Track size: Large', group: 'View', keywords: ['track height'], when: inEditor, run: () => setTrackSize('large') },
];

export default commands;
