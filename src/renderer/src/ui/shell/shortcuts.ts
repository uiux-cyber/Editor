import { engine } from '@/engine/engine';
import { useUI } from '@/store/ui';
import {
  addMarker,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  jumpToEdit,
  linkSelection,
  nudgeSelection,
  paste,
  redo,
  selectAll,
  splitAtPlayhead,
  trimToPlayhead,
  undo,
  ungroupSelection,
  unlinkSelection,
} from '../actions';
import { runCommand } from '../commands';
import { useMenu } from '../common/overlays';
import { importViaDialog } from '../library/MediaTab';
import { closeProject, newProjectPrompt, openProject, saveProject } from './commands';

export interface ShortcutInfo {
  keys: string[];
  label: string;
  group: 'Playback' | 'Editing' | 'Timeline' | 'Project';
}

/** Shown in the keyboard shortcuts dialog. */
export const SHORTCUTS: ShortcutInfo[] = [
  { group: 'Playback', keys: ['Space'], label: 'Play / pause' },
  { group: 'Playback', keys: ['←', '→'], label: 'Previous / next frame' },
  { group: 'Playback', keys: ['Shift', '←/→'], label: 'Jump 10 frames' },
  { group: 'Playback', keys: ['↑', '↓'], label: 'Previous / next edit point' },
  { group: 'Playback', keys: ['Home', 'End'], label: 'Go to start / end' },
  { group: 'Playback', keys: ['J', 'L'], label: 'Jump back / forward 1 second' },
  { group: 'Playback', keys: ['F'], label: 'Fullscreen preview' },
  { group: 'Editing', keys: ['S'], label: 'Split at playhead' },
  { group: 'Editing', keys: ['Q', 'W'], label: 'Trim start / end to playhead' },
  { group: 'Editing', keys: ['Del'], label: 'Delete selection' },
  { group: 'Editing', keys: ['Shift', 'Del'], label: 'Delete and close the gap' },
  { group: 'Editing', keys: ['Ctrl', 'C / X / V'], label: 'Copy / cut / paste' },
  { group: 'Editing', keys: ['Ctrl', 'D'], label: 'Duplicate' },
  { group: 'Editing', keys: ['Ctrl', 'A'], label: 'Select everything' },
  { group: 'Editing', keys: ['Alt', '←/→'], label: 'Nudge selection by one frame' },
  { group: 'Editing', keys: ['Ctrl', 'Z'], label: 'Undo' },
  { group: 'Editing', keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
  { group: 'Editing', keys: ['Ctrl', 'H'], label: 'History' },
  { group: 'Editing', keys: ['Ctrl', 'G'], label: 'Group (Ctrl+Shift+G ungroups)' },
  { group: 'Editing', keys: ['Ctrl', 'L'], label: 'Link (Ctrl+Shift+L unlinks)' },
  { group: 'Editing', keys: ['Alt', 'Click'], label: 'Select one clip of a group or link' },
  { group: 'Timeline', keys: ['V'], label: 'Select tool' },
  { group: 'Timeline', keys: ['C'], label: 'Blade tool' },
  { group: 'Timeline', keys: ['E'], label: 'Ripple tool (or Shift-drag an edge)' },
  { group: 'Timeline', keys: ['R'], label: 'Roll tool' },
  { group: 'Timeline', keys: ['Y'], label: 'Slip tool' },
  { group: 'Timeline', keys: ['U'], label: 'Slide tool' },
  { group: 'Timeline', keys: ['N'], label: 'Toggle snapping' },
  { group: 'Timeline', keys: ['M'], label: 'Add marker' },
  { group: 'Timeline', keys: ['+', '−'], label: 'Zoom in / out' },
  { group: 'Timeline', keys: ['Shift', 'Z'], label: 'Fit the project in view' },
  { group: 'Timeline', keys: ['Ctrl', 'Scroll'], label: 'Zoom around the cursor' },
  { group: 'Project', keys: ['Ctrl', 'S'], label: 'Save' },
  { group: 'Project', keys: ['Ctrl', 'Shift', 'S'], label: 'Save as…' },
  { group: 'Project', keys: ['Ctrl', 'O'], label: 'Open project' },
  { group: 'Project', keys: ['Ctrl', 'N'], label: 'New project' },
  { group: 'Project', keys: ['Ctrl', 'I'], label: 'Import media' },
  { group: 'Project', keys: ['Ctrl', 'E'], label: 'Export' },
  { group: 'Project', keys: ['?'], label: 'Keyboard shortcuts' },
];

const isTyping = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (node as HTMLInputElement).type;
    return type !== 'range' && type !== 'checkbox' && type !== 'color' && type !== 'button';
  }
  return false;
};

const timelineZoom = (factor: number): void => void window.dispatchEvent(new CustomEvent('kinora:timeline-zoom', { detail: factor }));

/** Global keyboard handler for the editor screen. */
export function handleEditorKey(e: KeyboardEvent): void {
  const ui = useUI.getState();
  if (ui.screen !== 'editor') return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  // Document-level commands work even while a field has focus.
  if (mod && !e.altKey) {
    if (lower === 's') {
      e.preventDefault();
      void saveProject(e.shiftKey);
      return;
    }
    if (lower === 'o') {
      e.preventDefault();
      void openProject();
      return;
    }
    if (lower === 'n') {
      e.preventDefault();
      newProjectPrompt();
      return;
    }
    if (lower === 'e') {
      e.preventDefault();
      ui.openModal('export');
      return;
    }
    if (lower === 'w') {
      e.preventDefault();
      void closeProject();
      return;
    }
  }

  if (isTyping(e.target) || ui.modal || useMenu.getState().open) return;

  if (mod) {
    switch (lower) {
      case 'z':
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      case 'y':
        e.preventDefault();
        redo();
        return;
      case 'c':
        e.preventDefault();
        copySelection();
        return;
      case 'x':
        e.preventDefault();
        cutSelection();
        return;
      case 'v':
        e.preventDefault();
        paste();
        return;
      case 'd':
        e.preventDefault();
        duplicateSelection();
        return;
      case 'a':
        e.preventDefault();
        selectAll();
        return;
      case 'b':
        e.preventDefault();
        splitAtPlayhead();
        return;
      case 'i':
        e.preventDefault();
        void importViaDialog();
        return;
      // Timeline editing (commands in ui/commands/defs/editing.ts).
      case 'g':
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      case 'l':
        e.preventDefault();
        if (e.shiftKey) unlinkSelection();
        else linkSelection();
        return;
      case 'h':
        e.preventDefault();
        runCommand('view.history');
        return;
      case '=':
      case '+':
        e.preventDefault();
        timelineZoom(1.4);
        return;
      case '-':
        e.preventDefault();
        timelineZoom(1 / 1.4);
        return;
      default:
        return;
    }
  }

  switch (lower) {
    case ' ':
      e.preventDefault();
      engine.toggle();
      return;
    case 'k':
      engine.pause();
      return;
    case 'j':
      engine.seek(engine.time - 1);
      return;
    case 'l':
      engine.seek(engine.time + 1);
      return;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.altKey) nudgeSelection(e.shiftKey ? -10 : -1);
      else engine.stepFrames(e.shiftKey ? -10 : -1);
      return;
    case 'ArrowRight':
      e.preventDefault();
      if (e.altKey) nudgeSelection(e.shiftKey ? 10 : 1);
      else engine.stepFrames(e.shiftKey ? 10 : 1);
      return;
    case 'ArrowUp':
      e.preventDefault();
      jumpToEdit(-1);
      return;
    case 'ArrowDown':
      e.preventDefault();
      jumpToEdit(1);
      return;
    case 'Home':
      engine.seek(0);
      return;
    case 'End':
      engine.seek(engine.duration);
      return;
    case 's':
      splitAtPlayhead();
      return;
    case 'q':
      trimToPlayhead('start');
      return;
    case 'w':
      trimToPlayhead('end');
      return;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteSelection(e.shiftKey);
      return;
    case 'Escape':
      if (ui.tool !== 'select') ui.setTool('select');
      else ui.clearSelection();
      return;
    case 'v':
      ui.setTool('select');
      return;
    case 'c':
    case 'b':
      ui.setTool('blade');
      return;
    case 'e':
      runCommand('timeline.tool.ripple');
      return;
    case 'r':
      runCommand('timeline.tool.roll');
      return;
    case 'y':
      runCommand('timeline.tool.slip');
      return;
    case 'u':
      runCommand('timeline.tool.slide');
      return;
    case 'n':
      ui.set({ snapping: !ui.snapping });
      return;
    case 'm':
      addMarker();
      return;
    case '=':
    case '+':
      timelineZoom(1.4);
      return;
    case '-':
    case '_':
      timelineZoom(1 / 1.4);
      return;
    case 'z':
      if (e.shiftKey) window.dispatchEvent(new CustomEvent('kinora:timeline-fit'));
      return;
    case 'f': {
      const el = document.querySelector('[data-preview]');
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el?.requestFullscreen();
      return;
    }
    case '?':
      ui.openModal('shortcuts');
      return;
    default:
  }
}
