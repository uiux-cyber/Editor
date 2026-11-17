/**
 * Speech & audio commands (palette / menus / shortcuts). Actions that need choices open their
 * Smart tool; the others run straight away with the last-used settings.
 */

import { captionClips } from '@/core/captions';
import { getProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { openTool } from '../../tools/ToolsTab';
import {
  autoCaptions,
  autoDuck,
  beatTimes,
  cancelJob,
  clearBeatMarkers,
  detectBeatsFor,
  detectSilence,
  duckTargets,
  exportSubtitles,
  findFillers,
  hasTimelineAudio,
  importSubtitles,
  musicClipForBeats,
  removeSelectedFillers,
  removeSelectedSilences,
  selectedSoundClips,
  sequenceOnBeats,
  splitAtBeats,
} from '../../speech/actions';
import { useSpeech } from '../../speech/store';
import type { Command } from '../index';

const idle = (): boolean => !useSpeech.getState().job;
const hasSound = (): boolean => hasTimelineAudio(getProject());
const hasCaptions = (): boolean => captionClips(getProject()).length > 0;
const hasVisualSelection = (): boolean => useUI.getState().selection.some((id) => getProject().clips[id] && getProject().clips[id].type !== 'audio');

const commands: Command[] = [
  { id: 'smart.autoCaptions', title: 'Auto captions', group: 'Smart', keywords: ['subtitles', 'transcribe', 'speech to text'], when: () => idle() && hasSound(), run: () => autoCaptions('selection') },
  { id: 'smart.captionsOptions', title: 'Auto captions…', group: 'Smart', keywords: ['caption style', 'subtitles'], run: () => openTool('speech.captions') },
  { id: 'smart.importSubtitles', title: 'Import subtitles (SRT / VTT)…', group: 'Smart', keywords: ['srt', 'vtt', 'captions'], run: () => importSubtitles() },
  { id: 'smart.exportSrt', title: 'Export captions as SRT…', group: 'Smart', keywords: ['subtitles', 'subrip'], when: hasCaptions, run: () => exportSubtitles('srt') },
  { id: 'smart.exportVtt', title: 'Export captions as WebVTT…', group: 'Smart', keywords: ['subtitles', 'vtt'], when: hasCaptions, run: () => exportSubtitles('vtt') },
  {
    id: 'smart.findFillers',
    title: 'Find filler words',
    group: 'Smart',
    keywords: ['um', 'uh', 'cleanup'],
    when: () => idle() && hasSound(),
    run: () => {
      openTool('speech.fillers');
      return findFillers('selection');
    },
  },
  { id: 'smart.removeFillers', title: 'Remove the selected filler words', group: 'Smart', when: () => !!useSpeech.getState().fillers?.selected.some(Boolean), run: removeSelectedFillers },
  {
    id: 'smart.detectSilence',
    title: 'Detect silences',
    group: 'Smart',
    keywords: ['pause', 'jump cut', 'dead air'],
    when: () => idle() && hasSound(),
    run: () => {
      openTool('audio.silence');
      return detectSilence('selection');
    },
  },
  { id: 'smart.removeSilences', title: 'Remove the detected silences', group: 'Smart', when: () => !!useSpeech.getState().silences?.selected.some(Boolean), run: removeSelectedSilences },
  { id: 'smart.detectBeats', title: 'Detect beats', group: 'Smart', keywords: ['bpm', 'tempo', 'music'], when: () => idle() && !!musicClipForBeats(getProject()), run: () => detectBeatsFor() },
  { id: 'smart.splitAtBeats', title: 'Split selected clips at the beats', group: 'Smart', keywords: ['cut to beat'], when: () => beatTimes('beat').length > 0 && hasVisualSelection(), run: () => splitAtBeats('beat') },
  { id: 'smart.sequenceOnBeats', title: 'Place selected clips one per beat', group: 'Smart', keywords: ['cut to beat', 'slideshow'], when: () => beatTimes('beat').length > 1 && hasVisualSelection(), run: () => sequenceOnBeats('beat') },
  { id: 'smart.sequenceOnBars', title: 'Place selected clips one per bar', group: 'Smart', keywords: ['cut to beat', 'slideshow'], when: () => beatTimes('bar').length > 1 && hasVisualSelection(), run: () => sequenceOnBeats('bar') },
  { id: 'smart.clearBeats', title: 'Remove beat markers', group: 'Smart', when: () => beatTimes('beat').length > 0, run: clearBeatMarkers },
  { id: 'smart.denoise', title: 'Noise reduction…', group: 'Smart', keywords: ['denoise', 'hiss', 'clean audio'], when: () => selectedSoundClips(getProject()).length > 0, run: () => openTool('audio.denoise') },
  { id: 'smart.textToSpeech', title: 'Text to speech…', group: 'Smart', keywords: ['tts', 'voice', 'narration'], run: () => openTool('speech.tts') },
  { id: 'smart.autoDuck', title: 'Auto-duck selected music', group: 'Smart', keywords: ['ducking', 'music volume'], when: () => idle() && duckTargets(getProject()).length > 0, run: () => autoDuck() },
  { id: 'smart.cancelSpeechJob', title: 'Cancel the running speech task', group: 'Smart', when: () => !idle(), run: cancelJob },
];

export default commands;
