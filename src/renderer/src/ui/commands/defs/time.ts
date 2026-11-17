import type { Command } from '../index';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { getProject } from '@/store/project';
import {
  breakApartSelection,
  closeCompound,
  createCompoundFromSelection,
  freezeFrame,
  hasCompoundTarget,
  inCompound,
  openCompound,
  setPreservePitch,
  toggleReverseSelection,
} from '../../time/timeActions';

const selectedMedia = (): { id: string; preservePitch?: boolean }[] => {
  const p = getProject();
  return useUI
    .getState()
    .selection.map((id) => p.clips[id])
    .filter((c) => !!c && (c.type === 'video' || c.type === 'audio')) as { id: string; preservePitch?: boolean }[];
};

/** Time remapping and compound clip commands. */
const commands: Command[] = [
  {
    id: 'clip.freezeFrame',
    title: 'Freeze frame',
    group: 'Clip',
    keywords: ['hold', 'still', 'pause frame'],
    shortcut: 'Shift+F',
    run: () => freezeFrame(),
  },
  {
    id: 'clip.reverse',
    title: 'Reverse clip',
    group: 'Clip',
    keywords: ['backwards', 'rewind', 'play backwards'],
    when: () => selectedMedia().length > 0,
    run: toggleReverseSelection,
  },
  {
    id: 'clip.preservePitch',
    title: 'Preserve pitch when changing speed',
    group: 'Clip',
    keywords: ['speed', 'time stretch', 'chipmunk'],
    when: () => selectedMedia().length > 0,
    run: () => {
      const media = selectedMedia();
      setPreservePitch(
        media.map((c) => c.id),
        !media[0].preservePitch,
      );
    },
  },
  {
    id: 'compound.create',
    title: 'Create compound clip',
    group: 'Clip',
    keywords: ['nest', 'nested sequence', 'group into one'],
    shortcut: 'Alt+G',
    when: () => useUI.getState().selection.length > 0,
    run: createCompoundFromSelection,
  },
  {
    id: 'compound.open',
    title: 'Open compound clip',
    group: 'Clip',
    keywords: ['edit nested', 'enter'],
    when: hasCompoundTarget,
    run: () => openCompound(),
  },
  {
    id: 'compound.breakApart',
    title: 'Break apart compound clip',
    group: 'Clip',
    keywords: ['ungroup', 'un-nest', 'flatten'],
    shortcut: 'Alt+Shift+G',
    when: hasCompoundTarget,
    run: breakApartSelection,
  },
  {
    id: 'compound.close',
    title: 'Close compound clip',
    group: 'Timeline',
    keywords: ['back', 'parent timeline', 'exit nested'],
    when: inCompound,
    run: () => closeCompound(),
  },
  {
    id: 'compound.closeAll',
    title: 'Back to the project timeline',
    group: 'Timeline',
    keywords: ['root', 'main timeline', 'exit nested'],
    when: () => useProjectStore.getState().editPath.length > 1,
    run: () => closeCompound(0),
  },
];

export default commands;
