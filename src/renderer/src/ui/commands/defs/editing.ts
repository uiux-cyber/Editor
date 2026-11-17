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
import { TRACK_HEIGHT, TRACK_SIZES, type TrackSize } from '../../timeline/geometry';
import type { Command } from '../index';

const inEditor = (): boolean => useUI.getState().screen === 'editor';
/** Every track has the height of a size preset. */
const tracksAre = (size: TrackSize): boolean => getProject().tracks.every((t) => (t.height ?? TRACK_HEIGHT[t.kind]) === TRACK_SIZES[size][t.kind]);
const selected = (): string[] => useUI.getState().selection.filter((id) => getProject().clips[id]);
const tool = (id: Tool, title: string, shortcut: string, keywords: string[]): Command => ({
  id: `timeline.tool.${id}`,
  title,
  group: 'Tools',
  shortcut,
  keywords,
  when: inEditor,
  checked: () => useUI.getState().tool === id,
  run: () => useUI.getState().setTool(id),
});

const commands: Command[] = [
  tool('ripple', 'Ripple tool', 'E', ['trim', 'ripple edit', 'close gap']),
  tool('roll', 'Roll tool', 'R', ['trim', 'rolling edit', 'cut']),
  tool('slip', 'Slip tool', 'Y', ['trim', 'slip edit', 'in out']),
  tool('slide', 'Slide tool', 'U', ['trim', 'slide edit']),
  {
    id: 'clip.group',
    menu: 'Edit',
    menuSection: 'Groups and links',
    title: 'Group clips',
    group: 'Clip',
    shortcut: 'Ctrl+G',
    keywords: ['group'],
    when: () => inEditor() && selected().length > 1,
    run: groupSelection,
  },
  {
    id: 'clip.ungroup',
    menu: 'Edit',
    menuSection: 'Groups and links',
    title: 'Ungroup clips',
    group: 'Clip',
    shortcut: 'Ctrl+Shift+G',
    keywords: ['ungroup'],
    when: () => inEditor() && selected().some((id) => getProject().clips[id]?.groupId),
    run: ungroupSelection,
  },
  {
    id: 'clip.link',
    menu: 'Edit',
    menuSection: 'Groups and links',
    title: 'Link clips',
    group: 'Clip',
    shortcut: 'Ctrl+L',
    keywords: ['link', 'sync', 'audio video'],
    when: () => inEditor() && selected().length > 1,
    run: linkSelection,
  },
  {
    id: 'clip.unlink',
    menu: 'Edit',
    menuSection: 'Groups and links',
    title: 'Unlink clips',
    group: 'Clip',
    shortcut: 'Ctrl+Shift+L',
    keywords: ['unlink', 'separate audio'],
    when: () => inEditor() && selected().some((id) => getProject().clips[id]?.linkId),
    run: unlinkSelection,
  },
  {
    id: 'timeline.magneticMain',
    menu: 'View',
    menuSection: 'Timeline',
    checked: () => !!getProject().magneticMain,
    title: 'Magnetic main track',
    group: 'Timeline',
    keywords: ['magnet', 'main track', 'gaps', 'ripple'],
    when: inEditor,
    run: toggleMagneticMain,
  },
  {
    id: 'view.history',
    menu: 'Edit',
    menuSection: 'History',
    title: 'Show history',
    group: 'View',
    shortcut: 'Ctrl+H',
    keywords: ['undo', 'redo', 'history', 'steps'],
    when: inEditor,
    run: () => useHistoryPanel.getState().toggle(),
  },
  { id: 'view.trackSize.small', title: 'Track size: Small', group: 'View', menuSection: 'Track size', menuTitle: 'Small', checked: () => tracksAre('small'), keywords: ['track height'], when: inEditor, run: () => setTrackSize('small') },
  { id: 'view.trackSize.medium', title: 'Track size: Medium', group: 'View', menuSection: 'Track size', menuTitle: 'Medium', checked: () => tracksAre('medium'), keywords: ['track height'], when: inEditor, run: () => setTrackSize('medium') },
  { id: 'view.trackSize.large', title: 'Track size: Large', group: 'View', menuSection: 'Track size', menuTitle: 'Large', checked: () => tracksAre('large'), keywords: ['track height'], when: inEditor, run: () => setTrackSize('large') },
];

export default commands;
