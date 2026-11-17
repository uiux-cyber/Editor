import { Check, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { CAPTION_PRESETS, type CaptionPreset } from '@/core/captionStyles';
import { LANGUAGES } from '@/engine/speech/transcriber';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { Field, Segmented, Select } from '../common/controls';
import { cancelJob, selectedSoundClips } from './actions';
import { useSpeech, type JobKind, type Scope } from './store';

/** Progress of the running speech job (for `kinds`), or a note that another task is busy. */
export function JobStatus({ kinds }: { kinds: JobKind[] }): ReactNode {
  const job = useSpeech((s) => s.job);
  const ref = useRef<HTMLDivElement>(null);
  const mine = !!job && kinds.includes(job.kind);
  // Bring the progress into view when a job starts (tool panels can be taller than the list).
  useEffect(() => {
    if (mine) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [mine, job?.id]);
  if (!job) return null;
  if (!kinds.includes(job.kind)) {
    return <p className="hint sp-busy">{job.label} is running…</p>;
  }
  const pct = job.ratio >= 0 ? Math.round(job.ratio * 100) : null;
  return (
    <div className="sp-job" role="status" data-job={job.kind} ref={ref}>
      <div className="sp-job__row">
        <span className="sp-job__label truncate">{job.detail ?? job.label}</span>
        {pct !== null && <span className="sp-job__pct mono">{pct}%</span>}
        <button type="button" className="icon-btn icon-btn--sm" title="Cancel" onClick={cancelJob} data-action="cancel-job">
          <X size={13} />
        </button>
      </div>
      <div className={`progress ${pct === null ? 'sp-progress--busy' : ''}`}>
        <div className="progress__bar" style={{ width: `${pct ?? 35}%` }} />
      </div>
    </div>
  );
}

export const useBusy = (): boolean => useSpeech((s) => !!s.job);

/** "Selected clips" / "Whole timeline" switch. Falls back to the timeline without a selection. */
export function ScopeSwitch({ value, onChange, label = 'Use' }: { value: Scope; onChange: (s: Scope) => void; label?: string }): ReactNode {
  useUI((s) => s.selection);
  const project = useProjectStore((s) => s.project);
  const count = selectedSoundClips(project).length;
  const effective = value === 'selection' && count === 0 ? 'timeline' : value;
  return (
    <Field label={label}>
      <Segmented
        value={effective}
        style={{ flex: 1 }}
        options={[
          { value: 'selection', label: count ? `Selected (${count})` : 'Selected', title: count ? 'The selected clips with sound' : 'Select clips with sound on the timeline' },
          { value: 'timeline', label: 'Whole timeline', title: 'Everything you hear on the timeline' },
        ]}
        onChange={onChange}
      />
    </Field>
  );
}

export function LanguageField(): ReactNode {
  const language = useSpeech((s) => s.prefs.language);
  const setPrefs = useSpeech((s) => s.setPrefs);
  return (
    <Field label="Language">
      <Select value={language} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} onChange={(v) => setPrefs({ language: v })} />
    </Field>
  );
}

/** Square checkbox matching the app's controls. */
export function CheckBox({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string }): ReactNode {
  return (
    <label className={`sp-check ${checked ? 'is-on' : ''}`} title={title} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sp-check__box">{checked && <Check size={11} strokeWidth={3} />}</span>
      {label !== undefined && <span className="sp-check__label">{label}</span>}
    </label>
  );
}

/** Live mini-render of a caption preset. */
function PresetSample({ preset }: { preset: CaptionPreset }): ReactNode {
  const s = preset.style;
  const fill = s.fill?.type === 'solid' ? s.fill.color : '#ffffff';
  const family = `'${s.fontFamily === 'Inter' ? 'Inter Variable' : s.fontFamily === 'Montserrat' ? 'Montserrat Variable' : s.fontFamily === 'Rubik' ? 'Rubik Variable' : s.fontFamily}'`;
  const stroke = s.stroke ? `${Math.max(1, Math.round(s.stroke.width / 4))}px ${s.stroke.color}` : undefined;
  const words = ['Make', 'it', 'pop'];
  const active = 1;
  return (
    <span
      className="sp-preset__sample"
      style={{
        fontFamily: family,
        fontWeight: s.fontWeight,
        textTransform: s.uppercase ? 'uppercase' : 'none',
        color: fill,
        WebkitTextStroke: stroke,
        paintOrder: 'stroke fill',
        textShadow: s.glow ? `0 0 8px ${s.glow.color}` : s.shadow ? `0 2px 4px ${s.shadow.color.slice(0, 7)}` : undefined,
        background: s.background ? `${s.background.color}${Math.round(s.background.opacity * 255).toString(16).padStart(2, '0')}` : undefined,
        padding: s.background ? '1px 6px' : undefined,
        borderRadius: s.background ? 5 : undefined,
      }}
    >
      {words.map((w, i) => {
        const on = i === active && preset.highlight !== 'none';
        const style: React.CSSProperties = {};
        if (on && (preset.highlight === 'color' || preset.highlight === 'pop')) style.color = preset.highlightColor;
        if (on && preset.highlight === 'pop') style.fontSize = '1.18em';
        if (on && preset.highlight === 'box') Object.assign(style, { background: preset.highlightColor, borderRadius: 4, padding: '0 3px' });
        if (on && preset.highlight === 'underline') Object.assign(style, { textDecoration: `underline ${preset.highlightColor} 3px`, textUnderlineOffset: 4 });
        if (preset.highlight === 'karaoke' && i < active) style.color = preset.highlightColor;
        if (preset.highlight === 'karaoke' && i === active) {
          // The word being sung: half filled.
          return (
            <span key={w}>
              <span style={{ color: preset.highlightColor }}>{w.slice(0, 1)}</span>
              {w.slice(1)}{' '}
            </span>
          );
        }
        return (
          <span key={w} style={style}>
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
}

/** Grid of caption looks. */
export function PresetGrid({ value, onPick }: { value: string | null; onPick: (id: string) => void }): ReactNode {
  return (
    <div className="sp-presets" role="listbox" aria-label="Caption style">
      {CAPTION_PRESETS.map((p) => (
        <button key={p.id} type="button" role="option" aria-selected={value === p.id} className={`sp-preset ${value === p.id ? 'is-active' : ''}`} title={p.description} onClick={() => onPick(p.id)} data-preset={p.id}>
          <span className="sp-preset__stage">
            <PresetSample preset={p} />
          </span>
          <span className="sp-preset__name">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

export const fmtTime = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
