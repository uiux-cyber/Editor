/**
 * Core commands: every action of the shell, the title-bar menus and the default shortcuts.
 * Ids are stable (they key the user's custom shortcuts and the palette's recent list).
 */

import { engine } from '@/engine/engine';
import { api } from '@/platform/api';
import { useProjectStore } from '@/store/project';
import { useUI, type LibraryTab } from '@/store/ui';
import {
  addMarker,
  addTrackOfKind,
  copySelection,
  cutSelection,
  deleteSelection,
  detachAudioFromSelection,
  duplicateSelection,
  jumpToEdit,
  nudgeSelection,
  paste,
  redo,
  selectAll,
  splitAtPlayhead,
  tidyTracks,
  trimToPlayhead,
  undo,
} from '../../actions';
import { startCollect } from '../../collect/collect';
import { checkForUpdates, installUpdate, isUpdateReady } from '../../shell/updates';
import { t } from '../../i18n';
import { importViaDialog } from '../../library/MediaTab';
import { openPalette } from '../../palette/store';
import { closeProject, newProjectPrompt, openProject, saveProject } from '../../shell/commands';
import { cyclePane } from '../../shell/panes';
import { openSettings } from '../../settings/store';
import { setTheme, useTheme } from '../../theme';
import type { Command } from '../index';

const ui = (): ReturnType<typeof useUI.getState> => useUI.getState();
const inEditor = (): boolean => ui().screen === 'editor';
const hasClipSelection = (): boolean => inEditor() && (ui().selection.length > 0 || !!ui().selectedTransition);
const hasClips = (): boolean => inEditor() && ui().selection.length > 0;
const hasVideoSelected = (): boolean => {
  if (!inEditor()) return false;
  const clips = useProjectStore.getState().project.clips;
  return ui().selection.some((id) => clips[id]?.type === 'video');
};

const timelineZoom = (factor: number): void => void window.dispatchEvent(new CustomEvent('kinora:timeline-zoom', { detail: factor }));

function toggleFullscreenPreview(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.querySelector('[data-preview]')?.requestFullscreen();
}

async function showAbout(): Promise<void> {
  const info = await api.app.info();
  await api.dialog.message({
    title: t('About Kinora'),
    message: `Kinora ${info.version}`,
    detail: `${t('A GPU-accelerated video editor.')}\nElectron ${info.electron} · Chromium ${info.chrome}`,
  });
}

const LIBRARY_TABS: { tab: LibraryTab; title: string; keywords: string[] }[] = [
  { tab: 'media', title: 'Show media', keywords: ['library', 'bin', 'files', 'import'] },
  { tab: 'templates', title: 'Show templates', keywords: ['library'] },
  { tab: 'text', title: 'Show text styles', keywords: ['library', 'titles'] },
  { tab: 'stickers', title: 'Show stickers', keywords: ['library', 'emoji'] },
  { tab: 'transitions', title: 'Show transitions', keywords: ['library'] },
  { tab: 'effects', title: 'Show effects', keywords: ['library', 'fx'] },
  { tab: 'filters', title: 'Show filters', keywords: ['library', 'looks', 'lut', 'grade'] },
  { tab: 'audio', title: 'Show audio', keywords: ['library', 'music', 'sounds', 'sfx'] },
  { tab: 'elements', title: 'Show elements', keywords: ['library', 'shapes', 'backgrounds'] },
  { tab: 'tools', title: 'Show smart tools', keywords: ['library', 'ai', 'smart'] },
];

const commands: Command[] = [
  // ---- File ------------------------------------------------------------------------------
  { id: 'file.new', title: 'New project…', group: 'File', shortcut: 'Ctrl+N', global: true, keywords: ['create', 'start'], run: newProjectPrompt },
  { id: 'file.open', title: 'Open project…', group: 'File', shortcut: 'Ctrl+O', global: true, keywords: ['load'], run: () => openProject() },
  { id: 'file.save', title: 'Save', group: 'File', shortcut: 'Ctrl+S', global: true, when: inEditor, run: () => saveProject() },
  { id: 'file.saveAs', title: 'Save as…', group: 'File', shortcut: 'Ctrl+Shift+S', global: true, when: inEditor, keywords: ['copy', 'rename'], run: () => saveProject(true) },
  {
    id: 'file.collect',
    title: 'Collect project…',
    group: 'File',
    when: inEditor,
    keywords: ['archive', 'package', 'consolidate', 'copy media', 'move', 'backup', 'gather', 'project manager'],
    run: startCollect,
  },
  { id: 'file.import', title: 'Import media…', group: 'File', shortcut: 'Ctrl+I', when: inEditor, keywords: ['add', 'video', 'audio', 'image', 'files'], run: () => importViaDialog() },
  {
    id: 'file.export',
    title: 'Export…',
    group: 'File',
    shortcut: 'Ctrl+E',
    global: true,
    when: inEditor,
    keywords: ['render', 'mp4', 'video', 'gif', 'share'],
    run: () => {
      engine.pause();
      ui().openModal('export');
    },
  },
  { id: 'file.close', title: 'Close project', group: 'File', shortcut: 'Ctrl+W', global: true, when: inEditor, keywords: ['home', 'start screen'], run: () => closeProject() },

  // ---- Edit ------------------------------------------------------------------------------
  { id: 'edit.undo', title: 'Undo', group: 'Edit', shortcut: 'Ctrl+Z', when: () => inEditor() && useProjectStore.getState().past.length > 0, run: undo },
  { id: 'edit.redo', title: 'Redo', group: 'Edit', shortcut: 'Ctrl+Shift+Z', extraShortcuts: ['Ctrl+Y'], when: () => inEditor() && useProjectStore.getState().future.length > 0, run: redo },
  { id: 'edit.cut', title: 'Cut', group: 'Edit', shortcut: 'Ctrl+X', when: hasClips, run: cutSelection },
  { id: 'edit.copy', title: 'Copy', group: 'Edit', shortcut: 'Ctrl+C', when: hasClips, run: () => void copySelection() },
  { id: 'edit.paste', title: 'Paste', group: 'Edit', shortcut: 'Ctrl+V', when: () => inEditor() && !!ui().clipboard, run: paste },
  { id: 'edit.duplicate', title: 'Duplicate', group: 'Edit', shortcut: 'Ctrl+D', when: hasClips, keywords: ['copy', 'clone'], run: duplicateSelection },
  { id: 'edit.delete', title: 'Delete', group: 'Edit', shortcut: 'Delete', extraShortcuts: ['Backspace'], when: hasClipSelection, keywords: ['remove'], run: () => deleteSelection(false) },
  {
    id: 'edit.rippleDelete',
    title: 'Delete and close gap',
    group: 'Edit',
    shortcut: 'Shift+Delete',
    extraShortcuts: ['Shift+Backspace'],
    when: hasClipSelection,
    keywords: ['ripple', 'remove'],
    run: () => deleteSelection(true),
  },
  { id: 'edit.selectAll', title: 'Select all', group: 'Edit', shortcut: 'Ctrl+A', when: inEditor, run: selectAll },
  {
    id: 'edit.deselect',
    title: 'Deselect all',
    group: 'Edit',
    shortcut: 'Escape',
    when: () => inEditor() && (ui().tool !== 'select' || ui().selection.length > 0 || !!ui().selectedTransition),
    keywords: ['clear selection', 'escape'],
    run: () => {
      if (ui().tool !== 'select') ui().setTool('select');
      else ui().clearSelection();
    },
  },

  // ---- Clip ------------------------------------------------------------------------------
  { id: 'clip.split', title: 'Split at playhead', group: 'Clip', menu: 'Edit', shortcut: 'S', extraShortcuts: ['Ctrl+B'], when: inEditor, keywords: ['cut', 'razor', 'blade'], run: splitAtPlayhead },
  { id: 'clip.trimStart', title: 'Trim start to playhead', group: 'Clip', menu: 'Edit', shortcut: 'Q', when: inEditor, keywords: ['in point'], run: () => trimToPlayhead('start') },
  { id: 'clip.trimEnd', title: 'Trim end to playhead', group: 'Clip', menu: 'Edit', shortcut: 'W', when: inEditor, keywords: ['out point'], run: () => trimToPlayhead('end') },
  { id: 'clip.detachAudio', title: 'Detach audio', group: 'Clip', menu: 'Edit', when: hasVideoSelected, keywords: ['separate', 'unlink', 'extract sound'], run: detachAudioFromSelection },
  { id: 'clip.nudgeLeft', title: 'Nudge left one frame', group: 'Clip', menu: false, shortcut: 'Alt+ArrowLeft', when: hasClips, keywords: ['move'], run: () => nudgeSelection(-1) },
  { id: 'clip.nudgeRight', title: 'Nudge right one frame', group: 'Clip', menu: false, shortcut: 'Alt+ArrowRight', when: hasClips, keywords: ['move'], run: () => nudgeSelection(1) },
  { id: 'clip.nudgeLeft10', title: 'Nudge left 10 frames', group: 'Clip', menu: false, shortcut: 'Alt+Shift+ArrowLeft', when: hasClips, keywords: ['move'], run: () => nudgeSelection(-10) },
  { id: 'clip.nudgeRight10', title: 'Nudge right 10 frames', group: 'Clip', menu: false, shortcut: 'Alt+Shift+ArrowRight', when: hasClips, keywords: ['move'], run: () => nudgeSelection(10) },

  // ---- Timeline --------------------------------------------------------------------------
  { id: 'timeline.addMarker', title: 'Add marker', group: 'Timeline', menu: 'Edit', shortcut: 'M', when: inEditor, keywords: ['bookmark', 'cue'], run: addMarker },
  { id: 'timeline.addVideoTrack', title: 'Add video track', group: 'Timeline', menu: 'Edit', when: inEditor, keywords: ['layer', 'visual track'], run: () => addTrackOfKind('visual') },
  { id: 'timeline.addAudioTrack', title: 'Add audio track', group: 'Timeline', menu: 'Edit', when: inEditor, keywords: ['sound track'], run: () => addTrackOfKind('audio') },
  { id: 'timeline.removeEmptyTracks', title: 'Remove empty tracks', group: 'Timeline', menu: 'Edit', when: inEditor, keywords: ['tidy', 'clean up'], run: tidyTracks },
  {
    id: 'timeline.snapping',
    title: 'Snapping',
    group: 'Timeline',
    menu: 'View',
    shortcut: 'N',
    when: inEditor,
    checked: () => ui().snapping,
    keywords: ['magnet', 'snap'],
    run: () => ui().set({ snapping: !ui().snapping }),
  },
  { id: 'timeline.zoomIn', title: 'Zoom timeline in', group: 'Timeline', menu: 'View', menuTitle: 'Zoom in', shortcut: '=', extraShortcuts: ['+', 'Ctrl+=', 'Ctrl++'], when: inEditor, run: () => timelineZoom(1.4) },
  { id: 'timeline.zoomOut', title: 'Zoom timeline out', group: 'Timeline', menu: 'View', menuTitle: 'Zoom out', shortcut: '-', extraShortcuts: ['_', 'Ctrl+-'], when: inEditor, run: () => timelineZoom(1 / 1.4) },
  {
    id: 'timeline.fit',
    title: 'Fit timeline to window',
    group: 'Timeline',
    menu: 'View',
    menuTitle: 'Fit to window',
    shortcut: 'Shift+Z',
    when: inEditor,
    keywords: ['zoom to fit', 'whole project'],
    run: () => window.dispatchEvent(new CustomEvent('kinora:timeline-fit')),
  },

  // ---- Tools -----------------------------------------------------------------------------
  { id: 'tool.select', title: 'Select tool', group: 'Tools', shortcut: 'V', when: inEditor, checked: () => ui().tool === 'select', keywords: ['pointer', 'arrow'], run: () => ui().setTool('select') },
  { id: 'tool.blade', title: 'Blade tool', group: 'Tools', shortcut: 'C', extraShortcuts: ['B'], when: inEditor, checked: () => ui().tool === 'blade', keywords: ['razor', 'cut', 'split'], run: () => ui().setTool('blade') },

  // ---- Playback --------------------------------------------------------------------------
  { id: 'playback.toggle', title: 'Play / pause', group: 'Playback', menu: 'View', shortcut: 'Space', when: inEditor, keywords: ['play', 'pause', 'stop'], run: () => engine.toggle() },
  { id: 'playback.pause', title: 'Pause', group: 'Playback', menu: false, shortcut: 'K', when: inEditor, keywords: ['stop'], run: () => engine.pause() },
  { id: 'playback.back1s', title: 'Jump back 1 second', group: 'Playback', menu: false, shortcut: 'J', when: inEditor, keywords: ['rewind'], run: () => engine.seek(engine.time - 1) },
  { id: 'playback.fwd1s', title: 'Jump forward 1 second', group: 'Playback', menu: false, shortcut: 'L', when: inEditor, keywords: ['forward'], run: () => engine.seek(engine.time + 1) },
  { id: 'playback.prevFrame', title: 'Previous frame', group: 'Playback', menu: false, shortcut: 'ArrowLeft', when: inEditor, keywords: ['step back'], run: () => engine.stepFrames(-1) },
  { id: 'playback.nextFrame', title: 'Next frame', group: 'Playback', menu: false, shortcut: 'ArrowRight', when: inEditor, keywords: ['step forward'], run: () => engine.stepFrames(1) },
  { id: 'playback.back10', title: 'Back 10 frames', group: 'Playback', menu: false, shortcut: 'Shift+ArrowLeft', when: inEditor, run: () => engine.stepFrames(-10) },
  { id: 'playback.fwd10', title: 'Forward 10 frames', group: 'Playback', menu: false, shortcut: 'Shift+ArrowRight', when: inEditor, run: () => engine.stepFrames(10) },
  { id: 'playback.prevEdit', title: 'Previous edit point', group: 'Playback', menu: 'View', shortcut: 'ArrowUp', when: inEditor, keywords: ['cut', 'jump'], run: () => jumpToEdit(-1) },
  { id: 'playback.nextEdit', title: 'Next edit point', group: 'Playback', menu: 'View', shortcut: 'ArrowDown', when: inEditor, keywords: ['cut', 'jump'], run: () => jumpToEdit(1) },
  { id: 'playback.start', title: 'Go to start', group: 'Playback', menu: 'View', shortcut: 'Home', when: inEditor, keywords: ['beginning'], run: () => engine.seek(0) },
  { id: 'playback.end', title: 'Go to end', group: 'Playback', menu: 'View', shortcut: 'End', when: inEditor, run: () => engine.seek(engine.duration) },
  { id: 'playback.loop', title: 'Loop playback', group: 'Playback', menu: 'View', when: inEditor, checked: () => ui().loop, keywords: ['repeat'], run: () => ui().set({ loop: !ui().loop }) },

  // ---- View ------------------------------------------------------------------------------
  {
    id: 'view.palette',
    title: 'Command palette…',
    group: 'View',
    shortcut: 'Ctrl+K',
    extraShortcuts: ['Ctrl+Shift+P'],
    global: true,
    keywords: ['search', 'find', 'run', 'go to', 'quick open'],
    run: () => openPalette(),
  },
  { id: 'view.fullscreenPreview', title: 'Fullscreen preview', group: 'View', shortcut: 'F', when: inEditor, keywords: ['full screen', 'maximize'], run: toggleFullscreenPreview },
  { id: 'view.safeZones', title: 'Safe zones', group: 'View', when: inEditor, checked: () => ui().safeZones, keywords: ['title safe', 'action safe', 'guides'], run: () => ui().set({ safeZones: !ui().safeZones }) },
  ...([
    ['full', 'Preview quality: Full', 'Full', 1],
    ['half', 'Preview quality: Half', 'Half', 0.5],
    ['quarter', 'Preview quality: Quarter', 'Quarter', 0.25],
  ] as const).map(
    ([id, title, label, q]): Command => ({
      id: `view.quality.${id}`,
      title,
      menuTitle: label,
      group: 'View',
      when: inEditor,
      checked: () => ui().previewQuality === q,
      keywords: ['resolution', 'performance'],
      run: () => ui().set({ previewQuality: q }),
    }),
  ),
  ...([
    ['system', 'Theme: System', 'System'],
    ['dark', 'Theme: Dark', 'Dark'],
    ['light', 'Theme: Light', 'Light'],
  ] as const).map(
    ([id, title, label]): Command => ({
      id: `view.theme.${id}`,
      title,
      menuTitle: label,
      group: 'View',
      checked: () => useTheme.getState().setting === id,
      keywords: ['appearance', 'colour', 'color', 'mode', id === 'light' ? 'bright' : id === 'dark' ? 'night' : 'automatic'],
      run: () => setTheme(id),
    }),
  ),
  { id: 'view.focusNextPane', title: 'Focus next panel', group: 'View', shortcut: 'F6', global: true, when: inEditor, keywords: ['keyboard', 'navigate', 'region'], run: () => cyclePane(1) },
  { id: 'view.focusPrevPane', title: 'Focus previous panel', group: 'View', shortcut: 'Shift+F6', global: true, when: inEditor, keywords: ['keyboard', 'navigate', 'region'], run: () => cyclePane(-1) },
  {
    id: 'view.focusMenu',
    title: 'Focus the menu bar',
    group: 'View',
    menu: false,
    shortcut: 'F10',
    global: true,
    keywords: ['keyboard', 'menus'],
    run: () => document.querySelector<HTMLElement>('.titlebar__menu button, .titlebar__brand')?.focus(),
  },
  ...LIBRARY_TABS.map(
    ({ tab, title, keywords }): Command => ({
      id: `view.library.${tab}`,
      title,
      group: 'View',
      menu: false,
      when: inEditor,
      keywords,
      run: () => ui().setLibraryTab(tab),
    }),
  ),

  // ---- Preferences -----------------------------------------------------------------------
  { id: 'app.settings', title: 'Settings…', group: 'Preferences', menu: 'File', shortcut: 'Ctrl+,', global: true, keywords: ['preferences', 'options', 'configure'], run: () => openSettings() },
  { id: 'app.appearance', title: 'Appearance settings…', group: 'Preferences', menu: false, keywords: ['theme', 'dark', 'light', 'motion'], run: () => openSettings('appearance') },
  { id: 'app.language', title: 'Change language…', group: 'Preferences', menu: 'Help', keywords: ['language', 'locale', 'translation', 'idioma', 'langue', 'sprache', 'भाषा'], run: () => openSettings('language') },

  // ---- Help ------------------------------------------------------------------------------
  { id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', shortcut: '?', keywords: ['keys', 'hotkeys', 'cheat sheet'], run: () => ui().openModal('shortcuts') },
  { id: 'help.customizeShortcuts', title: 'Customize keyboard shortcuts…', group: 'Help', keywords: ['keymap', 'hotkeys', 'rebind'], run: () => openSettings('shortcuts') },
  { id: 'help.checkForUpdates', title: 'Check for updates…', group: 'Help', keywords: ['update', 'upgrade', 'new version', 'release'], run: () => void checkForUpdates() },
  { id: 'help.installUpdate', title: 'Restart to update', group: 'Help', menu: false, keywords: ['update', 'install', 'upgrade'], when: isUpdateReady, run: () => void installUpdate() },
  { id: 'help.about', title: 'About Kinora', group: 'Help', keywords: ['version'], run: () => showAbout() },
];

export default commands;
