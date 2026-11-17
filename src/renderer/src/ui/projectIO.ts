/**
 * Document lifecycle: new / open / save / autosave / recover, and the unsaved-changes prompts.
 */

import { createProject, designSize, insertTemplateLayers, parseProjectFile, projectDuration, serializeProject, type NewProjectOptions } from '@/core/project';
import type { Project } from '@/core/types';
import { engine } from '@/engine/engine';
import { prepareProjectAssets } from '@/engine/media/assets';
import { buildTemplate, type TemplateVariation } from '@/library/templateEngine';
import { api } from '@/platform/api';
import { isDirty, useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { t } from './i18n';
import { getSetting } from './settings/store';
import type { AutosaveEntry } from '@shared/ipc';

const baseName = (path: string): string => path.replace(/^.*[\\/]/, '').replace(/\.kinora$/i, '');

function enterEditor(): void {
  const ui = useUI.getState();
  ui.set({ screen: 'editor', selection: [], selectedTransition: null, modal: null, tool: 'select' });
}

/** Small JPEG of the current frame for the recent-projects list. */
async function captureThumbnail(): Promise<string | undefined> {
  try {
    const blob = await engine.snapshot();
    if (!blob) return undefined;
    const bitmap = await createImageBitmap(blob);
    const k = Math.min(1, 360 / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}

async function remember(path: string, project: Project): Promise<void> {
  await api.app.addRecent({
    path,
    name: project.name,
    openedAt: Date.now(),
    width: project.settings.width,
    height: project.settings.height,
    duration: projectDuration(project),
    thumbnail: await captureThumbnail(),
  });
}

/**
 * If there are unsaved changes, ask what to do. Resolves true when it is safe to replace or
 * close the current document.
 */
export async function confirmDiscard(): Promise<boolean> {
  if (useUI.getState().screen !== 'editor' || !isDirty()) return true;
  const { project } = useProjectStore.getState();
  const choice = await api.dialog.message({
    type: 'question',
    title: t('Unsaved changes'),
    message: t('Save changes to “{name}”?', { name: project.name }),
    detail: t('Your changes will be lost if you don’t save them.'),
    buttons: [t('Save'), t('Don’t save'), t('Cancel')],
  });
  if (choice === 2) return false;
  if (choice === 0) return saveProject();
  await api.autosave.remove(project.id).catch(() => undefined);
  return true;
}

async function load(project: Project, path: string | null, saved: boolean): Promise<void> {
  engine.pause();
  useProjectStore.getState().load(project, path, saved);
  enterEditor();
  const { missing } = await prepareProjectAssets(project);
  if (missing.length > 0) {
    useUI.getState().toast({
      kind: 'warning',
      message: missing.length === 1 ? t('“{name}” could not be found', { name: missing[0].name }) : t('{count, plural, one {# media file could not be found} other {# media files could not be found}}', { count: missing.length }),
      detail: t('Right-click the file in the Media tab and choose Relink to point Kinora at its new location.'),
      timeout: 12000,
    });
    useUI.getState().setLibraryTab('media');
  }
}

export async function newProject(opts: NewProjectOptions, template?: TemplateVariation): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  const project = createProject(opts);
  if (template) {
    const { cw, ch } = designSize(project.settings);
    const built = buildTemplate(template, cw, ch);
    if (built) {
      insertTemplateLayers(project, built.clips, 0, project.settings.fps);
      if (!opts.name) project.name = built.def.name;
    }
  }
  await load(project, null, !template);
  return true;
}

/**
 * Open a project file (asks for one when `path` is omitted). `force` skips the unsaved-changes
 * prompt — used after Collect project, whose copy already contains the current state.
 */
export async function openProject(path?: string, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!opts.force && !(await confirmDiscard())) return false;
  const target = path ?? (await api.dialog.openProject());
  if (!target) return false;
  try {
    // Media inside the project's folder is stored relative to the project file.
    const project = parseProjectFile(await api.fs.readProject(target), { projectPath: target });
    await load(project, target, true);
    void remember(target, project);
    return true;
  } catch (err) {
    toast('error', t('Could not open the project'), (err as Error).message);
    return false;
  }
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const store = useProjectStore.getState();
  let path = store.filePath;
  if (!path || saveAs) {
    path = await api.dialog.saveProject(store.project.name);
    if (!path) return false;
  }
  try {
    // A project saved under a new file name takes that name unless it was renamed by hand.
    if ((!store.filePath || saveAs) && /^Untitled project$/i.test(store.project.name)) {
      store.update((p) => void (p.name = baseName(path!)), { history: false });
    }
    const project = useProjectStore.getState().project;
    await api.fs.writeProject(path, serializeProject(project, { projectPath: path }));
    useProjectStore.getState().markSaved(path);
    await api.autosave.remove(project.id).catch(() => undefined);
    void remember(path, project);
    toast('success', t('Project saved'));
    return true;
  } catch (err) {
    toast('error', t('Could not save the project'), (err as Error).message);
    return false;
  }
}

export async function closeProject(): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  engine.pause();
  useUI.getState().set({ screen: 'home', selection: [], selectedTransition: null, modal: null });
  return true;
}

export async function recoverAutosave(entry: AutosaveEntry): Promise<boolean> {
  const data = await api.autosave.read(entry.id);
  if (!data) {
    toast('error', t('This recovery file is no longer available'));
    return false;
  }
  try {
    const project = parseProjectFile(data, { projectPath: entry.path });
    await load(project, entry.path, false);
    toast('info', t('Recovered unsaved work'), t('Save the project to keep these changes.'));
    return true;
  } catch (err) {
    toast('error', t('The recovery file is damaged'), (err as Error).message);
    return false;
  }
}

/**
 * Keep the shell informed (title, dirty flag) and write a recovery copy while there are unsaved
 * changes. Returns a disposer.
 */
export function startDocumentSync(): () => void {
  let lastAutosaved: Project | null = null;
  const sync = (): void => {
    const { project } = useProjectStore.getState();
    const editing = useUI.getState().screen === 'editor';
    const dirty = editing && isDirty();
    void api.app.setDirty(dirty);
    void api.app.setTitle(editing ? `${project.name}${dirty ? ' •' : ''} — Kinora` : 'Kinora');
  };
  const unsubA = useProjectStore.subscribe(sync);
  const unsubB = useUI.subscribe((s, prev) => s.screen !== prev.screen && sync());
  sync();

  // Settings → General → Autosave interval (seconds; 0 = off). Checked every 5 s so a change
  // applies without a restart.
  let lastWrite = Date.now();
  const timer = window.setInterval(() => {
    void getSetting<number>('general.autosaveSeconds', 15).then((seconds) => {
      const { project, filePath, txnBase } = useProjectStore.getState();
      if (!(seconds > 0) || Date.now() - lastWrite < seconds * 1000 - 500) return;
      if (useUI.getState().screen !== 'editor' || txnBase || !isDirty() || project === lastAutosaved) return;
      lastAutosaved = project;
      lastWrite = Date.now();
      void api.autosave.write(project.id, project.name, filePath, serializeProject(project)).catch((err) => console.warn('[autosave] failed', err));
    });
  }, 5000);

  return () => {
    unsubA();
    unsubB();
    window.clearInterval(timer);
  };
}
