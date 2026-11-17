/**
 * Speech & audio smart tools (library → Smart tab): auto captions, subtitles, filler words,
 * text to speech (group "Speech"); silence removal, beat detection, noise reduction and
 * auto-ducking (group "Audio"). All processing is on-device.
 */

import { AudioLines, AudioWaveform, Captions, Drum, FileText, Mic, Play, Scissors, Sparkles, Square, Volume1, VolumeX, Wand2 } from 'lucide-react';
import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { captionMetrics, type CaptionPosition } from '@/core/captionStyles';
import { captionClips } from '@/core/captions';
import { getIndex } from '@/core/project';
import { languageName, type DevicePref } from '@/engine/speech/transcriber';
import * as transcriber from '@/engine/speech/transcriber';
import * as extract from '@/engine/speech/audioExtract';
import { api } from '@/platform/api';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { Field, Segmented, Select, SliderField, Toggle } from '../../common/controls';
import * as speech from '../../speech/actions';
import {
  addSpeech,
  applyDenoise,
  autoCaptions,
  autoDuck,
  beatTimes,
  clearBeatMarkers,
  clearDucking,
  denoisePreview,
  denoiseTarget,
  detectBeatsFor,
  detectSilence,
  duckTargets,
  exportSubtitles,
  findFillers,
  importSubtitles,
  loadVoices,
  musicClipForBeats,
  previewRange,
  removeSelectedFillers,
  removeSelectedSilences,
  selectedLength,
  sequenceOnBeats,
  splitAtBeats,
  synthesize,
  type DenoisePreview,
  type Voice,
} from '../../speech/actions';
import { auditionPlaying, auditionSide, onAuditionChange, playAudition, setAuditionSide, stopAudition } from '../../speech/audition';
import { CheckBox, JobStatus, LanguageField, PresetGrid, ScopeSwitch, fmtTime, useBusy } from '../../speech/components';
import { useSpeech, type Scope } from '../../speech/store';
import '../../speech/speech.css';
import type { ToolDef } from '../index';

/** Decode frames of a rendered video (used by the automated tests to inspect exports). */
async function videoFrames(file: string, times: number[], width: number, height: number): Promise<{ frames: string[]; ink: number[]; hasAudio: boolean; duration: number }> {
  const input = new Input({ source: new UrlSource(api.media.toUrl(file)), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track');
    const sink = new CanvasSink(track, { width, height, fit: 'contain' });
    const frames: string[] = [];
    const ink: number[] = [];
    for (const t of times) {
      const wrapped = await sink.getCanvas(t + 0.001);
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d')!;
      if (wrapped) g.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, width, height);
      const px = g.getImageData(0, 0, width, height).data;
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 40) lit++;
      ink.push(lit / (width * height));
      frames.push(c.toDataURL('image/png'));
    }
    return { frames, ink, hasAudio: !!(await input.getPrimaryAudioTrack()), duration: await input.computeDuration() };
  } finally {
    input.dispose();
  }
}

// Debug / automation handle (like window.__kinora).
(window as unknown as Record<string, unknown>).__kinoraSpeech = { actions: speech, store: useSpeech, transcriber, extract, debug: { videoFrames } };

const POSITIONS: { value: CaptionPosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'lower', label: 'Lower' },
  { value: 'bottom', label: 'Bottom' },
];

function LastRun(): ReactNode {
  const run = useSpeech((s) => s.lastRun);
  if (!run) return null;
  return (
    <p className="hint sp-lastrun">
      Last transcription: {run.audioSeconds.toFixed(0)} s of {languageName(run.language)} in {run.seconds.toFixed(1)} s on the {run.device === 'wasm' ? 'CPU' : 'GPU'} ({(run.audioSeconds / Math.max(0.01, run.seconds)).toFixed(1)}× real time).
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------------------------

function AutoCaptionsPanel(): ReactNode {
  const [scope, setScope] = useState<Scope>('selection');
  const prefs = useSpeech((s) => s.prefs);
  const setPrefs = useSpeech((s) => s.setPrefs);
  const settings = useProjectStore((s) => s.project.settings);
  const existing = useProjectStore((s) => captionClips(s.project).length);
  const busy = useBusy();
  const defaultChars = captionMetrics(settings).maxChars;
  return (
    <>
      <ScopeSwitch value={scope} onChange={setScope} />
      <LanguageField />
      <div className="sp-label">Style</div>
      <PresetGrid value={prefs.captionPreset} onPick={(id) => setPrefs({ captionPreset: id })} />
      <Field label="Position">
        <Segmented value={prefs.captionPosition} style={{ flex: 1 }} options={POSITIONS} onChange={(v) => setPrefs({ captionPosition: v })} />
      </Field>
      <details className="advanced">
        <summary>Line options</summary>
        <SliderField label="Characters" value={prefs.maxChars ?? defaultChars} min={12} max={56} step={1} defaultValue={defaultChars} onChange={(v) => setPrefs({ maxChars: Math.round(v) === defaultChars ? null : Math.round(v) })} />
        <Field label="Lines">
          <Segmented value={prefs.maxLines} style={{ flex: 1 }} options={[{ value: 1, label: 'One line' }, { value: 2, label: 'Up to two' }]} onChange={(v) => setPrefs({ maxLines: v })} />
        </Field>
        <Field label="Engine" title="The CPU engine is the fastest for the bundled model on most PCs.">
          <Select
            value={prefs.device}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'wasm', label: 'CPU (WebAssembly)' },
              { value: 'webgpu', label: 'GPU (WebGPU)' },
            ]}
            onChange={(v) => setPrefs({ device: v as DevicePref })}
          />
        </Field>
      </details>
      {existing > 0 && (
        <Field label="Existing">
          <CheckBox checked={prefs.replaceCaptions} onChange={(v) => setPrefs({ replaceCaptions: v })} label={`Replace the ${existing} caption${existing === 1 ? '' : 's'} in that range`} />
        </Field>
      )}
      <JobStatus kinds={['captions']} />
      <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => void autoCaptions(scope)} data-action="generate-captions">
        <Captions size={14} /> Generate captions
      </button>
      <LastRun />
    </>
  );
}

function SubtitlesPanel(): ReactNode {
  const count = useProjectStore((s) => captionClips(s.project).length);
  return (
    <>
      <p className="hint">Import SubRip (.srt) or WebVTT (.vtt) files as editable captions, or export the captions for YouTube and other players.</p>
      <button type="button" className="btn btn--outline btn--block" onClick={() => void importSubtitles()} data-action="import-subtitles">
        <FileText size={14} /> Import SRT / VTT…
      </button>
      <div className="sp-row">
        <button type="button" className="btn btn--outline" style={{ flex: 1 }} disabled={!count} onClick={() => void exportSubtitles('srt')} data-action="export-srt">
          Export SRT
        </button>
        <button type="button" className="btn btn--outline" style={{ flex: 1 }} disabled={!count} onClick={() => void exportSubtitles('vtt')} data-action="export-vtt">
          Export VTT
        </button>
      </div>
      <p className="hint">{count ? `${count} caption${count === 1 ? '' : 's'} on the timeline.` : 'No captions yet.'}</p>
    </>
  );
}

function ReviewHeader({ total, selected, onAll, label }: { total: number; selected: number; onAll: (v: boolean) => void; label: string }): ReactNode {
  return (
    <div className="sp-review__head">
      <CheckBox checked={selected === total && total > 0} onChange={onAll} label={`${selected} of ${total} ${label}`} />
    </div>
  );
}

function FillersPanel(): ReactNode {
  const [scope, setScope] = useState<Scope>('selection');
  const review = useSpeech((s) => s.fillers);
  const prefs = useSpeech((s) => s.prefs);
  const setPrefs = useSpeech((s) => s.setPrefs);
  const set = useSpeech((s) => s.set);
  const busy = useBusy();
  const chosen = review ? review.candidates.filter((_, i) => review.selected[i]) : [];
  const saving = chosen.reduce((s, c) => s + (c.end - c.start), 0);
  const toggle = (i: number, v: boolean): void => {
    if (!review) return;
    const selected = review.selected.slice();
    selected[i] = v;
    set({ fillers: { ...review, selected } });
  };
  return (
    <>
      <ScopeSwitch value={scope} onChange={setScope} />
      <LanguageField />
      <JobStatus kinds={['fillers']} />
      <button type="button" className="btn btn--outline btn--block" disabled={busy} onClick={() => void findFillers(scope)} data-action="find-fillers">
        <Sparkles size={14} /> Find filler words
      </button>
      {review && review.candidates.length > 0 && (
        <div className="sp-review" data-review="fillers">
          <ReviewHeader total={review.candidates.length} selected={chosen.length} label="selected" onAll={(v) => set({ fillers: { ...review, selected: review.candidates.map(() => v) } })} />
          <div className="sp-review__list">
            {review.candidates.map((c, i) => {
              const before = review.words.slice(Math.max(0, c.index - 3), c.index).map((w) => w.text).join(' ');
              const after = review.words.slice(c.index + c.count, c.index + c.count + 3).map((w) => w.text).join(' ');
              return (
                <div key={`${c.index}-${c.start}`} className={`sp-item ${review.selected[i] ? '' : 'is-off'}`} data-filler={i}>
                  <CheckBox checked={review.selected[i]} onChange={(v) => toggle(i, v)} />
                  <button type="button" className="sp-item__body" onClick={() => previewRange(c.start, c.end)} title="Play this moment">
                    <span className="sp-item__ctx truncate">
                      {before && <span className="sp-dim">…{before} </span>}
                      <mark className={`sp-mark sp-mark--${c.kind}`}>{c.text}</mark>
                      {after && <span className="sp-dim"> {after}…</span>}
                    </span>
                    <span className="sp-item__time mono">{fmtTime(c.start)}</span>
                  </button>
                </div>
              );
            })}
          </div>
          <CheckBox checked={prefs.rippleAllTracks} onChange={(v) => setPrefs({ rippleAllTracks: v })} label="Cut every track (music and overlays too)" />
          <button type="button" className="btn btn--primary btn--block" disabled={!chosen.length || busy} onClick={removeSelectedFillers} data-action="remove-fillers">
            <Scissors size={14} /> Remove {chosen.length} filler{chosen.length === 1 ? '' : 's'} · {saving.toFixed(1)} s
          </button>
        </div>
      )}
      {review && review.candidates.length === 0 && <p className="hint">No filler words in the last check.</p>}
    </>
  );
}

function TtsPanel(): ReactNode {
  const prefs = useSpeech((s) => s.prefs);
  const setPrefs = useSpeech((s) => s.setPrefs);
  const busy = useBusy();
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let alive = true;
    loadVoices()
      .then((v) => {
        if (!alive) return;
        setVoices(v);
        if (v.length && !v.some((x) => x.name === useSpeech.getState().prefs.ttsVoice)) useSpeech.getState().setPrefs({ ttsVoice: v[0].name });
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => () => playing?.pause(), [playing]);

  const preview = async (): Promise<void> => {
    if (playing) {
      playing.pause();
      setPlaying(null);
      return;
    }
    setPreviewing(true);
    try {
      const info = await synthesize(text, 'preview');
      const audio = new Audio(api.media.toUrl(info.path));
      audio.onended = () => setPlaying(null);
      await audio.play();
      setPlaying(audio);
    } catch (e) {
      useUI.getState().toast({ kind: 'error', message: 'Could not preview the voice', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <>
      <textarea className="textarea sp-tts__text" placeholder="Type what the voice should say…" value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} data-input="tts-text" />
      <Field label="Voice">
        {voices ? (
          <Select value={prefs.ttsVoice} options={voices.map((v) => ({ value: v.name, label: `${v.name.replace(/^Microsoft\s+|\s+Desktop$/g, '')} · ${v.culture} · ${v.gender}` }))} onChange={(v) => setPrefs({ ttsVoice: v })} />
        ) : (
          <span className="hint">{error ?? 'Loading Windows voices…'}</span>
        )}
      </Field>
      <SliderField label="Speed" value={prefs.ttsRate} min={-10} max={10} step={1} defaultValue={0} onChange={(v) => setPrefs({ ttsRate: Math.round(v) })} />
      <CheckBox checked={prefs.ttsCaptions} onChange={(v) => setPrefs({ ttsCaptions: v })} label="Also add captions for it" />
      <JobStatus kinds={['tts', 'captions']} />
      <div className="sp-row">
        <button type="button" className="btn btn--outline" disabled={!text.trim() || previewing || !voices} onClick={() => void preview()} data-action="tts-preview">
          {playing ? <Square size={13} /> : <Play size={13} />} {previewing ? 'Generating…' : playing ? 'Stop' : 'Preview'}
        </button>
        <button type="button" className="btn btn--primary" style={{ flex: 1 }} disabled={!text.trim() || busy || !voices} onClick={() => void addSpeech(text.trim())} data-action="tts-add">
          <Mic size={14} /> Add at playhead
        </button>
      </div>
      <p className="hint">Uses the voices installed in Windows. Nothing leaves this PC.</p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------

function SilencePanel(): ReactNode {
  const [scope, setScope] = useState<Scope>('selection');
  const prefs = useSpeech((s) => s.prefs);
  const setPrefs = useSpeech((s) => s.setPrefs);
  const review = useSpeech((s) => s.silences);
  const set = useSpeech((s) => s.set);
  const busy = useBusy();
  const chosen = review ? review.selected.filter(Boolean).length : 0;
  const saving = review ? selectedLength(review.ranges, review.selected) : 0;
  return (
    <>
      <ScopeSwitch value={scope} onChange={setScope} />
      <SliderField label="Threshold" value={prefs.silenceThreshold} min={-70} max={-15} step={1} suffix="dB" defaultValue={-40} onChange={(v) => setPrefs({ silenceThreshold: Math.round(v) })} />
      <SliderField label="Min length" value={prefs.silenceMin} min={0.2} max={4} step={0.05} precision={2} suffix="s" defaultValue={0.6} onChange={(v) => setPrefs({ silenceMin: v })} />
      <SliderField label="Padding" value={prefs.silencePadding} min={0} max={0.6} step={0.01} precision={2} suffix="s" defaultValue={0.12} onChange={(v) => setPrefs({ silencePadding: v })} />
      <JobStatus kinds={['silence']} />
      <button type="button" className="btn btn--outline btn--block" disabled={busy} onClick={() => void detectSilence(scope)} data-action="detect-silence">
        <AudioWaveform size={14} /> Detect silences
      </button>
      {review && review.ranges.length > 0 && (
        <div className="sp-review" data-review="silences">
          <ReviewHeader total={review.ranges.length} selected={chosen} label="marked on the timeline" onAll={(v) => set({ silences: { ...review, selected: review.ranges.map(() => v) } })} />
          <div className="sp-review__list">
            {review.ranges.map((r, i) => (
              <div key={`${r.start}`} className={`sp-item ${review.selected[i] ? '' : 'is-off'}`} data-silence={i}>
                <CheckBox
                  checked={review.selected[i]}
                  onChange={(v) => {
                    const selected = review.selected.slice();
                    selected[i] = v;
                    set({ silences: { ...review, selected } });
                  }}
                />
                <button type="button" className="sp-item__body" onClick={() => previewRange(r.start, r.end, 0.6, 0.6)} title="Play around this silence">
                  <span className="sp-item__ctx">
                    {fmtTime(r.start)} → {fmtTime(r.end)}
                  </span>
                  <span className="sp-item__time mono">{(r.end - r.start).toFixed(2)} s</span>
                </button>
              </div>
            ))}
          </div>
          <CheckBox checked={prefs.rippleAllTracks} onChange={(v) => setPrefs({ rippleAllTracks: v })} label="Cut every track (music and overlays too)" />
          <div className="sp-row">
            <button type="button" className="btn btn--ghost" onClick={() => set({ silences: null })}>
              Clear
            </button>
            <button type="button" className="btn btn--primary" style={{ flex: 1 }} disabled={!chosen || busy} onClick={removeSelectedSilences} data-action="remove-silences">
              <Scissors size={14} /> Remove {chosen} · {saving.toFixed(1)} s
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function BeatsPanel(): ReactNode {
  const project = useProjectStore((s) => s.project);
  useUI((s) => s.selection);
  const busy = useBusy();
  const [bar, setBar] = useState(4);
  const [unit, setUnit] = useState<'beat' | 'bar'>('beat');
  const target = musicClipForBeats(project);
  const beats = beatTimes('beat', project).length;
  const bars = beatTimes('bar', project).length;
  return (
    <>
      <Field label="Music">
        <span className="sp-target truncate">{target ? target.name : 'Select a music clip'}</span>
      </Field>
      <Field label="Bar">
        <Segmented value={bar} style={{ flex: 1 }} options={[{ value: 3, label: '3 beats' }, { value: 4, label: '4 beats' }]} onChange={setBar} />
      </Field>
      <JobStatus kinds={['beats']} />
      <button type="button" className="btn btn--outline btn--block" disabled={busy || !target} onClick={() => void detectBeatsFor(target?.id, bar)} data-action="detect-beats">
        <Drum size={14} /> Detect beats
      </button>
      {beats > 0 && (
        <>
          <p className="hint">
            <span className="sp-dot" style={{ background: 'var(--cyan)' }} /> {beats} beats · <span className="sp-dot" style={{ background: 'var(--pink)' }} /> {bars} bars on the timeline
          </p>
          <div className="sp-label">Cut to beat</div>
          <Field label="Every">
            <Segmented value={unit} style={{ flex: 1 }} options={[{ value: 'beat', label: 'Beat' }, { value: 'bar', label: 'Bar' }]} onChange={setUnit} />
          </Field>
          <div className="sp-row">
            <button type="button" className="btn btn--outline" style={{ flex: 1 }} onClick={() => splitAtBeats(unit)} title="Split the selected clips at every beat" data-action="split-beats">
              <Scissors size={13} /> Split selected
            </button>
            <button type="button" className="btn btn--outline" style={{ flex: 1 }} onClick={() => sequenceOnBeats(unit)} title="Place the selected clips one per beat" data-action="sequence-beats">
              <Wand2 size={13} /> One per {unit}
            </button>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={clearBeatMarkers}>
            Remove beat markers
          </button>
        </>
      )}
    </>
  );
}

function useAudition(): { playing: boolean; side: 'A' | 'B' } {
  const playing = useSyncExternalStore(onAuditionChange, auditionPlaying);
  const side = useSyncExternalStore(onAuditionChange, auditionSide);
  return { playing, side };
}

function DenoisePanel(): ReactNode {
  const project = useProjectStore((s) => s.project);
  useUI((s) => s.selection);
  const prefs = useSpeech((s) => s.prefs);
  const setPrefs = useSpeech((s) => s.setPrefs);
  const busy = useBusy();
  const [preview, setPreview] = useState<(DenoisePreview & { strength: number; clipId: string }) | null>(null);
  const { playing, side } = useAudition();
  const target = denoiseTarget(project);
  useEffect(() => () => stopAudition(), []);
  useEffect(() => {
    if (preview && (!target || target.id !== preview.clipId)) {
      stopAudition();
      setPreview(null);
    }
  }, [target, preview]);
  const stale = preview && Math.abs(preview.strength - prefs.denoiseStrength) > 1e-3;

  const listen = async (): Promise<void> => {
    if (playing && !stale) {
      stopAudition();
      return;
    }
    let p = preview;
    if (!p || stale) {
      stopAudition();
      const res = await denoisePreview(prefs.denoiseStrength);
      if (!res || !target) return;
      p = { ...res, strength: prefs.denoiseStrength, clipId: target.id };
      setPreview(p);
    }
    await playAudition(p.original, p.cleaned, p.sampleRate, 'B');
  };

  return (
    <>
      <Field label="Clip">
        <span className="sp-target truncate">{target ? target.name : 'Select a clip with sound'}</span>
      </Field>
      <SliderField label="Strength" value={prefs.denoiseStrength} min={0.1} max={1} step={0.01} scale={100} suffix="%" defaultValue={0.7} onChange={(v) => setPrefs({ denoiseStrength: v })} />
      <JobStatus kinds={['denoise']} />
      <div className="sp-row">
        <button type="button" className="btn btn--outline" disabled={!target || busy} onClick={() => void listen()} data-action="denoise-preview">
          {playing && !stale ? <Square size={13} /> : <Play size={13} />} {playing && !stale ? 'Stop' : 'Listen'}
        </button>
        <Segmented
          value={side}
          style={{ flex: 1, opacity: playing ? 1 : 0.5 }}
          options={[
            { value: 'A', label: 'A · Original', title: 'Hear the original' },
            { value: 'B', label: 'B · Clean', title: 'Hear the cleaned sound' },
          ]}
          onChange={(v) => setAuditionSide(v)}
        />
      </div>
      <button type="button" className="btn btn--primary btn--block" disabled={!target || busy} onClick={() => void applyDenoise(prefs.denoiseStrength).then(() => stopAudition())} data-action="denoise-apply">
        <AudioLines size={14} /> Reduce noise
      </button>
      <p className="hint">Learns the noise from the quietest moments and removes it. The clip switches to a cleaned copy of its sound — trims, volume and fades are kept, and Undo brings back the original.</p>
    </>
  );
}

function DuckPanel(): ReactNode {
  const project = useProjectStore((s) => s.project);
  useUI((s) => s.selection);
  const prefs = useSpeech((s) => s.prefs);
  const setPrefs = useSpeech((s) => s.setPrefs);
  const busy = useBusy();
  const [trackId, setTrackId] = useState<string>('');
  const selected = duckTargets(project);
  const audioTracks = useMemo(() => project.tracks.filter((t) => t.kind === 'audio' && (getIndex(project).byTrack.get(t.id)?.some((c) => c.type === 'audio') ?? false)), [project]);
  const useTrack = selected.length === 0 && trackId && audioTracks.some((t) => t.id === trackId);
  return (
    <>
      <Field label="Music">
        {selected.length ? (
          <span className="sp-target truncate">
            {selected.length} selected clip{selected.length === 1 ? '' : 's'}
          </span>
        ) : (
          <Select value={trackId} options={[{ value: '', label: 'Select clips or pick a track' }, ...audioTracks.map((t) => ({ value: t.id, label: `Track ${t.name}` }))]} onChange={setTrackId} />
        )}
      </Field>
      <SliderField label="Depth" value={prefs.duckDepth} min={3} max={30} step={1} suffix="dB" defaultValue={12} onChange={(v) => setPrefs({ duckDepth: Math.round(v) })} />
      <SliderField label="Fade down" value={prefs.duckAttack} min={0.05} max={1.5} step={0.05} precision={2} suffix="s" defaultValue={0.25} onChange={(v) => setPrefs({ duckAttack: v })} />
      <SliderField label="Fade up" value={prefs.duckRelease} min={0.1} max={3} step={0.05} precision={2} suffix="s" defaultValue={0.6} onChange={(v) => setPrefs({ duckRelease: v })} />
      <JobStatus kinds={['duck']} />
      <button type="button" className="btn btn--primary btn--block" disabled={busy || (!selected.length && !useTrack)} onClick={() => void autoDuck(useTrack ? trackId : undefined)} data-action="auto-duck">
        <Volume1 size={14} /> Duck under speech
      </button>
      {selected.some((c) => c.keyframes?.volume?.length) && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => clearDucking(selected.map((c) => c.id))}>
          <VolumeX size={13} /> Remove volume keyframes
        </button>
      )}
      <p className="hint">Listens to every other sound on the timeline and lowers the music while someone speaks. Replaces the music clips' volume keyframes.</p>
    </>
  );
}

const tools: ToolDef[] = [
  { id: 'speech.captions', title: 'Auto captions', description: 'Transcribe speech into styled, word-timed captions', group: 'Speech', icon: <Captions size={17} />, keywords: ['subtitles', 'transcribe', 'speech to text', 'whisper', 'karaoke'], Panel: AutoCaptionsPanel },
  { id: 'speech.subtitles', title: 'Subtitle files', description: 'Import or export SRT and WebVTT', group: 'Speech', icon: <FileText size={17} />, keywords: ['srt', 'vtt', 'captions', 'import', 'export'], Panel: SubtitlesPanel },
  { id: 'speech.fillers', title: 'Remove filler words', description: 'Find “um”, “uh”, “you know”… and cut them out', group: 'Speech', icon: <Sparkles size={17} />, keywords: ['um', 'uh', 'disfluency', 'cleanup'], Panel: FillersPanel },
  { id: 'speech.tts', title: 'Text to speech', description: 'Turn text into a voice-over with Windows voices', group: 'Speech', icon: <Mic size={17} />, keywords: ['tts', 'voice', 'narration', 'voiceover'], Panel: TtsPanel },
  { id: 'audio.silence', title: 'Remove silences', description: 'Detect pauses and close the gaps', group: 'Audio', icon: <AudioWaveform size={17} />, keywords: ['jump cut', 'pause', 'dead air', 'trim'], Panel: SilencePanel },
  { id: 'audio.beats', title: 'Beat detection', description: 'Mark the beat of a song and cut clips to it', group: 'Audio', icon: <Drum size={17} />, keywords: ['bpm', 'tempo', 'music', 'rhythm', 'cut to beat'], Panel: BeatsPanel },
  { id: 'audio.denoise', title: 'Noise reduction', description: 'Remove hiss, hum and room noise', group: 'Audio', icon: <AudioLines size={17} />, keywords: ['denoise', 'clean', 'hiss', 'background noise'], Panel: DenoisePanel },
  { id: 'audio.duck', title: 'Auto-ducking', description: 'Lower music automatically under speech', group: 'Audio', icon: <Volume1 size={17} />, keywords: ['duck', 'sidechain', 'music volume', 'dialogue'], Panel: DuckPanel },
];

export default tools;

