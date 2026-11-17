import { AudioLines } from 'lucide-react';
import type { ReactNode } from 'react';
import { disposeTranscriber, type DevicePref } from '@/engine/speech/transcriber';
import { toast } from '@/store/ui';
import { Field, Select } from '../../common/controls';
import { LanguageField } from '../../speech/components';
import { useSpeech } from '../../speech/store';
import type { SettingsSectionDef } from '../index';

/** Speech & audio preferences (stored in the app settings under `speech.prefs`). */
function SpeechSettings(): ReactNode {
  const device = useSpeech((s) => s.prefs.device);
  const setPrefs = useSpeech((s) => s.setPrefs);
  return (
    <>
      <LanguageField />
      <Field label="Speech engine" title="The bundled speech model is int8-quantised; on most PCs the CPU (multi-threaded WebAssembly) engine is the fastest.">
        <Select
          value={device}
          options={[
            { value: 'auto', label: 'Automatic (recommended)' },
            { value: 'wasm', label: 'CPU — WebAssembly, multi-threaded' },
            { value: 'webgpu', label: 'GPU — WebGPU' },
          ]}
          onChange={(v) => {
            setPrefs({ device: v as DevicePref });
            disposeTranscriber();
          }}
        />
      </Field>
      <p className="hint">Speech recognition (Whisper), noise reduction, beat and silence detection run entirely on this PC. Text to speech uses the voices installed in Windows.</p>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        onClick={() => {
          disposeTranscriber();
          toast('info', 'Speech model unloaded', 'It loads again the next time you transcribe.');
        }}
      >
        Free speech model memory
      </button>
    </>
  );
}

const sections: SettingsSectionDef[] = [{ id: 'speech', title: 'Speech & audio', icon: <AudioLines size={16} />, order: 60, Component: SpeechSettings }];

export default sections;
