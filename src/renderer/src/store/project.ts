import { produce } from 'immer';
import { create } from 'zustand';
import { commitView, resolveEditPath } from '@/core/compound';
import { packMainTrack } from '@/core/editing';
import { createProject } from '@/core/project';
import type { ID, Project } from '@/core/types';
import { describeChange } from './historyLabels';

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
  /**
   * Name of the undo step in the History panel, e.g. "Split clip". When omitted a name is
   * derived from what changed. Inside a transaction it names the whole gesture.
   */
  label?: string;
}

/** One undo step: `label` describes the change that led to the next state. */
export interface HistoryEntry {
  label: string;
  /** `Date.now()` when the step was made. */
  at: number;
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
  /** `pastMeta[i]` names the step from `past[i]` to the state after it (aligned with `past`). */
  pastMeta: HistoryEntry[];
  /** `futureMeta[i]` names the step that leads to `future[i]` (aligned with `future`). */
  futureMeta: HistoryEntry[];
  /** Base snapshot (document) of an in-progress drag / gesture. */
  txnBase: Project | null;
  /** The edited view at the start of the gesture (equals `txnBase` at the top level). */
  txnView: Project | null;
  /** Label given to the gesture in progress (by `begin` or a labelled update inside it). */
  txnLabel: string | null;
  lastCoalesce: { key: string; at: number } | null;
  /** Bumped whenever a different document is loaded. */
  docVersion: number;

  load: (project: Project, filePath: string | null, saved?: boolean) => void;
  update: (recipe: (draft: Project) => void, opts?: UpdateOptions) => void;
  /**
   * During a gesture, rebuild the live project from the gesture's starting snapshot instead of
   * the current state (outside a gesture this is a plain `update`). Edits that are easier to
   * express as "base + delta" (ripple, roll, magnetic inserts) use this on every pointer move.
   */
  updateFromBase: (recipe: (draft: Project) => void, opts?: UpdateOptions) => void;
  /** Start a gesture: following updates are live but produce a single undo step on commit. */
  begin: (label?: string) => void;
  commit: (label?: string) => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;
  /** Jump to a state in the history list: 0 = oldest kept state, `past.length` = current. */
  goTo: (index: number) => void;
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

/**
 * Every change goes through here so derived invariants (the magnetic main track) always hold.
 * The magnetic main track belongs to the document's own timeline, so it is not applied inside
 * an open compound clip.
 */
function apply(base: Project, recipe: (draft: Project) => void, nested: boolean): Project {
  return produce(base, (draft) => {
    recipe(draft);
    if (!nested) packMainTrack(draft);
  });
}

/** Write an edited view back into the document (`base`, by default the current one). */
const rootFor = (s: Pick<ProjectState, 'root' | 'editPath'>, view: Project, base: Project = s.root): Project => (s.editPath.length ? commitView(base, s.editPath, view) : view);

const entry = (label: string): HistoryEntry => ({ label, at: Date.now() });

const initial = createProject({ width: 1920, height: 1080, fps: 30 });

export const useProjectStore = create<ProjectState>()((set, get) => ({
  project: initial,
  root: initial,
  editPath: [],
  filePath: null,
  savedRef: null,
  past: [],
  future: [],
  pastMeta: [],
  futureMeta: [],
  txnBase: null,
  txnView: null,
  txnLabel: null,
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
      pastMeta: [],
      futureMeta: [],
      txnBase: null,
      txnView: null,
      txnLabel: null,
      lastCoalesce: null,
      docVersion: s.docVersion + 1,
    })),

  update: (recipe, opts = {}) => {
    const s = get();
    const next = apply(s.project, recipe, s.editPath.length > 0);
    if (next === s.project) return;
    // Inside a compound clip the edited sequence is written back into the document.
    const root = rootFor(s, next);
    if (s.txnBase) {
      set(opts.label && !s.txnLabel ? { project: next, root, txnLabel: opts.label } : { project: next, root });
      return;
    }
    if (opts.history === false) {
      set({ project: next, root });
      return;
    }
    const now = performance.now();
    const merge = !!opts.coalesce && s.lastCoalesce?.key === opts.coalesce && now - s.lastCoalesce.at < COALESCE_MS && s.past.length > 0;
    if (merge) {
      const meta = s.pastMeta.slice();
      const last = meta[meta.length - 1];
      if (last) meta[meta.length - 1] = { ...last, at: Date.now() };
      set({ project: next, root, pastMeta: meta, future: [], futureMeta: [], lastCoalesce: { key: opts.coalesce!, at: now } });
      return;
    }
    set({
      project: next,
      root,
      past: [...s.past, s.root].slice(-HISTORY_LIMIT),
      pastMeta: [...s.pastMeta, entry(opts.label ?? describeChange(s.project, next))].slice(-HISTORY_LIMIT),
      future: [],
      futureMeta: [],
      lastCoalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null,
    });
  },

  updateFromBase: (recipe, opts = {}) => {
    const s = get();
    if (!s.txnBase || !s.txnView) {
      s.update(recipe, opts);
      return;
    }
    const next = apply(s.txnView, recipe, s.editPath.length > 0);
    if (next === s.project) return;
    const root = rootFor(s, next, s.txnBase);
    set(opts.label && !s.txnLabel ? { project: next, root, txnLabel: opts.label } : { project: next, root });
  },

  begin: (label) => {
    const s = get();
    if (!s.txnBase) set({ txnBase: s.root, txnView: s.project, txnLabel: label ?? null });
  },

  commit: (label) => {
    const s = get();
    if (!s.txnBase) return;
    if (s.txnBase === s.root) {
      set({ txnBase: null, txnView: null, txnLabel: null });
      return;
    }
    set({
      past: [...s.past, s.txnBase].slice(-HISTORY_LIMIT),
      pastMeta: [...s.pastMeta, entry(label ?? s.txnLabel ?? describeChange(s.txnView, s.project))].slice(-HISTORY_LIMIT),
      future: [],
      futureMeta: [],
      txnBase: null,
      txnView: null,
      txnLabel: null,
      lastCoalesce: null,
    });
  },

  cancel: () => {
    const s = get();
    if (s.txnBase) set({ root: s.txnBase, ...viewOf(s.txnBase, s.editPath), txnBase: null, txnView: null, txnLabel: null });
  },

  undo: () => {
    const s = get();
    if (s.txnBase || s.past.length === 0) return;
    s.goTo(s.past.length - 1);
  },

  redo: () => {
    const s = get();
    if (s.txnBase || s.future.length === 0) return;
    s.goTo(s.past.length + 1);
  },

  goTo: (index) => {
    const s = get();
    const states = [...s.past, s.root, ...s.future];
    // metas[i] names the step from states[i] to states[i + 1].
    const metas = [...s.pastMeta, ...s.futureMeta];
    const target = Math.round(index);
    if (s.txnBase || target < 0 || target >= states.length || target === s.past.length) return;
    // Pad metadata defensively so the arrays always stay aligned with the states.
    while (metas.length < states.length - 1) metas.push(entry('Edit'));
    const root = states[target];
    set({
      root,
      ...viewOf(root, s.editPath),
      past: states.slice(0, target),
      pastMeta: metas.slice(0, target),
      future: states.slice(target + 1, target + 1 + HISTORY_LIMIT),
      futureMeta: metas.slice(target, target + HISTORY_LIMIT),
      lastCoalesce: null,
    });
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
