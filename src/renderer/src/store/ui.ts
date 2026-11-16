import { create } from 'zustand';
import type { Clip, ID } from '@/core/types';

export type Screen = 'home' | 'editor';
export type LibraryTab = 'media' | 'templates' | 'text' | 'stickers' | 'transitions' | 'effects' | 'filters' | 'audio' | 'elements';
export type Tool = 'select' | 'blade';
export type ModalId = 'export' | 'newProject' | 'shortcuts' | 'settings' | 'projectSettings' | null;

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'warning';
  message: string;
  detail?: string;
  action?: { label: string; run: () => void };
  /** ms; 0 = sticky */
  timeout: number;
}

export interface ClipboardData {
  clips: Clip[];
  trackOrder: ID[];
}

interface UIState {
  screen: Screen;
  libraryTab: LibraryTab;
  selection: ID[];
  selectedTransition: ID | null;
  tool: Tool;
  snapping: boolean;
  /** Timeline zoom in pixels per second. */
  pxPerSec: number;
  /** Preview render scale (1 = full project resolution). */
  previewQuality: number;
  safeZones: boolean;
  loop: boolean;
  modal: ModalId;
  toasts: Toast[];
  clipboard: ClipboardData | null;
  leftWidth: number;
  rightWidth: number;
  timelineHeight: number;
  masterVolume: number;
  /** Text clip currently being edited inline on the canvas. */
  editingText: ID | null;

  setScreen: (screen: Screen) => void;
  setLibraryTab: (tab: LibraryTab) => void;
  select: (ids: ID[]) => void;
  toggleSelect: (id: ID) => void;
  addToSelection: (ids: ID[]) => void;
  clearSelection: () => void;
  selectTransition: (id: ID | null) => void;
  setTool: (tool: Tool) => void;
  set: (patch: Partial<UIState>) => void;
  openModal: (modal: ModalId) => void;
  toast: (toast: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }) => number;
  dismissToast: (id: number) => void;
}

let toastId = 1;

export const useUI = create<UIState>()((set, get) => ({
  screen: 'home',
  libraryTab: 'media',
  selection: [],
  selectedTransition: null,
  tool: 'select',
  snapping: true,
  pxPerSec: 80,
  previewQuality: 1,
  safeZones: false,
  loop: false,
  modal: null,
  toasts: [],
  clipboard: null,
  leftWidth: 380,
  rightWidth: 320,
  timelineHeight: 320,
  masterVolume: 1,
  editingText: null,

  setScreen: (screen) => set({ screen }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  select: (ids) => set({ selection: ids, selectedTransition: null }),
  toggleSelect: (id) => {
    const sel = get().selection;
    set({ selection: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id], selectedTransition: null });
  },
  addToSelection: (ids) => {
    const sel = new Set(get().selection);
    ids.forEach((id) => sel.add(id));
    set({ selection: [...sel], selectedTransition: null });
  },
  clearSelection: () => {
    const s = get();
    if (s.selection.length || s.selectedTransition) set({ selection: [], selectedTransition: null });
  },
  selectTransition: (id) => set({ selectedTransition: id, selection: [] }),
  setTool: (tool) => set({ tool }),
  set: (patch) => set(patch),
  openModal: (modal) => set({ modal }),
  toast: (t) => {
    const id = toastId++;
    const toast: Toast = { timeout: t.kind === 'error' ? 8000 : 4000, ...t, id };
    set({ toasts: [...get().toasts.slice(-4), toast] });
    if (toast.timeout > 0) setTimeout(() => get().dismissToast(id), toast.timeout);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (kind: Toast['kind'], message: string, detail?: string): number => useUI.getState().toast({ kind, message, detail });
