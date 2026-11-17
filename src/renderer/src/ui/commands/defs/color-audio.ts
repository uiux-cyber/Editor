/** Colour grading and audio mixing commands (palette / menus / shortcuts). */

import { COMPRESSOR_PRESETS } from '@/core/audiofx/compressor';
import { EQ_PRESETS } from '@/core/audiofx/eq';
import { identityCurves } from '@/core/color/curves';
import type { Clip, ID } from '@/core/types';
import { getProject } from '@/store/project';
import { useUI } from '@/store/ui';
import type { Command } from '../index';
import { setCompressor } from '../../coloraudio/CompressorEditor';
import { setEq } from '../../coloraudio/EqEditor';
import { resetWheels, setCurves, setLut } from '../../coloraudio/gradeEdit';
import { importLutsWithFeedback } from '../../coloraudio/LutPanel';
import { toggleScopes, useColorAudioPrefs } from '../../coloraudio/prefs';

const selected = (): Clip[] => {
  const p = getProject();
  return useUI
    .getState()
    .selection.map((id) => p.clips[id])
    .filter(Boolean);
};
const visualIds = (): ID[] => selected().filter((c) => c.type !== 'audio').map((c) => c.id);
const soundIds = (): ID[] => {
  const p = getProject();
  return selected()
    .filter((c) => (c.type === 'video' || c.type === 'audio') && !!p.assets[c.assetId]?.hasAudio)
    .map((c) => c.id);
};
const hasVisual = (): boolean => visualIds().length > 0;
const hasSound = (): boolean => soundIds().length > 0;

const commands: Command[] = [
  {
    id: 'view.toggleScopes',
    title: 'Show / hide video scopes',
    group: 'View',
    keywords: ['waveform', 'vectorscope', 'parade', 'histogram', 'scopes'],
    shortcut: 'Ctrl+Shift+W',
    run: toggleScopes,
  },
  ...(['quad', 'waveform', 'parade', 'vector', 'histogram'] as const).map(
    (mode): Command => ({
      id: `view.scopes.${mode}`,
      title: `Scopes: ${{ quad: 'all four', waveform: 'luma waveform', parade: 'RGB parade', vector: 'vectorscope', histogram: 'histogram' }[mode]}`,
      group: 'View',
      keywords: ['scopes'],
      run: () => useColorAudioPrefs.getState().set({ scopesOpen: true, scopeMode: mode }),
    }),
  ),
  {
    id: 'color.importLut',
    title: 'Import LUT (.cube)…',
    group: 'Color',
    keywords: ['lut', 'cube', 'look', 'grade'],
    run: () => importLutsWithFeedback(visualIds()),
  },
  {
    id: 'color.removeLut',
    title: 'Remove LUT from selection',
    group: 'Color',
    keywords: ['lut'],
    when: () => selected().some((c) => c.type !== 'audio' && !!c.lut),
    run: () => setLut(visualIds(), null),
  },
  {
    id: 'color.resetCurves',
    title: 'Reset curves',
    group: 'Color',
    keywords: ['curves', 'tone'],
    when: hasVisual,
    run: () => setCurves(visualIds(), identityCurves()),
  },
  {
    id: 'color.resetWheels',
    title: 'Reset colour wheels',
    group: 'Color',
    keywords: ['lift', 'gamma', 'gain', 'offset', 'wheels'],
    when: hasVisual,
    run: () => resetWheels(visualIds()),
  },
  {
    id: 'audio.resetEq',
    title: 'Remove EQ',
    group: 'Audio',
    keywords: ['equalizer', 'eq'],
    when: hasSound,
    run: () => setEq(soundIds(), []),
  },
  ...EQ_PRESETS.map(
    (p): Command => ({
      id: `audio.eq.${p.id}`,
      title: `EQ preset: ${p.name}`,
      group: 'Audio',
      keywords: ['equalizer', 'eq', 'preset'],
      when: hasSound,
      run: () => setEq(soundIds(), p.bands),
    }),
  ),
  {
    id: 'audio.toggleCompressor',
    title: 'Toggle compressor',
    group: 'Audio',
    keywords: ['dynamics', 'compressor'],
    when: hasSound,
    run: () => {
      const ids = soundIds();
      const first = getProject().clips[ids[0]];
      const on = !!first && (first.type === 'video' || first.type === 'audio') && !!first.compressor && first.compressor.enabled !== false;
      setCompressor(ids, { enabled: !on });
    },
  },
  ...COMPRESSOR_PRESETS.map(
    (p): Command => ({
      id: `audio.compressor.${p.id}`,
      title: `Compressor preset: ${p.name}`,
      group: 'Audio',
      keywords: ['dynamics', 'compressor', 'preset', 'limiter'],
      when: hasSound,
      run: () => setCompressor(soundIds(), p.settings),
    }),
  ),
];

export default commands;
