/** UI preferences of the colour & audio area (scopes dock, last tab of the curves editor). */

import { create } from 'zustand';

export type ScopeMode = 'waveform' | 'parade' | 'vector' | 'histogram' | 'quad';

interface ColorAudioPrefs {
  scopesOpen: boolean;
  scopeMode: ScopeMode;
  /** Width of the scopes dock in CSS px. */
  scopesWidth: number;
  /** Vectorscope magnification (1 or 2). */
  vectorZoom: 1 | 2;
  curveChannel: 'master' | 'r' | 'g' | 'b';
  set: (patch: Partial<Omit<ColorAudioPrefs, 'set'>>) => void;
}

const KEY = 'kinora.colorAudio.prefs';

function load(): Partial<ColorAudioPrefs> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<ColorAudioPrefs>) : {};
  } catch {
    return {};
  }
}

const saved = load();
const MODES: ScopeMode[] = ['waveform', 'parade', 'vector', 'histogram', 'quad'];

export const useColorAudioPrefs = create<ColorAudioPrefs>()((set, get) => ({
  scopesOpen: false,
  scopeMode: MODES.includes(saved.scopeMode as ScopeMode) ? (saved.scopeMode as ScopeMode) : 'quad',
  scopesWidth: typeof saved.scopesWidth === 'number' ? Math.min(720, Math.max(240, saved.scopesWidth)) : 340,
  vectorZoom: saved.vectorZoom === 2 ? 2 : 1,
  curveChannel: 'master',
  set: (patch) => {
    set(patch);
    const s = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ scopeMode: s.scopeMode, scopesWidth: s.scopesWidth, vectorZoom: s.vectorZoom }));
    } catch {
      /* storage unavailable */
    }
  },
}));

export const toggleScopes = (): void => {
  const s = useColorAudioPrefs.getState();
  s.set({ scopesOpen: !s.scopesOpen });
};
