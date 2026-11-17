import { create } from 'zustand';
import { setKeyboardBlocker } from '../commands/dispatch';

interface PaletteState {
  open: boolean;
  /** Text the palette opens with (e.g. '>' for commands only). */
  initial: string;
  /** Keys of recently run items, most recent first. */
  recent: string[];
}

const RECENT_KEY = 'palette.recent';
const MAX_RECENT = 20;

export const usePalette = create<PaletteState>()(() => ({ open: false, initial: '', recent: [] }));

export function openPalette(initial = ''): void {
  setKeyboardBlocker('palette', true);
  usePalette.setState({ open: true, initial });
}

export function closePalette(): void {
  setKeyboardBlocker('palette', false);
  usePalette.setState({ open: false });
}

export function togglePalette(): void {
  if (usePalette.getState().open) closePalette();
  else openPalette();
}

export function rememberPaletteItem(key: string): void {
  const recent = [key, ...usePalette.getState().recent.filter((k) => k !== key)].slice(0, MAX_RECENT);
  usePalette.setState({ recent });
  void window.kinora?.settings.set(RECENT_KEY, recent);
}

export async function initPalette(): Promise<void> {
  try {
    const saved = await window.kinora?.settings.get<string[]>(RECENT_KEY);
    if (Array.isArray(saved)) usePalette.setState({ recent: saved.filter((k) => typeof k === 'string').slice(0, MAX_RECENT) });
  } catch {
    /* none yet */
  }
}
