/**
 * Colour & audio inspector sections: colour wheels, tone curves and LUTs on the Adjust tab of
 * every visual clip (including adjustment layers); EQ and compressor on the Audio tab of clips
 * with sound.
 */

import type { ReactNode } from 'react';
import { isNeutralEq, sanitizeEq } from '@/core/audiofx/eq';
import { isIdentityCurves } from '@/core/color/curves';
import { isNeutralWheels } from '@/core/color/wheels';
import type { AudioClip, Clip, VideoClip, VisualClip } from '@/core/types';
import { useProjectStore } from '@/store/project';
import { Section, Toggle } from '../../../common/controls';
import { ColorWheels } from '../../../coloraudio/ColorWheels';
import { CompressorEditor, setCompressor } from '../../../coloraudio/CompressorEditor';
import { CurvesEditor } from '../../../coloraudio/CurvesEditor';
import { EqEditor } from '../../../coloraudio/EqEditor';
import { clipCurves, clipWheels } from '../../../coloraudio/gradeEdit';
import { LutPanel } from '../../../coloraudio/LutPanel';
import type { InspectorSectionDef, InspectorSectionProps } from '../index';
import '../../../coloraudio/color-audio.css';
import '../../../coloraudio/debug';

const isVisual = (c: Clip): boolean => c.type !== 'audio';
const isMedia = (c: Clip): boolean => c.type === 'video' || c.type === 'audio';

function Badge({ on }: { on: boolean }): ReactNode {
  return on ? <span className="ca-badge" title="Active" /> : null;
}

function WheelsSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const v = clip as VisualClip;
  return (
    <Section title={<>Colour wheels <Badge on={!isNeutralWheels(clipWheels(v))} /></>} id="color-wheels">
      <ColorWheels clip={v} ids={ids} />
    </Section>
  );
}

function CurvesSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const v = clip as VisualClip;
  return (
    <Section title={<>Curves <Badge on={!isIdentityCurves(clipCurves(v))} /></>} id="color-curves">
      <CurvesEditor clip={v} ids={ids} />
    </Section>
  );
}

function LutSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const v = clip as VisualClip;
  return (
    <Section title={<>LUT <Badge on={!!v.lut} /></>} id="color-lut">
      <LutPanel clip={v} ids={ids} />
    </Section>
  );
}

function useHasSound(clip: Clip): boolean {
  return useProjectStore((s) => ('assetId' in clip && clip.type !== 'image' ? !!s.project.assets[clip.assetId]?.hasAudio : false));
}

function EqSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const m = clip as VideoClip | AudioClip;
  const sound = useHasSound(clip);
  if (!sound) return null;
  const n = sanitizeEq(m.eq).length;
  return (
    <Section title={<>Equalizer <Badge on={!isNeutralEq(m.eq)} /></>} id="audio-eq" actions={n > 0 ? <span className="ca-count">{n} band{n === 1 ? '' : 's'}</span> : undefined}>
      <EqEditor clip={m} ids={ids} />
    </Section>
  );
}

function CompressorSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const m = clip as VideoClip | AudioClip;
  const sound = useHasSound(clip);
  if (!sound) return null;
  const on = !!m.compressor && m.compressor.enabled !== false;
  return (
    <Section
      title={<>Compressor <Badge on={on} /></>}
      id="audio-compressor"
      actions={<Toggle value={on} title={on ? 'Bypass the compressor' : 'Enable the compressor'} onChange={(v) => setCompressor(ids, { enabled: v })} />}
    >
      <CompressorEditor clip={m} ids={ids} />
    </Section>
  );
}

const sections: InspectorSectionDef[] = [
  { id: 'color-wheels', tab: 'adjust', order: 50, applies: isVisual, Component: WheelsSection },
  { id: 'color-curves', tab: 'adjust', order: 51, applies: isVisual, Component: CurvesSection },
  { id: 'color-lut', tab: 'adjust', order: 52, applies: isVisual, Component: LutSection },
  { id: 'audio-eq', tab: 'audio', order: 50, applies: isMedia, Component: EqSection },
  { id: 'audio-compressor', tab: 'audio', order: 51, applies: isMedia, Component: CompressorSection },
];

export default sections;
