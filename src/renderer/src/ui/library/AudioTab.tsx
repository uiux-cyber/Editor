import { Mic, Pause, Play, Plus, Repeat, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { makeAudio } from '@/core/factory';
import { trackWithRoom } from '@/core/project';
import { formatDuration, snapToFrame } from '@/core/time';
import { engine } from '@/engine/engine';
import { auditionSound, encodeWav, soundAssetDuration, stopAudition } from '@/engine/media/sounds';
import { SOUNDS } from '@/library';
import type { SoundCategory, SoundDef } from '@/library/types';
import { api } from '@/platform/api';
import { getProject, updateProject } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { addSound } from '../actions';
import { startDrag } from '../dnd';
import { Chips, SearchBox, labelOf, unique } from './common';
import { importFiles } from './MediaTab';

function SoundRow({ def, playing, onToggle }: { def: SoundDef; playing: boolean; onToggle: () => void }): ReactNode {
  const duration = soundAssetDuration(def);
  return (
    <div
      className={`sound-row ${playing ? 'is-playing' : ''}`}
      title="Click + to add at the playhead, or drag to the timeline"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        startDrag(e, { kind: 'sound', soundId: def.id, duration }, def.name);
      }}
    >
      <button type="button" className="sound-row__play" onClick={onToggle} title={playing ? 'Stop' : 'Preview'}>
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <div className="sound-row__body">
        <div className="sound-row__name truncate">{def.name}</div>
        <div className="sound-row__meta">
          <span className="mono">{formatDuration(Math.max(1, duration))}</span>
          {def.loop && (
            <span title="Seamless loop">
              <Repeat size={10} /> loop
            </span>
          )}
          {def.bpm && <span>{def.bpm} BPM</span>}
          <span>{labelOf(def.category)}</span>
        </div>
      </div>
      <button type="button" className="icon-btn icon-btn--sm" onClick={() => void addSound(def.id)} title="Add at the playhead">
        <Plus size={14} />
      </button>
    </div>
  );
}

/** Record the microphone while the timeline plays, then drop the take at the start position. */
function VoiceoverButton(): ReactNode {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const session = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startTime: number; timer: number } | null>(null);

  const stop = (): void => session.current?.recorder.stop();

  const start = async (): Promise<void> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch {
      toast('error', 'Microphone unavailable', 'Check that a microphone is connected and allowed in Windows privacy settings.');
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const startTime = snapToFrame(engine.time, getProject().settings.fps);
    const began = performance.now();
    const timer = window.setInterval(() => setElapsed((performance.now() - began) / 1000), 200);
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = async () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      session.current = null;
      setRecording(false);
      setElapsed(0);
      engine.pause();
      try {
        // Re-encode to WAV: recorder output has no duration / seek index, which media
        // elements need for accurate scrubbing.
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
        void ctx.close();
        if (decoded.duration < 0.2) return;
        const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => decoded.getChannelData(i));
        const wav = encodeWav(channels, decoded.sampleRate);
        const info = await api.fs.saveRecording('Voiceover.wav', new Uint8Array(await wav.arrayBuffer()));
        const [asset] = await importFiles([info]);
        if (!asset) return;
        let id = '';
        updateProject((p) => {
          const clip = makeAudio(p.assets[asset.id] ?? asset, { start: startTime, name: 'Voiceover' });
          clip.trackId = trackWithRoom(p, 'audio', startTime, clip.duration).id;
          p.clips[clip.id] = clip;
          id = clip.id;
        });
        if (id) useUI.getState().select([id]);
        toast('success', 'Voiceover added to the timeline');
      } catch (err) {
        console.error(err);
        toast('error', 'The recording could not be saved');
      }
    };
    session.current = { recorder, stream, chunks, startTime, timer };
    recorder.start(250);
    setRecording(true);
    engine.play();
  };

  useEffect(
    () => () => {
      const s = session.current;
      if (s) {
        window.clearInterval(s.timer);
        s.recorder.onstop = null;
        s.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  return recording ? (
    <button type="button" className="btn btn--danger btn--sm" onClick={stop} title="Stop recording">
      <Square size={11} fill="currentColor" /> <span className="mono">{formatDuration(elapsed)}</span>
    </button>
  ) : (
    <button type="button" className="btn btn--outline btn--sm" onClick={() => void start()} title="Record a voiceover from the playhead">
      <Mic size={13} /> Record
    </button>
  );
}

const ORDER: SoundCategory[] = ['music', 'whoosh', 'impact', 'riser', 'ui', 'notification', 'glitch', 'cartoon', 'ambience'];

export function AudioTab(): ReactNode {
  const [category, setCategory] = useState<SoundCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const categories = useMemo(() => {
    const present = unique(SOUNDS.map((s) => s.category));
    return ORDER.filter((c) => present.includes(c));
  }, []);
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return SOUNDS.filter((s) => (category === 'all' || s.category === category) && (!term || s.name.toLowerCase().includes(term) || s.keywords.some((k) => k.includes(term)))).sort(
      (a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category),
    );
  }, [category, search]);

  useEffect(() => () => stopAudition(), []);

  const toggle = (def: SoundDef): void => {
    if (playingId === def.id) {
      stopAudition();
      setPlayingId(null);
      return;
    }
    setPlayingId(def.id);
    void auditionSound(def, useUI.getState().masterVolume * 0.9, () => setPlayingId((id) => (id === def.id ? null : id))).catch(() => setPlayingId(null));
  };

  return (
    <div className="lib">
      <header className="lib__head">
        <h3>Audio</h3>
        <VoiceoverButton />
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder="Search sounds & music" />
      </div>
      <Chips value={category} onChange={setCategory} options={[{ value: 'all' as const, label: 'All' }, ...categories.map((c) => ({ value: c, label: c === 'ui' ? 'Interface' : labelOf(c) }))]} />
      <div className="lib__scroll">
        {list.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No sounds found</div>
          </div>
        ) : (
          <div className="sound-list">
            {list.map((s) => (
              <SoundRow key={s.id} def={s} playing={playingId === s.id} onToggle={() => toggle(s)} />
            ))}
          </div>
        )}
        <p className="lib__note">Every sound is synthesised by Kinora — royalty-free for any use. Import your own music from the Media tab.</p>
      </div>
    </div>
  );
}
