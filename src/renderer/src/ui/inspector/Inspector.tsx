import { Blend, Film, Image as ImageIcon, Layers, Music, Shapes, Smile, Sparkles, Trash2, Type, Unlink, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { designSize, maxTransitionDuration, projectDuration } from '@/core/project';
import { formatSeconds, formatTimecode } from '@/core/time';
import type { Clip, ID, Transition } from '@/core/types';
import { TRANSITIONS, getTransition } from '@/library';
import { updateProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { detachAudioFromSelection, editClips, removeTransition } from '../actions';
import { ColorInput, Field, NumberInput, Section, Select, SliderField, Toggle } from '../common/controls';
import { tk, tMaybe, useT } from '../i18n';
import { writeProp } from '../keyframeOps';
import { AdjustTab, EffectsTab } from './AdjustTab';
import { AnimateTab } from './AnimateTab';
import { EditTab } from './EditTab';
import { extraTabsFor, sectionsFor } from './sections';
import { KeyframeButton, ParamControls, rich, useLiveProp } from './shared';

/** Built-in tabs plus any extra tab contributed by a registered section. */
type TabId = string;

const TYPE_META: Record<Clip['type'], { label: string; icon: ReactNode }> = {
  video: { label: tk('Video'), icon: <Film size={14} /> },
  image: { label: tk('Image'), icon: <ImageIcon size={14} /> },
  audio: { label: tk('Audio'), icon: <Music size={14} /> },
  text: { label: tk('Text'), icon: <Type size={14} /> },
  sticker: { label: tk('Sticker'), icon: <Smile size={14} /> },
  shape: { label: tk('Shape'), icon: <Shapes size={14} /> },
  generator: { label: tk('Background'), icon: <Sparkles size={14} /> },
  adjustment: { label: tk('Adjustment'), icon: <Layers size={14} /> },
  compound: { label: tk('Compound'), icon: <Layers size={14} /> },
};

// ---------------------------------------------------------------------------------------------
// Audio (speed, ramps, reverse and freeze live in the Speed tab: sections/defs/time.tsx)
// ---------------------------------------------------------------------------------------------

function AudioPanel({ clip, ids }: { clip: Extract<Clip, { type: 'video' | 'audio' }>; ids: ID[] }): ReactNode {
  const t = useT();
  const asset = useProjectStore((s) => s.project.assets[clip.assetId]);
  const volume = useLiveProp(clip, 'volume');
  const editMedia = (recipe: (c: Extract<Clip, { type: 'video' | 'audio' }>) => void): void =>
    editClips(ids, (c) => {
      if (c.type === 'video' || c.type === 'audio') recipe(c);
    });
  const hasSound = !!asset?.hasAudio;
  const maxFade = Math.max(0, clip.duration / 2);
  return (
    <>
      <Section title={t('Volume')} id="volume">
        {!hasSound ? (
          <p className="hint">{t('This clip has no audio track.')}</p>
        ) : (
          <>
            <SliderField
              label={t('Volume')}
              value={volume}
              min={0}
              max={2}
              step={0.01}
              scale={100}
              suffix="%"
              defaultValue={1}
              disabled={clip.muted}
              onChange={(v) => editClips(ids, (c) => writeProp(c, 'volume', v))}
              lead={<KeyframeButton clip={clip} ids={ids} props={['volume']} />}
            />
            <Field label={t('Mute')}>
              <Toggle value={clip.muted} onChange={(v) => editMedia((c) => void (c.muted = v))} />
              {clip.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </Field>
            <SliderField label={t('Fade in')} value={Math.min(clip.fadeIn, maxFade)} min={0} max={Math.min(10, maxFade)} step={0.05} precision={2} suffix="s" defaultValue={0} onChange={(v) => editMedia((c) => void (c.fadeIn = v))} />
            <SliderField label={t('Fade out')} value={Math.min(clip.fadeOut, maxFade)} min={0} max={Math.min(10, maxFade)} step={0.05} precision={2} suffix="s" defaultValue={0} onChange={(v) => editMedia((c) => void (c.fadeOut = v))} />
            {clip.type === 'video' && (
              <button type="button" className="btn btn--sm btn--outline btn--block" onClick={detachAudioFromSelection} title={t("Move this clip's sound to its own audio clip")}>
                <Unlink size={13} /> {t('Detach audio')}
              </button>
            )}
          </>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------------------------

function TransitionPanel({ transition }: { transition: Transition }): ReactNode {
  const tr = useT();
  const from = useProjectStore((s) => s.project.clips[transition.fromId]);
  const to = useProjectStore((s) => s.project.clips[transition.toId]);
  const def = getTransition(transition.type);
  const max = from && to ? Math.max(0.1, maxTransitionDuration(from, to)) : 2;
  const edit = (recipe: (t: Transition) => void, coalesce?: string): void =>
    updateProject(
      (p) => {
        const t = p.transitions[transition.id];
        if (t) recipe(t);
      },
      coalesce ? { coalesce } : undefined,
    );
  return (
    <div className="inspector__scroll">
      <header className="inspector__title">
        <span className="inspector__type">
          <Blend size={14} /> {tr('Transition')}
        </span>
        <button type="button" className="icon-btn icon-btn--sm" title={tr('Remove transition')} onClick={() => removeTransition(transition.id)}>
          <Trash2 size={13} />
        </button>
      </header>
      <Section title={tr('Transition')} id="transition">
        <Field label={tr('Style')}>
          <Select
            value={transition.type}
            options={TRANSITIONS.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(type) =>
              edit((t) => {
                t.type = type;
                t.params = {};
              })
            }
          />
        </Field>
        <SliderField label={tr('Duration')} value={Math.min(transition.duration, max)} min={0.1} max={max} step={0.05} precision={2} suffix="s" defaultValue={def?.duration ?? 0.6} onChange={(v) => edit((t) => void (t.duration = v))} />
        <button type="button" className="btn btn--sm btn--outline btn--block" onClick={() => useUI.getState().setLibraryTab('transitions')}>
          {tr('Browse all transitions')}
        </button>
      </Section>
      {def && def.params && def.params.length > 0 && (
        <Section title={tr('Settings')} id="transition-settings">
          <ParamControls defs={def.params} values={transition.params} onChange={(key, value) => edit((t) => void (t.params[key] = value))} />
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Project (nothing selected)
// ---------------------------------------------------------------------------------------------

const FORMATS: { label: string; hint: string; w: number; h: number }[] = [
  { label: '16:9', hint: tk('Landscape'), w: 1920, h: 1080 },
  { label: '9:16', hint: tk('Vertical'), w: 1080, h: 1920 },
  { label: '1:1', hint: tk('Square'), w: 1080, h: 1080 },
  { label: '4:5', hint: tk('Portrait'), w: 1080, h: 1350 },
  { label: '21:9', hint: tk('Cinema'), w: 2560, h: 1080 },
  { label: '4K', hint: tk('UHD'), w: 3840, h: 2160 },
];

function ProjectPanel(): ReactNode {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const { settings } = project;
  const { cw, ch } = designSize(settings);
  const clipCount = Object.keys(project.clips).length;
  const set = (patch: Partial<typeof settings>, coalesce?: string): void => updateProject((p) => void Object.assign(p.settings, patch), coalesce ? { coalesce } : undefined);
  return (
    <div className="inspector__scroll">
      <header className="inspector__title">
        <span className="inspector__type">
          <Film size={14} /> {t('Project')}
        </span>
      </header>
      <Section title={t('Details')} id="project">
        <Field label={t('Name')}>
          <input className="input" value={project.name} spellCheck={false} onChange={(e) => updateProject((p) => void (p.name = e.target.value), { coalesce: 'project-name' })} onKeyDown={(e) => e.stopPropagation()} />
        </Field>
        <Field label={t('Duration')}>
          <span className="mono" style={{ color: 'var(--text-0)' }}>
            {formatTimecode(projectDuration(project), settings.fps)}
          </span>
          <span style={{ color: 'var(--text-3)' }}>
            {t('{count, plural, one {# clip} other {# clips}}', { count: clipCount })}
          </span>
        </Field>
      </Section>
      <Section title={t('Format')} id="format">
        <div className="format-grid">
          {FORMATS.map((f) => {
            const active = settings.width === f.w && settings.height === f.h;
            return (
              <button key={f.label} type="button" className={`format-tile ${active ? 'is-active' : ''}`} onClick={() => set({ width: f.w, height: f.h })} title={`${f.w} × ${f.h}`}>
                <span className="format-tile__shape" style={{ aspectRatio: `${f.w} / ${f.h}` }} />
                <strong>{f.label}</strong>
                <small>{tMaybe(f.hint)}</small>
              </button>
            );
          })}
        </div>
        <Field label={t('Resolution')}>
          <NumberInput prefix="W" value={settings.width} min={16} max={7680} step={2} onChange={(v) => set({ width: Math.round(v / 2) * 2 })} />
          <NumberInput prefix="H" value={settings.height} min={16} max={7680} step={2} onChange={(v) => set({ height: Math.round(v / 2) * 2 })} />
        </Field>
        <Field label={t('Frame rate')}>
          <Select
            value={settings.fps}
            options={[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => ({ value: f, label: `${f} fps` }))}
            onChange={(fps) => set({ fps })}
          />
        </Field>
        <Field label={t('Background')}>
          <ColorInput value={settings.background} onChange={(v) => set({ background: v.slice(0, 7) })} />
        </Field>
        <p className="hint">
          {t('Layout is resolution-independent: switching between sizes of the same shape keeps everything in place. Canvas: {width} × {height} design px.', { width: String(Math.round(cw)), height: String(Math.round(ch)) })}
        </p>
      </Section>
      <Section title={t('Tips')} id="tips" defaultOpen={clipCount === 0}>
        <ul className="tips">
          <li>{t('Click any library item to add it at the playhead, or drag it onto the timeline.')}</li>
          <li>
            {rich(t('Press {splitKey} to split, {deleteKey} to delete, {playKey} to play.'), {
              splitKey: <span className="kbd">S</span>,
              deleteKey: <span className="kbd">{t('Del', undefined, 'key')}</span>,
              playKey: <span className="kbd">{t('Space', undefined, 'key')}</span>,
            })}
          </li>
          <li>{t('Drag a transition between two clips that touch on the same track.')}</li>
          <li>{t('Select a clip to edit, animate and grade it here.')}</li>
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------------------------

export function Inspector(): ReactNode {
  const tr = useT();
  const selection = useUI((s) => s.selection);
  const transitionId = useUI((s) => s.selectedTransition);
  const clips = useProjectStore((s) => s.project.clips);
  const transition = useProjectStore((s) => (transitionId ? s.project.transitions[transitionId] : undefined));
  const [tab, setTab] = useState<TabId>('edit');

  const selected = selection.map((id) => clips[id]).filter(Boolean);
  const primary = selected[0];
  const type = primary?.type;

  const tabs: { id: TabId; label: string }[] = !primary
    ? []
    : type === 'audio'
      ? [{ id: 'audio', label: tr('Audio') }]
      : [
          { id: 'edit', label: tMaybe(TYPE_META[primary.type].label) },
          ...(type !== 'adjustment' ? [{ id: 'animate' as const, label: tr('Animate') }] : []),
          { id: 'adjust', label: tr('Adjust') },
          { id: 'effects', label: tr('Effects') },
          ...(type === 'video' ? [{ id: 'audio' as const, label: tr('Audio') }] : []),
        ];
  if (primary) tabs.push(...extraTabsFor(primary));
  const active = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? 'edit');

  // When the selection changes type, land on the first tab that exists for it.
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  if (transition) {
    return (
      <aside className="inspector">
        <TransitionPanel transition={transition} />
      </aside>
    );
  }
  if (!primary) {
    return (
      <aside className="inspector">
        <ProjectPanel />
      </aside>
    );
  }

  // Edits apply to every selected clip of the same type as the primary one.
  const ids = selected.filter((c) => c.type === primary.type).map((c) => c.id);
  const meta = TYPE_META[primary.type];
  const fx = primary.type !== 'audio' ? primary.effects.length : 0;

  return (
    <aside className="inspector">
      <header className="inspector__title">
        <span className="inspector__type">
          {meta.icon}
          <span className="truncate">{selected.length > 1 ? tr('{count, plural, one {# clip selected} other {# clips selected}}', { count: selected.length }) : (primary.type === 'text' ? primary.text.content.split(/\r?\n/)[0].trim() : primary.name) || tMaybe(meta.label)}</span>
        </span>
        <span className="mono inspector__dur">{formatSeconds(primary.duration)}</span>
      </header>
      {tabs.length > 1 && (
        <nav className="tabs">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={`tabs__tab ${active === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'effects' && fx > 0 && <span className="tabs__count">{fx}</span>}
            </button>
          ))}
        </nav>
      )}
      <div className="inspector__scroll" key={`${primary.id}:${active}`}>
        {sectionsFor(primary, active, 'top').map((s) => (
          <s.Component key={s.id} clip={primary} ids={ids} />
        ))}
        {active === 'edit' && <EditTab clip={primary} ids={ids} />}
        {active === 'animate' && <AnimateTab clip={primary} ids={ids} />}
        {active === 'adjust' && <AdjustTab clip={primary} ids={ids} />}
        {active === 'effects' && <EffectsTab clip={primary} ids={ids} />}
        {active === 'audio' && (primary.type === 'video' || primary.type === 'audio') && <AudioPanel clip={primary} ids={ids} />}
        {sectionsFor(primary, active).map((s) => (
          <s.Component key={s.id} clip={primary} ids={ids} />
        ))}
      </div>
    </aside>
  );
}
