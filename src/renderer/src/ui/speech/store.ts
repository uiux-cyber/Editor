/**
 * Session state of the speech & audio tools: the running job (with progress and cancel), the
 * results waiting for review (silences, filler words), cached transcripts and the user's
 * preferences (persisted in the app settings under `speech.prefs`).
 */

import { create } from 'zustand';
import type { CaptionPosition } from '@/core/captionStyles';
import { DEFAULT_CAPTION_PRESET } from '@/core/captionStyles';
import type { FillerCandidate, TimeRange, TranscriptWord } from '@/core/speech';
import type { ID } from '@/core/types';
import type { DevicePref } from '@/engine/speech/transcriber';
import { api, hasBridge } from '@/platform/api';

export type JobKind = 'captions' | 'fillers' | 'silence' | 'beats' | 'denoise' | 'tts' | 'duck' | 'subtitles';

export interface Job {
  id: number;
  kind: JobKind;
  label: string;
  /** 0..1, or -1 while the amount of work is unknown. */
  ratio: number;
  detail?: string;
  controller: AbortController;
}

export type Scope = 'selection' | 'timeline';

export interface SpeechPrefs {
  language: string;
  device: DevicePref;
  captionPreset: string;
  captionPosition: CaptionPosition;
  maxChars: number | null;
  maxLines: number;
  replaceCaptions: boolean;
  /** Edits in the Captions tab apply to every caption. */
  applyToAll: boolean;
  silenceThreshold: number;
  silenceMin: number;
  silencePadding: number;
  denoiseStrength: number;
  ttsVoice: string;
  ttsRate: number;
  ttsCaptions: boolean;
  duckDepth: number;
  duckAttack: number;
  duckRelease: number;
  rippleAllTracks: boolean;
}

export const DEFAULT_PREFS: SpeechPrefs = {
  language: 'auto',
  device: 'auto',
  captionPreset: DEFAULT_CAPTION_PRESET,
  captionPosition: 'lower',
  maxChars: null,
  maxLines: 2,
  replaceCaptions: true,
  applyToAll: true,
  silenceThreshold: -40,
  silenceMin: 0.6,
  silencePadding: 0.12,
  denoiseStrength: 0.7,
  ttsVoice: '',
  ttsRate: 0,
  ttsCaptions: false,
  duckDepth: 12,
  duckAttack: 0.25,
  duckRelease: 0.6,
  rippleAllTracks: false,
};

export interface SilenceReview {
  ranges: TimeRange[];
  selected: boolean[];
  scope: Scope;
  /** Tracks that are cut together. */
  trackIds: ID[];
}

export interface FillerReview {
  words: TranscriptWord[];
  candidates: FillerCandidate[];
  selected: boolean[];
  scope: Scope;
  trackIds: ID[];
}

export interface TranscriptCacheEntry {
  key: string;
  words: TranscriptWord[];
  language: string;
}

interface SpeechState {
  job: Job | null;
  prefs: SpeechPrefs;
  silences: SilenceReview | null;
  fillers: FillerReview | null;
  transcripts: TranscriptCacheEntry[];
  /** Last transcription speed (for the status line). */
  lastRun: { device: string; seconds: number; audioSeconds: number; language: string } | null;
  setPrefs: (patch: Partial<SpeechPrefs>) => void;
  set: (patch: Partial<Omit<SpeechState, 'set' | 'setPrefs'>>) => void;
}

let saveTimer = 0;

export const useSpeech = create<SpeechState>()((set, get) => ({
  job: null,
  prefs: DEFAULT_PREFS,
  silences: null,
  fillers: null,
  transcripts: [],
  lastRun: null,
  setPrefs: (patch) => {
    set({ prefs: { ...get().prefs, ...patch } });
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (hasBridge) void api.settings.set('speech.prefs', get().prefs);
    }, 400);
  },
  set: (patch) => set(patch),
}));

if (hasBridge) {
  void api.settings
    .get<Partial<SpeechPrefs>>('speech.prefs')
    .then((saved) => {
      if (saved && typeof saved === 'object') useSpeech.setState({ prefs: { ...DEFAULT_PREFS, ...saved } });
    })
    .catch(() => undefined);
}

export const speechPrefs = (): SpeechPrefs => useSpeech.getState().prefs;
