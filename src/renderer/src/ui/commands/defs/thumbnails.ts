import type { Command } from '../index';
import { engine } from '@/engine/engine';
import { getRootProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { closeThumbnails, inThumbnail, newThumbnailFromFrame, openThumbnails } from '../../thumbnails/actions';
import { openFramePicker } from '../../thumbnails/dialogs';

const inEditor = (): boolean => useUI.getState().screen === 'editor';
const hasThumbnails = (): boolean => inEditor() && (getRootProject().thumbnails?.length ?? 0) > 0;

const commands: Command[] = [
  {
    id: 'thumbnail.edit',
    title: 'Edit thumbnail',
    group: 'File',
    menuSection: 'Thumbnail',
    keywords: ['cover', 'youtube thumbnail', 'poster', 'picture', 'image', 'frame'],
    when: () => inEditor() && !inThumbnail(),
    run: () => void openThumbnails(),
  },
  {
    id: 'thumbnail.newFromPlayhead',
    title: 'New thumbnail from the frame at the playhead',
    group: 'File',
    menuSection: 'Thumbnail',
    keywords: ['cover', 'capture frame', 'still', 'a/b test', 'variant'],
    when: () => inEditor() && !inThumbnail(),
    run: () => void newThumbnailFromFrame(engine.time),
  },
  { id: 'thumbnail.changeFrame', title: 'Change thumbnail frame…', group: 'File', menuSection: 'Thumbnail', keywords: ['background', 'video frame', 'moment'], when: inThumbnail, run: () => openFramePicker('change') },
  {
    id: 'thumbnail.feed',
    title: 'Preview thumbnail in feed',
    group: 'File',
    menuSection: 'Thumbnail',
    keywords: ['how it looks', 'small size', 'compare', 'a/b'],
    when: hasThumbnails,
    run: () => {
      engine.pause();
      useUI.getState().openModal('thumbnailFeed');
    },
  },
  {
    id: 'thumbnail.export',
    title: 'Export thumbnail…',
    group: 'File',
    menuSection: 'Thumbnail',
    keywords: ['save picture', 'jpg', 'png', 'youtube', 'cover'],
    when: hasThumbnails,
    run: () => {
      engine.pause();
      useUI.getState().openModal('thumbnailExport');
    },
  },
  { id: 'thumbnail.back', title: 'Back to the video', group: 'File', menuSection: 'Thumbnail', keywords: ['close thumbnail', 'timeline'], when: inThumbnail, run: closeThumbnails },
];

export default commands;
