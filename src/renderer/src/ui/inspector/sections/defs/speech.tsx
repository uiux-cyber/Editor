/**
 * Captions tab of the inspector (caption clips: text clips on the captions track, or any text
 * clip carrying caption data). Edits the caption text, the look (presets), the word highlight
 * and the position — for the selected caption or, with "Apply to all", every caption at once.
 */

import { ChevronLeft, ChevronRight, Download, FileText, Highlighter, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CAPTION_PRESETS, captionY, type CaptionPosition } from '@/core/captionStyles';
import { captionClips } from '@/core/captions';
import { designSize } from '@/core/project';
import { captionTokens } from '@/core/speech';
import { formatSeconds } from '@/core/time';
import type { CaptionHighlight, Clip, TextClip } from '@/core/types';
import { getProject, useProjectStore } from '@/store/project';
import { ColorInput, Field, Section, Segmented, SliderField } from '../../../common/controls';
import { tk, tMaybe, useT } from '../../../i18n';
import {
  applyCaptionPreset,
  captionTargets,
  exportSubtitles,
  gotoCaption,
  importSubtitles,
  setCaptionColor,
  setCaptionFontSize,
  setCaptionHighlight,
  setCaptionPosition,
  setCaptionText,
  setCaptionY,
} from '../../../speech/actions';
import { CheckBox, PresetGrid } from '../../../speech/components';
import { useSpeech } from '../../../speech/store';
import type { InspectorSectionDef, InspectorSectionProps } from '../index';

const isCaption = (clip: Clip): boolean => {
  if (clip.type !== 'text') return false;
  if (clip.caption) return true;
  return getProject().tracks.find((t) => t.id === clip.trackId)?.role === 'captions';
};

/** Labels and tooltips are marked with tk() and shown with tMaybe(). */
const HIGHLIGHTS: { value: CaptionHighlight; label: string; title: string }[] = [
  { value: 'none', label: tk('None'), title: tk('No word highlight') },
  { value: 'color', label: tk('Colour'), title: tk('The spoken word changes colour') },
  { value: 'box', label: tk('Box'), title: tk('A box slides behind the spoken word') },
  { value: 'karaoke', label: tk('Fill'), title: tk('Words fill with colour as they are spoken') },
  { value: 'pop', label: tk('Pop'), title: tk('The spoken word pops bigger') },
  { value: 'underline', label: tk('Line'), title: tk('A bar underlines the spoken word') },
];

const POSITION_LABEL: Record<CaptionPosition, string> = { top: tk('Top'), middle: tk('Middle'), lower: tk('Lower'), bottom: tk('Bottom') };

/** Which preset the caption looks like (font + highlight identify a preset). */
function matchPreset(clip: TextClip): string | null {
  const p = CAPTION_PRESETS.find(
    (x) => x.style.fontFamily === clip.text.fontFamily && (x.style.fontWeight ?? 700) === clip.text.fontWeight && !!x.style.uppercase === clip.text.uppercase && x.highlight === (clip.caption?.highlight ?? 'none') && !!x.style.background === !!clip.text.background,
  );
  return p?.id ?? null;
}

function useTargets(ids: string[]): { targets: string[]; all: boolean; count: number } {
  const all = useSpeech((s) => s.prefs.applyToAll);
  const count = useProjectStore((s) => captionClips(s.project).length);
  return { targets: captionTargets(ids, all), all, count };
}

function ApplyToAll(): ReactNode {
  const t = useT();
  const all = useSpeech((s) => s.prefs.applyToAll);
  const setPrefs = useSpeech((s) => s.setPrefs);
  const count = useProjectStore((s) => captionClips(s.project).length);
  return (
    <div className="sp-applyall">
      <CheckBox checked={all} onChange={(v) => setPrefs({ applyToAll: v })} label={t('{count, plural, one {Apply style changes to all # caption} other {Apply style changes to all # captions}}', { count })} />
    </div>
  );
}

function CaptionTextSection({ clip }: InspectorSectionProps): ReactNode {
  const t = useT();
  const c = clip as TextClip;
  const project = useProjectStore((s) => s.project);
  const list = useMemo(() => captionClips(project), [project]);
  const idx = list.findIndex((x) => x.id === c.id);
  const [draft, setDraft] = useState(c.text.content);
  useEffect(() => setDraft(c.text.content), [c.id, c.text.content]);
  const words = captionTokens(c.text.content).length;
  const timed = c.caption?.words?.length === words;
  return (
    <Section title={t('Caption')} id="caption-text" actions={<span className="mono sp-count">{idx >= 0 ? `${idx + 1} / ${list.length}` : ''}</span>}>
      <textarea
        className="textarea sp-caption-text"
        value={draft}
        rows={3}
        spellCheck
        onChange={(e) => {
          setDraft(e.target.value);
          setCaptionText(c.id, e.target.value);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        data-input="caption-text"
      />
      <div className="sp-row sp-row--between">
        <span className="hint">
          {formatSeconds(c.start)} – {formatSeconds(c.start + c.duration)} · {t('{count, plural, one {# word} other {# words}}', { count: words })}
          {c.caption?.words && !timed ? ` · ${t('re-timed')}` : ''}
        </span>
        <span className="sp-row">
          <button type="button" className="icon-btn icon-btn--sm" title={t('Previous caption')} disabled={idx <= 0} onClick={() => gotoCaption(list[idx - 1].id)}>
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" title={t('Next caption')} disabled={idx < 0 || idx >= list.length - 1} onClick={() => gotoCaption(list[idx + 1].id)}>
            <ChevronRight size={14} />
          </button>
        </span>
      </div>
      <p className="hint">{t('Press Enter for a second line. Keeping the same number of words keeps the word timing.')}</p>
    </Section>
  );
}

function CaptionStyleSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const t = useT();
  const c = clip as TextClip;
  const { targets } = useTargets(ids);
  const fill = c.text.fill.type === 'solid' ? c.text.fill.color : '#ffffff';
  return (
    <Section title={t('Style')} id="caption-style">
      <ApplyToAll />
      <PresetGrid value={matchPreset(c)} onPick={(id) => applyCaptionPreset(id, targets)} />
      <SliderField label={t('Size')} value={c.text.fontSize} min={20} max={200} step={1} defaultValue={76} onChange={(v) => setCaptionFontSize(targets, Math.round(v))} />
      <Field label={t('Text')}>
        <ColorInput value={fill} swatches onChange={(v) => setCaptionColor(targets, v)} />
      </Field>
    </Section>
  );
}

function CaptionHighlightSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const t = useT();
  const c = clip as TextClip;
  const { targets } = useTargets(ids);
  const mode = c.caption?.highlight ?? 'none';
  return (
    <Section title={<span className="sp-title"><Highlighter size={12} /> {t('Word highlight')}</span>} id="caption-highlight">
      <div className="sp-highlights">
        {HIGHLIGHTS.map((h) => (
          <button key={h.value} type="button" className={`chip ${mode === h.value ? 'is-active' : ''}`} title={tMaybe(h.title)} onClick={() => setCaptionHighlight(targets, { highlight: h.value })} data-highlight={h.value}>
            {tMaybe(h.label)}
          </button>
        ))}
      </div>
      {mode !== 'none' && (
        <Field label={t('Colour')}>
          <ColorInput value={c.caption?.highlightColor ?? '#ffd84d'} swatches onChange={(v) => setCaptionHighlight(targets, { highlightColor: v.slice(0, 7) })} />
        </Field>
      )}
      <p className="hint">{mode === 'none' ? t('Highlight each word as it is spoken — the timing comes from the transcription.') : t('Play the timeline to see the highlight follow the voice.')}</p>
    </Section>
  );
}

function CaptionPositionSection({ clip, ids }: InspectorSectionProps): ReactNode {
  const t = useT();
  const c = clip as TextClip;
  const { targets } = useTargets(ids);
  const settings = useProjectStore((s) => s.project.settings);
  const { ch } = designSize(settings);
  const positions: CaptionPosition[] = ['top', 'middle', 'lower', 'bottom'];
  const current = positions.find((p) => Math.abs(captionY(settings, p) - c.transform.y) < 2) ?? null;
  return (
    <Section title={t('Position')} id="caption-position">
      <Segmented
        value={current ?? ('custom' as CaptionPosition)}
        style={{ width: '100%' }}
        options={positions.map((p) => ({ value: p, label: tMaybe(POSITION_LABEL[p]) }))}
        onChange={(v) => setCaptionPosition(targets, v)}
      />
      <SliderField label={t('Height')} value={c.transform.y} min={-ch / 2} max={ch / 2} step={1} defaultValue={captionY(settings, 'lower')} onChange={(v) => setCaptionY(targets, Math.round(v))} />
    </Section>
  );
}

function SubtitleFilesSection(): ReactNode {
  const t = useT();
  return (
    <Section title={<span className="sp-title"><FileText size={12} /> {t('Subtitle files')}</span>} id="caption-files" defaultOpen={false}>
      <div className="sp-row">
        <button type="button" className="btn btn--outline btn--sm" style={{ flex: 1 }} onClick={() => void importSubtitles()}>
          <Upload size={12} /> {t('Import')}
        </button>
        <button type="button" className="btn btn--outline btn--sm" style={{ flex: 1 }} onClick={() => void exportSubtitles('srt')}>
          <Download size={12} /> SRT
        </button>
        <button type="button" className="btn btn--outline btn--sm" style={{ flex: 1 }} onClick={() => void exportSubtitles('vtt')}>
          <Download size={12} /> VTT
        </button>
      </div>
    </Section>
  );
}

const sections: InspectorSectionDef[] = [
  { id: 'speech.caption-text', tab: 'captions', tabLabel: tk('Captions'), order: 10, applies: isCaption, Component: CaptionTextSection },
  { id: 'speech.caption-style', tab: 'captions', order: 20, applies: isCaption, Component: CaptionStyleSection },
  { id: 'speech.caption-highlight', tab: 'captions', order: 30, applies: isCaption, Component: CaptionHighlightSection },
  { id: 'speech.caption-position', tab: 'captions', order: 40, applies: isCaption, Component: CaptionPositionSection },
  { id: 'speech.caption-files', tab: 'captions', order: 50, applies: isCaption, Component: SubtitleFilesSection },
];

export default sections;

