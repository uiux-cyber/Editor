import { Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MEDIA_EXTS, PROJECT_EXT, extOf } from '@shared/ipc';
import { api } from './platform/api';
import { useUI } from './store/ui';
import { addAsset, sanitizeSelection } from './ui/actions';
import { Resizer } from './ui/common/controls';
import { MenuHost, Toasts } from './ui/common/overlays';
import { DragGhost } from './ui/dnd';
import { Inspector } from './ui/inspector/Inspector';
import { LibraryPanel, LibraryRail } from './ui/library/LibraryPanel';
import { importFiles } from './ui/library/MediaTab';
import { Preview } from './ui/preview/Preview';
import { confirmDiscard, openProject, startDocumentSync } from './ui/projectIO';
import { Home } from './ui/shell/Home';
import { Modals } from './ui/shell/Modals';
import { handleEditorKey } from './ui/shell/shortcuts';
import { TitleBar } from './ui/shell/TitleBar';
import { initUpdates } from './ui/shell/updates';
import { Timeline } from './ui/timeline/Timeline';
import { useProjectStore } from './store/project';
import { t as tr, useT } from './ui/i18n';
import { CommandPalette } from './ui/palette/CommandPalette';
import { getSetting } from './ui/settings/store';
import { trackPaneFocus } from './ui/shell/panes';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function Editor(): ReactNode {
  const t = useT();
  const leftWidth = useUI((s) => s.leftWidth);
  const rightWidth = useUI((s) => s.rightWidth);
  const timelineHeight = useUI((s) => s.timelineHeight);
  const set = useUI((s) => s.set);
  // Each panel is a focusable landmark (F6 / Shift+F6 cycle between them, see shell/panes.ts).
  return (
    <div className="editor">
      <div className="editor__top">
        <section className="editor__pane editor__pane--library" data-pane="library" tabIndex={-1} aria-label={t('Library')}>
          <LibraryRail />
          <div className="editor__library" style={{ width: leftWidth }}>
            <LibraryPanel />
          </div>
        </section>
        <Resizer axis="x" onDrag={(d) => set({ leftWidth: clamp(useUI.getState().leftWidth + d, 280, 560) })} />
        <section className="editor__preview" data-pane="preview" tabIndex={-1} aria-label={t('Preview')}>
          <Preview />
        </section>
        <Resizer axis="x" onDrag={(d) => set({ rightWidth: clamp(useUI.getState().rightWidth - d, 280, 480) })} />
        <section className="editor__inspector" data-pane="inspector" tabIndex={-1} aria-label={t('Inspector')} style={{ width: rightWidth }}>
          <Inspector />
        </section>
      </div>
      <Resizer axis="y" onDrag={(d) => set({ timelineHeight: clamp(useUI.getState().timelineHeight - d, 170, Math.max(200, window.innerHeight - 320)) })} />
      <section className="editor__timeline" data-pane="timeline" tabIndex={-1} aria-label={t('Timeline')} style={{ height: timelineHeight }}>
        <Timeline />
      </section>
    </div>
  );
}

export function App(): ReactNode {
  const t = useT();
  const screen = useUI((s) => s.screen);
  const [fileDrag, setFileDrag] = useState(false);
  const dragDepth = useRef(0);

  // Shell integration: title / dirty flag / autosave, close confirmation, file associations.
  useEffect(() => {
    const stopSync = startDocumentSync();
    const stopUpdates = initUpdates();
    const offClose = api.app.onCloseRequested(() => {
      void confirmDiscard().then((ok) => {
        if (ok) void api.app.confirmClose();
      });
    });
    const offOpen = api.app.onOpenProject((path) => void openProject(path));
    void api.app.getStartupProject().then(async (path) => {
      if (path) {
        void openProject(path);
        return;
      }
      // Settings → General → "Reopen the last project".
      if ((await getSetting<string>('general.startup', 'home')) !== 'last') return;
      const [last] = await api.app.getRecent();
      if (last && useUI.getState().screen === 'home') void openProject(last.path);
    });
    return () => {
      stopSync();
      stopUpdates();
      offClose();
      offOpen();
    };
  }, []);

  useEffect(() => {
    // Every shortcut goes through the command registry and the user's keymap.
    const onKey = (e: KeyboardEvent): void => handleEditorKey(e);
    window.addEventListener('keydown', onKey);
    const stopPanes = trackPaneFocus();
    // Undo / redo can remove selected clips: keep the selection valid.
    const unsub = useProjectStore.subscribe(() => sanitizeSelection());
    return () => {
      window.removeEventListener('keydown', onKey);
      stopPanes();
      unsub();
    };
  }, []);

  // Files dragged in from Windows Explorer.
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setFileDrag(true);
    };
    const over = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setFileDrag(false);
    };
    const drop = async (e: DragEvent): Promise<void> => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setFileDrag(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const paths = files.map((f) => api.media.pathForFile(f)).filter(Boolean);
      if (paths.length === 0) return;
      const project = paths.find((p) => extOf(p) === PROJECT_EXT);
      if (project) {
        await openProject(project);
        return;
      }
      if (useUI.getState().screen !== 'editor') {
        useUI.getState().toast({ kind: 'info', message: tr('Create or open a project first'), detail: tr('Then drop your media into it.') });
        return;
      }
      const media = paths.filter((p) => MEDIA_EXTS.includes(extOf(p)));
      if (media.length === 0) {
        useUI.getState().toast({ kind: 'error', message: tr('Unsupported file type'), detail: tr('Kinora imports video, audio and image files.') });
        return;
      }
      const onTimeline = !!(e.target as HTMLElement | null)?.closest?.('[data-timeline], [data-preview]');
      useUI.getState().setLibraryTab('media');
      const assets = await importFiles(await api.fs.stat(media));
      if (onTimeline) for (const asset of assets) addAsset(asset);
    };
    const onDrop = (e: DragEvent): void => void drop(e);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="app" onContextMenu={(e) => e.preventDefault()}>
      <TitleBar />
      <main className="app__main">{screen === 'home' ? <Home /> : <Editor />}</main>
      <Modals />
      <CommandPalette />
      <MenuHost />
      <Toasts />
      <DragGhost />
      {fileDrag && (
        <div className="file-drop">
          <div className="file-drop__card">
            <Upload size={26} />
            <strong>{t('Drop to import')}</strong>
            <span>{t('Video, audio and images are added to your media. Drop on the timeline to place them right away.')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
