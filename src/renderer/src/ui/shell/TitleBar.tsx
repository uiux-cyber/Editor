import { Download, Home as HomeIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { engine } from '@/engine/engine';
import { api } from '@/platform/api';
import { updateProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { addMarker, copySelection, cutSelection, deleteSelection, duplicateSelection, paste, redo, selectAll, splitAtPlayhead, undo } from '../actions';
import { groupSelection, linkSelection, setTrackSize, toggleMagneticMain, ungroupSelection, unlinkSelection } from '../actions';
import { openMenuBelow, type MenuItem } from '../common/overlays';
import { importViaDialog } from '../library/MediaTab';
import { useHistoryPanel } from '../timeline/HistoryPanel';
import { TRACK_HEIGHT, TRACK_SIZES } from '../timeline/geometry';
import { closeProject, newProjectPrompt, openProject, saveProject } from './commands';

export function Logo({ size = 20 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="kinora-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a995ff" />
          <stop offset="0.55" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#kinora-g)" />
      <path d="M12 9.2v13.6a1 1 0 0 0 1.52.86l10.9-6.8a1 1 0 0 0 0-1.7l-10.9-6.82A1 1 0 0 0 12 9.2z" fill="#fff" />
      <rect x="7" y="9" width="2.6" height="14" rx="1.3" fill="#fff" opacity="0.72" />
    </svg>
  );
}

function menus(): Record<string, MenuItem[]> {
  const ui = useUI.getState();
  const store = useProjectStore.getState();
  const hasSelection = ui.selection.length > 0 || !!ui.selectedTransition;
  return {
    File: [
      { label: 'New project…', shortcut: 'Ctrl+N', run: newProjectPrompt },
      { label: 'Open project…', shortcut: 'Ctrl+O', run: () => void openProject() },
      { type: 'separator' },
      { label: 'Save', shortcut: 'Ctrl+S', run: () => void saveProject() },
      { label: 'Save as…', shortcut: 'Ctrl+Shift+S', run: () => void saveProject(true) },
      { type: 'separator' },
      { label: 'Import media…', shortcut: 'Ctrl+I', run: () => void importViaDialog() },
      { label: 'Export…', shortcut: 'Ctrl+E', run: () => ui.openModal('export') },
      { type: 'separator' },
      { label: 'Close project', shortcut: 'Ctrl+W', run: () => void closeProject() },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: store.past.length === 0, run: undo },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: store.future.length === 0, run: redo },
      { label: 'History…', shortcut: 'Ctrl+H', run: () => useHistoryPanel.getState().toggle() },
      { type: 'separator' },
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasSelection, run: cutSelection },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSelection, run: () => void copySelection() },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !ui.clipboard, run: paste },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !hasSelection, run: duplicateSelection },
      { label: 'Delete', shortcut: 'Del', disabled: !hasSelection, run: () => deleteSelection(false) },
      { label: 'Delete and close gap', shortcut: 'Shift+Del', disabled: !hasSelection, run: () => deleteSelection(true) },
      { type: 'separator' },
      { label: 'Select all', shortcut: 'Ctrl+A', run: selectAll },
      { label: 'Split at playhead', shortcut: 'S', run: splitAtPlayhead },
      { label: 'Add marker', shortcut: 'M', run: addMarker },
      { type: 'separator' },
      { label: 'Group', shortcut: 'Ctrl+G', disabled: ui.selection.length < 2, run: groupSelection },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', disabled: !ui.selection.some((id) => store.project.clips[id]?.groupId), run: ungroupSelection },
      { label: 'Link', shortcut: 'Ctrl+L', disabled: ui.selection.length < 2, run: linkSelection },
      { label: 'Unlink', shortcut: 'Ctrl+Shift+L', disabled: !ui.selection.some((id) => store.project.clips[id]?.linkId), run: unlinkSelection },
    ],
    View: [
      { label: 'Fit timeline to window', shortcut: 'Shift+Z', run: () => window.dispatchEvent(new CustomEvent('kinora:timeline-fit')) },
      { label: 'Zoom timeline in', shortcut: '+', run: () => window.dispatchEvent(new CustomEvent('kinora:timeline-zoom', { detail: 1.4 })) },
      { label: 'Zoom timeline out', shortcut: '−', run: () => window.dispatchEvent(new CustomEvent('kinora:timeline-zoom', { detail: 1 / 1.4 })) },
      { type: 'separator' },
      { label: 'Snapping', shortcut: 'N', checked: ui.snapping, run: () => ui.set({ snapping: !ui.snapping }) },
      { label: 'Magnetic main track', checked: !!store.project.magneticMain, run: toggleMagneticMain },
      { label: 'Safe zones', checked: ui.safeZones, run: () => ui.set({ safeZones: !ui.safeZones }) },
      { label: 'Loop playback', checked: ui.loop, run: () => ui.set({ loop: !ui.loop }) },
      { type: 'separator' },
      { type: 'label', label: 'Preview quality' },
      { label: 'Full', checked: ui.previewQuality === 1, run: () => ui.set({ previewQuality: 1 }) },
      { label: 'Half', checked: ui.previewQuality === 0.5, run: () => ui.set({ previewQuality: 0.5 }) },
      { label: 'Quarter', checked: ui.previewQuality === 0.25, run: () => ui.set({ previewQuality: 0.25 }) },
      { type: 'separator' },
      { type: 'label', label: 'Track size' },
      ...(['small', 'medium', 'large'] as const).map((size) => ({
        label: size[0].toUpperCase() + size.slice(1),
        // Checked when every track has that size.
        checked: store.project.tracks.every((t) => (t.height ?? TRACK_HEIGHT[t.kind]) === TRACK_SIZES[size][t.kind]),
        run: () => setTrackSize(size),
      })),
    ],
    Help: [
      { label: 'Keyboard shortcuts', shortcut: '?', run: () => ui.openModal('shortcuts') },
      { label: 'About Kinora', run: () => void api.app.info().then((info) => api.dialog.message({ title: 'About Kinora', message: `Kinora ${info.version}`, detail: `A GPU-accelerated video editor.\nElectron ${info.electron} · Chromium ${info.chrome}` })) },
    ],
  };
}

export function TitleBar(): ReactNode {
  const screen = useUI((s) => s.screen);
  const name = useProjectStore((s) => s.project.name);
  const dirty = useProjectStore((s) => s.project !== s.savedRef);
  const filePath = useProjectStore((s) => s.filePath);
  const hasContent = useProjectStore((s) => Object.keys(s.project.clips).length > 0);
  const [editing, setEditing] = useState(false);
  const editor = screen === 'editor';

  return (
    <header className="titlebar drag-region">
      <div className="titlebar__left no-drag">
        <button type="button" className="titlebar__brand" title={editor ? 'Back to the start screen' : 'Kinora'} onClick={() => editor && void closeProject()}>
          <Logo size={20} />
          {!editor && <span>Kinora</span>}
        </button>
        {editor && (
          <>
            <button type="button" className="icon-btn" title="Start screen" onClick={() => void closeProject()}>
              <HomeIcon size={15} />
            </button>
            <nav className="titlebar__menu">
              {Object.keys(menus()).map((label) => (
                <button key={label} type="button" onClick={(e) => openMenuBelow(e.currentTarget, menus()[label], { minWidth: 230 })}>
                  {label}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>

      {editor && (
        <div className="titlebar__center no-drag">
          {editing ? (
            <input
              autoFocus
              className="titlebar__name-input"
              defaultValue={name}
              spellCheck={false}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== name) updateProject((p) => void (p.name = next.slice(0, 120)));
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                e.stopPropagation();
              }}
            />
          ) : (
            <button type="button" className="titlebar__name truncate" title="Rename project" onClick={() => setEditing(true)}>
              {name}
            </button>
          )}
          <span className={`titlebar__state ${dirty && (hasContent || filePath) ? 'is-dirty' : ''}`} title={filePath ?? 'Not saved to a file yet'}>
            {dirty && (hasContent || filePath) ? 'Unsaved changes' : filePath ? 'Saved' : ''}
          </span>
        </div>
      )}

      <div className="titlebar__right no-drag">
        {editor && (
          <button
            type="button"
            className="btn btn--primary"
            title="Export (Ctrl+E)"
            onClick={() => {
              engine.pause();
              useUI.getState().openModal('export');
            }}
          >
            <Download size={14} /> Export
          </button>
        )}
      </div>
    </header>
  );
}
