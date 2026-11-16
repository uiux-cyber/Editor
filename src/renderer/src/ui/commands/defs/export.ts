import type { Command } from '../index';
import { cancelAll, clearFinished, useExportQueue } from '@/engine/export/queue';
import { isBusy, isFinished } from '@/engine/export/queueState';
import { getProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { clearMarks, goToIn, goToOut, markIn, markOut, markSelection, openExportDialog, openExportQueue } from '../../export/actions';

const inEditor = (): boolean => useUI.getState().screen === 'editor';
const hasMarks = (): boolean => {
  const p = getProject();
  return inEditor() && (p.inPoint !== undefined || p.outPoint !== undefined);
};

const commands: Command[] = [
  { id: 'export.open', title: 'Export…', group: 'File', shortcut: 'Ctrl+E', keywords: ['render', 'save video', 'youtube', 'tiktok', 'instagram', 'mp4', 'presets'], when: inEditor, run: openExportDialog },
  { id: 'export.queue', title: 'Show export queue', group: 'File', keywords: ['exports', 'render queue', 'progress', 'background'], run: openExportQueue },
  { id: 'export.markIn', title: 'Mark In at playhead', group: 'Timeline', shortcut: 'I', keywords: ['in point', 'range', 'section'], when: inEditor, run: () => markIn() },
  { id: 'export.markOut', title: 'Mark Out at playhead', group: 'Timeline', shortcut: 'O', keywords: ['out point', 'range', 'section'], when: inEditor, run: () => markOut() },
  { id: 'export.markSelection', title: 'Mark In / Out around selection', group: 'Timeline', keywords: ['range', 'section', 'selected clips'], when: () => inEditor() && useUI.getState().selection.length > 0, run: markSelection },
  { id: 'export.clearInOut', title: 'Clear In / Out', group: 'Timeline', shortcut: 'Alt+X', keywords: ['range', 'marks'], when: hasMarks, run: clearMarks },
  { id: 'export.goToIn', title: 'Go to In', group: 'Timeline', shortcut: 'Shift+I', when: () => inEditor() && getProject().inPoint !== undefined, run: goToIn },
  { id: 'export.goToOut', title: 'Go to Out', group: 'Timeline', shortcut: 'Shift+O', when: () => inEditor() && getProject().outPoint !== undefined, run: goToOut },
  { id: 'export.cancelAll', title: 'Cancel all exports', group: 'File', keywords: ['stop', 'queue'], when: () => isBusy(useExportQueue.getState()), run: cancelAll },
  { id: 'export.clearFinished', title: 'Clear finished exports', group: 'File', keywords: ['queue'], when: () => useExportQueue.getState().jobs.some((j) => isFinished(j.status)), run: clearFinished },
];

export default commands;
