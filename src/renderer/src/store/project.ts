import { produce } from 'immer';
import { create } from 'zustand';
import { createProject } from '@/core/project';
import type { Project } from '@/core/types';

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
  project: Project;
  /** Path of the .kinora file on disk, if the project has been saved. */
  filePath: string | null;
  /** The project instance at the last save; identity comparison drives the dirty flag. */
  savedRef: Project | null;
  past: Project[];
  future: Project[];
  /** Base snapshot of an in-progress drag / gesture. */
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
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  project: createProject({ width: 1920, height: 1080, fps: 30 }),
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
    if (s.txnBase || opts.history === false) {
      set({ project: next });
      return;
    }
    const now = performance.now();
    const merge = !!opts.coalesce && s.lastCoalesce?.key === opts.coalesce && now - s.lastCoalesce.at < COALESCE_MS && s.past.length > 0;
    const past = merge ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT);
    set({ project: next, past, future: [], lastCoalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null });
  },

  begin: () => {
    const s = get();
    if (!s.txnBase) set({ txnBase: s.project });
  },

  commit: () => {
    const s = get();
    if (!s.txnBase) return;
    if (s.txnBase === s.project) {
      set({ txnBase: null });
      return;
    }
    set({ past: [...s.past, s.txnBase].slice(-HISTORY_LIMIT), future: [], txnBase: null, lastCoalesce: null });
  },

  cancel: () => {
    const s = get();
    if (s.txnBase) set({ project: s.txnBase, txnBase: null });
  },

  undo: () => {
    const s = get();
    if (s.txnBase || s.past.length === 0) return;
    const previous = s.past[s.past.length - 1];
    set({ project: previous, past: s.past.slice(0, -1), future: [s.project, ...s.future].slice(0, HISTORY_LIMIT), lastCoalesce: null });
  },

  redo: () => {
    const s = get();
    if (s.txnBase || s.future.length === 0) return;
    const next = s.future[0];
    set({ project: next, past: [...s.past, s.project].slice(-HISTORY_LIMIT), future: s.future.slice(1), lastCoalesce: null });
  },

  markSaved: (filePath) => set((s) => ({ filePath, savedRef: s.project })),
}));

export const getProject = (): Project => useProjectStore.getState().project;
export const updateProject = (recipe: (draft: Project) => void, opts?: UpdateOptions): void => useProjectStore.getState().update(recipe, opts);
export const isDirty = (): boolean => {
  const s = useProjectStore.getState();
  return s.project !== s.savedRef && (Object.keys(s.project.clips).length > 0 || Object.keys(s.project.assets).length > 0 || s.savedRef !== null);
};
