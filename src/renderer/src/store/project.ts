import { produce } from 'immer';
import { create } from 'zustand';
import { packMainTrack } from '@/core/editing';
import { createProject } from '@/core/project';
import type { Project } from '@/core/types';
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
  project: Project;
  /** Path of the .kinora file on disk, if the project has been saved. */
  filePath: string | null;
  /** The project instance at the last save; identity comparison drives the dirty flag. */
  savedRef: Project | null;
  past: Project[];
  future: Project[];
  /** `pastMeta[i]` names the step from `past[i]` to the state after it (aligned with `past`). */
  pastMeta: HistoryEntry[];
  /** `futureMeta[i]` names the step that leads to `future[i]` (aligned with `future`). */
  futureMeta: HistoryEntry[];
  /** Base snapshot of an in-progress drag / gesture. */
  txnBase: Project | null;
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
}

/** Every change goes through here so derived invariants (the magnetic main track) always hold. */
function apply(base: Project, recipe: (draft: Project) => void): Project {
  return produce(base, (draft) => {
    recipe(draft);
    packMainTrack(draft);
  });
}

const entry = (label: string): HistoryEntry => ({ label, at: Date.now() });

export const useProjectStore = create<ProjectState>()((set, get) => ({
  project: createProject({ width: 1920, height: 1080, fps: 30 }),
  filePath: null,
  savedRef: null,
  past: [],
  future: [],
  pastMeta: [],
  futureMeta: [],
  txnBase: null,
  txnLabel: null,
  lastCoalesce: null,
  docVersion: 0,

  load: (project, filePath, saved = true) =>
    set((s) => ({
      project,
      filePath,
      savedRef: saved ? project : null,
      past: [],
      future: [],
      pastMeta: [],
      futureMeta: [],
      txnBase: null,
      txnLabel: null,
      lastCoalesce: null,
      docVersion: s.docVersion + 1,
    })),

  update: (recipe, opts = {}) => {
    const s = get();
    const next = apply(s.project, recipe);
    if (next === s.project) return;
    if (s.txnBase) {
      set(opts.label && !s.txnLabel ? { project: next, txnLabel: opts.label } : { project: next });
      return;
    }
    if (opts.history === false) {
      set({ project: next });
      return;
    }
    const now = performance.now();
    const merge = !!opts.coalesce && s.lastCoalesce?.key === opts.coalesce && now - s.lastCoalesce.at < COALESCE_MS && s.past.length > 0;
    if (merge) {
      const meta = s.pastMeta.slice();
      const last = meta[meta.length - 1];
      if (last) meta[meta.length - 1] = { ...last, at: Date.now() };
      set({ project: next, pastMeta: meta, future: [], futureMeta: [], lastCoalesce: { key: opts.coalesce!, at: now } });
      return;
    }
    set({
      project: next,
      past: [...s.past, s.project].slice(-HISTORY_LIMIT),
      pastMeta: [...s.pastMeta, entry(opts.label ?? describeChange(s.project, next))].slice(-HISTORY_LIMIT),
      future: [],
      futureMeta: [],
      lastCoalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null,
    });
  },

  updateFromBase: (recipe, opts = {}) => {
    const s = get();
    if (!s.txnBase) {
      s.update(recipe, opts);
      return;
    }
    const next = apply(s.txnBase, recipe);
    if (next === s.project) return;
    set(opts.label && !s.txnLabel ? { project: next, txnLabel: opts.label } : { project: next });
  },

  begin: (label) => {
    const s = get();
    if (!s.txnBase) set({ txnBase: s.project, txnLabel: label ?? null });
  },

  commit: (label) => {
    const s = get();
    if (!s.txnBase) return;
    if (s.txnBase === s.project) {
      set({ txnBase: null, txnLabel: null });
      return;
    }
    set({
      past: [...s.past, s.txnBase].slice(-HISTORY_LIMIT),
      pastMeta: [...s.pastMeta, entry(label ?? s.txnLabel ?? describeChange(s.txnBase, s.project))].slice(-HISTORY_LIMIT),
      future: [],
      futureMeta: [],
      txnBase: null,
      txnLabel: null,
      lastCoalesce: null,
    });
  },

  cancel: () => {
    const s = get();
    if (s.txnBase) set({ project: s.txnBase, txnBase: null, txnLabel: null });
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
    const states = [...s.past, s.project, ...s.future];
    // metas[i] names the step from states[i] to states[i + 1].
    const metas = [...s.pastMeta, ...s.futureMeta];
    const target = Math.round(index);
    if (s.txnBase || target < 0 || target >= states.length || target === s.past.length) return;
    // Pad metadata defensively so the arrays always stay aligned with the states.
    while (metas.length < states.length - 1) metas.push(entry('Edit'));
    set({
      project: states[target],
      past: states.slice(0, target),
      pastMeta: metas.slice(0, target),
      future: states.slice(target + 1, target + 1 + HISTORY_LIMIT),
      futureMeta: metas.slice(target, target + HISTORY_LIMIT),
      lastCoalesce: null,
    });
  },

  markSaved: (filePath) => set((s) => ({ filePath, savedRef: s.project })),
}));

export const getProject = (): Project => useProjectStore.getState().project;
export const updateProject = (recipe: (draft: Project) => void, opts?: UpdateOptions): void => useProjectStore.getState().update(recipe, opts);
export const isDirty = (): boolean => {
  const s = useProjectStore.getState();
  return s.project !== s.savedRef && (Object.keys(s.project.clips).length > 0 || Object.keys(s.project.assets).length > 0 || s.savedRef !== null);
};
