/** Settings of the vision features (GPU use, memory for background-removal masks, caches). */

import { ScanEye } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/platform/api';
import { toast } from '@/store/ui';
import { VISION_SETTINGS, applyVisionSettings } from '@/vision/settings';
import { clearMaskCache, maskCacheInfo } from '@/vision/cutout';
import { clearFocusCache } from '@/vision/reframe';
import { Field, Select, Toggle } from '../../common/controls';
import type { SettingsSectionDef } from '../index';

function VisionSettings(): ReactNode {
  const [gpu, setGpu] = useState(true);
  const [mb, setMb] = useState(192);
  const [info, setInfo] = useState(maskCacheInfo());
  useEffect(() => {
    void (async () => {
      setGpu((await api.settings.get<boolean>(VISION_SETTINGS.gpu)) ?? true);
      setMb((await api.settings.get<number>(VISION_SETTINGS.cacheMb)) ?? 192);
    })();
    const t = window.setInterval(() => setInfo(maskCacheInfo()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const save = async (key: string, value: unknown): Promise<void> => {
    await api.settings.set(key, value);
    await applyVisionSettings();
  };
  return (
    <div className="vision-settings">
      <Field label="Use the GPU">
        <Toggle
          value={gpu}
          onChange={(v) => {
            setGpu(v);
            void save(VISION_SETTINGS.gpu, v);
          }}
          title="Run person segmentation on the graphics card (falls back to the CPU automatically)"
        />
      </Field>
      <Field label="Mask memory">
        <Select
          value={mb}
          options={[96, 192, 384, 768].map((v) => ({ value: v, label: `${v} MB` }))}
          onChange={(v) => {
            setMb(v);
            void save(VISION_SETTINGS.cacheMb, v);
          }}
        />
      </Field>
      <p className="hint">
        Background-removal masks in memory: {info.entries} ({(info.bytes / 1048576).toFixed(1)} MB of {(info.limit / 1048576).toFixed(0)} MB).
      </p>
      <button
        type="button"
        className="btn btn--sm btn--outline"
        onClick={() => {
          clearMaskCache();
          clearFocusCache();
          setInfo(maskCacheInfo());
          toast('success', 'Vision caches cleared');
        }}
      >
        Clear analysis caches
      </button>
      <p className="hint">All analysis runs on this PC with bundled models; nothing is uploaded.</p>
    </div>
  );
}

const sections: SettingsSectionDef[] = [{ id: 'vision', title: 'Vision', icon: <ScanEye size={15} />, order: 60, Component: VisionSettings }];

export default sections;
