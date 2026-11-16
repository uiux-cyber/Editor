/**
 * Text & graphics commands: pen tool, count-up numbers, path editing and animated media import.
 */

import { counterFromText, formatCounter } from '@/core/counter';
import { isSmooth, smoothHandles } from '@/core/path';
import type { Clip } from '@/core/types';
import { getProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { addText, editClips } from '../../actions';
import { importViaDialog } from '../../library/MediaTab';
import { editPath } from '../../preview/pen/pathOps';
import type { Command } from '../index';

const selected = (): Clip[] => {
  const p = getProject();
  return useUI
    .getState()
    .selection.map((id) => p.clips[id])
    .filter(Boolean);
};
const selectedText = (): Clip[] => selected().filter((c) => c.type === 'text' && !c.caption);
const selectedPaths = (): Clip[] => selected().filter((c) => c.type === 'shape' && c.shape.kind === 'path' && !!c.shape.path);

const commands: Command[] = [
  {
    id: 'graphics.penTool',
    title: 'Pen tool',
    group: 'Graphics',
    keywords: ['draw', 'path', 'bezier', 'vector', 'shape', 'line', 'curve'],
    shortcut: 'P',
    run: () => useUI.getState().setTool('pen'),
  },
  {
    id: 'graphics.addCounter',
    title: 'Add count-up number',
    group: 'Graphics',
    keywords: ['counter', 'number', 'stat', 'count', 'animate', 'percentage', 'money'],
    run: () => addText('counter-big-stat'),
  },
  {
    id: 'graphics.toggleCounter',
    title: 'Toggle count-up on the selected text',
    group: 'Graphics',
    keywords: ['counter', 'number', 'count'],
    when: () => selectedText().length > 0,
    run: () => {
      const on = !selectedText().every((c) => c.type === 'text' && !!c.counter);
      editClips(
        selectedText().map((c) => c.id),
        (c) => {
          if (c.type !== 'text') return;
          if (!on) delete c.counter;
          else if (!c.counter) {
            c.counter = counterFromText(c.text.content);
            c.text.content = formatCounter(c.counter, c.counter.to);
          }
        },
      );
    },
  },
  {
    id: 'graphics.closePath',
    title: 'Close / open the selected path',
    group: 'Graphics',
    keywords: ['path', 'pen', 'close', 'open'],
    when: () => selectedPaths().length > 0,
    run: () => editPath(selectedPaths().map((c) => c.id), (pts, closed) => ({ points: pts, closed: !closed && pts.length > 2 })),
  },
  {
    id: 'graphics.smoothPath',
    title: 'Smooth every point of the selected path',
    group: 'Graphics',
    keywords: ['path', 'pen', 'bezier', 'curve'],
    when: () => selectedPaths().length > 0,
    run: () =>
      editPath(
        selectedPaths().map((c) => c.id),
        (pts, closed) => ({
          points: pts.map((p, i) => (isSmooth(p) ? p : { ...p, ...smoothHandles(pts, closed, i) })),
          closed,
        }),
      ),
  },
  {
    id: 'graphics.importAnimation',
    title: 'Import animated GIF or Lottie…',
    group: 'Graphics',
    keywords: ['gif', 'lottie', 'webp', 'apng', 'animation', 'sticker', 'import'],
    run: () => importViaDialog(),
  },
];

export default commands;
