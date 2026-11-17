/**
 * Diagnostics handle for the colour & audio area (used by scripts/e2e/color-audio.mjs), next to
 * the app-wide `window.__kinora` handle.
 */

import * as compressor from '@/core/audiofx/compressor';
import * as eq from '@/core/audiofx/eq';
import * as curves from '@/core/color/curves';
import * as wheels from '@/core/color/wheels';
import { compressorReduction } from '@/engine/audio/ext/compressor';
import * as lutStore from '@/engine/color/lutStore';
import { frameTap } from '@/engine/scopes/frameTap';
import { useColorAudioPrefs } from './prefs';

(window as unknown as Record<string, unknown>).__kinoraColorAudio = { compressor, eq, curves, wheels, compressorReduction, lutStore, frameTap, prefs: useColorAudioPrefs };
