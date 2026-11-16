import { produce } from 'immer';
import { create } from 'zustand';
import { commitView, resolveEditPath } from '@/core/compound';
import { createProject } from '@/core/project';
import type { ID, Project } from '@/core/types';

const HISTORY_LIMIT = 200;
const COALESCE_MS = 900;

export interface UpdateOptions {
  /** Push an undo step (default true). Ignored inside a transaction. */
  history?: boolean;
  /**
   * Consecutive updates with the same key within a short window collapse into one undo step —
   * use for sliders and text fields.
   */
  coalesce?: string;
}

interface ProjectState {
  /**
   * The timeline being edited: the document itself, or — while a compound clip is open — a view
   * of its nested sequence (same settings and assets). Every editing surface (timeline, inspector,
   * preview) works on this; `update` writes changes back into the document.
   */
  project: Project;
  /** The document (what is saved, autosaved and exported). Same object as `project` at the top level. */
  root: Project;
  /** Compound clips opened for editing, outermost first ([] = editing the document itself). */
  editPath: ID[];
  /** Path of the .kinora file on disk, if the project has been saved. */
  filePath: string | null;
  /** The document instance at the last save; identity comparison drives the dirty flag. */
  savedRef: Project | null;
  /** Undo / redo snapshots of the document (`root`). */
  past: Project[];
  future: Project[];
  /** Base snapshot (document) of an in-progress drag / gesture. */
  txnBase: Project | null;
  lastCoalesce: { key: string; at: number } | null;
  /** Bumped whenever a different document is loaded. */
  docVersion: number;

  load: (project: Project, filePath: string | null, saved?: boolean) => void;
  update: (recipe: (draft: Project) => void, opts?: UpdateOptions) => void;
  /** Start a gesture: following updates are live but produce a single undo step on commit. */
  begin: () => void;
  commit: () => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: (filePath: string | null) => void;
  /** Open (or close, with a shorter path) compound clips for editing. Not an undo step. */
  setEditPath: (path: ID[]) => void;
}

/** View + valid path for a document and a requested edit path. */
function viewOf(root: Project, path: ID[]): { project: Project; editPath: ID[] } {
  if (path.length === 0) return { project: root, editPath: path };
  const r = resolveEditPath(root, path);
  return { project: r.view, editPath: r.path };
}

const initial = createProject({ width: 1920, height: 1080, fps: 30 });

export const useProjectStore = create<ProjectState>()((set, get) => ({
  project: initial,
  root: initial,
  editPath: [],
  filePath: null,
  savedRef: null,
  past: [],
  future: [],
  txnBase: null,
  lastCoalesce: null,
  docVersion: 0,

  load: (project, filePath, saved = true) =>
    set((s) => ({
      project,
      root: project,
      editPath: [],
      filePath,
      savedRef: saved ? project : null,
      past: [],
      future: [],
      txnBase: null,
      lastCoalesce: null,
      docVersion: s.docVersion + 1,
    })),

  update: (recipe, opts = {}) => {
    const s = get();
    const next = produce(s.project, recipe);
    if (next === s.project) return;
    // Inside a compound clip the edited sequence is written back into the document.
    const root = s.editPath.length ? commitView(s.root, s.editPath, next) : next;
    if (s.txnBase || opts.history === false) {
      set({ project: next, root });
      return;
    }
    const now = performance.now();
    const merge = !!opts.coalesce && s.lastCoalesce?.key === opts.coalesce && now - s.lastCoalesce.at < COALESCE_MS && s.past.length > 0;
    const past = merge ? s.past : [...s.past, s.root].slice(-HISTORY_LIMIT);
    set({ project: next, root, past, future: [], lastCoalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null });
  },

  begin: () => {
    const s = get();
    if (!s.txnBase) set({ txnBase: s.root });
  },

  commit: () => {
    const s = get();
    if (!s.txnBase) return;
    if (s.txnBase === s.root) {
      set({ txnBase: null });
      return;
    }
    set({ past: [...s.past, s.txnBase].slice(-HISTORY_LIMIT), future: [], txnBase: null, lastCoalesce: null });
  },

  cancel: () => {
    const s = get();
    if (s.txnBase) set({ root: s.txnBase, ...viewOf(s.txnBase, s.editPath), txnBase: null });
  },

  undo: () => {
    const s = get();
    if (s.txnBase || s.past.length === 0) return;
    const previous = s.past[s.past.length - 1];
    set({ root: previous, ...viewOf(previous, s.editPath), past: s.past.slice(0, -1), future: [s.root, ...s.future].slice(0, HISTORY_LIMIT), lastCoalesce: null });
  },

  redo: () => {
    const s = get();
    if (s.txnBase || s.future.length === 0) return;
    const next = s.future[0];
    set({ root: next, ...viewOf(next, s.editPath), past: [...s.past, s.root].slice(-HISTORY_LIMIT), future: s.future.slice(1), lastCoalesce: null });
  },

  markSaved: (filePath) => set((s) => ({ filePath, savedRef: s.root })),

  setEditPath: (path) => {
    const s = get();
    if (s.txnBase) return;
    set(viewOf(s.root, path));
  },
}));

/** The timeline being edited (the document, or an open compound clip's sequence). */
export const getProject = (): Project => useProjectStore.getState().project;
/** The document itself, whatever is open for editing. */
export const getRootProject = (): Project => useProjectStore.getState().root;
export const updateProject = (recipe: (draft: Project) => void, opts?: UpdateOptions): void => useProjectStore.getState().update(recipe, opts);
export const isDirty = (): boolean => {
  const s = useProjectStore.getState();
  return s.root !== s.savedRef && (Object.keys(s.root.clips).length > 0 || Object.keys(s.root.assets).length > 0 || s.savedRef !== null);
};
