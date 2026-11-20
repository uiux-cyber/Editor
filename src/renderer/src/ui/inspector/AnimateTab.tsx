import { Ban } from 'lucide-react';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { linear, makeShape, makeText } from '@/core/factory';
import type { AnimRef, Clip, ClipAnimations, ID, VisualClip } from '@/core/types';
import { ANIMATIONS, TEXT_ANIMATIONS, getAnimation, getTextAnimation } from '@/library';
import type { AnimKind } from '@/library/types';
import { editClips } from '../actions';
import { Section, Segmented, SliderField } from '../common/controls';
import { tk, tMaybe, useT } from '../i18n';
import { LiveThumb, projectFromLayers, type ThumbSpec } from '../library/thumbs';

const W = 176;
const H = 99;

type Target = 'layer' | 'letters';

const AnimTile = memo(function AnimTile({ id, name, kind, duration, target, active, onPick }: { id: string; name: string; kind: AnimKind; duration: number; target: Target; active: boolean; onPick: () => void }): ReactNode {
  const build = useCallback((): ThumbSpec => {
    const ref: AnimRef = { id, duration };
    const anim: ClipAnimations = { [kind]: ref };
    // Entrances hold on the settled pose, exits start from it, loops play two periods.
    const total = kind === 'loop' ? duration * 2 : duration + 0.9;
    const layer =
      target === 'letters'
        ? makeText('Kinora', { duration: total, textAnim: anim, style: { fontFamily: 'Montserrat', fontWeight: 800, fontSize: 300, fill: linear(20, '#b9a8ff', '#22d3ee') } })
        : makeShape('rect', { duration: total, width: 760, height: 430, radius: 56, fill: linear(135, '#9d85ff', '#22d3ee'), anim });
    const project = projectFromLayers([layer], W, H, '#14161c');
    const poster = kind === 'in' ? duration * 0.55 : kind === 'out' ? 0.9 + duration * 0.45 : duration * 0.25;
    return { project, poster, from: 0, to: total };
  }, [id, kind, duration, target]);
  return (
    <button type="button" className={`anim-tile ${active ? 'is-active' : ''}`} title={name} onClick={onPick}>
      <LiveThumb id={`anim:${target}:${id}`} width={W} height={H} build={build} />
      <span className="truncate">{name}</span>
    </button>
  );
});

const KIND_SETTINGS: Record<AnimKind, string> = { in: tk('In settings'), out: tk('Out settings'), loop: tk('Loop settings') };

export function AnimateTab({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  const t = useT();
  const [kind, setKind] = useState<AnimKind>('in');
  const [target, setTarget] = useState<Target>(clip.type === 'text' ? 'letters' : 'layer');
  const isText = clip.type === 'text';
  const useLetters = isText && target === 'letters';

  const list = useMemo(
    () => (useLetters ? TEXT_ANIMATIONS.filter((a) => a.kind === kind).map((a) => ({ id: a.id, name: a.name, duration: a.duration })) : ANIMATIONS.filter((a) => a.kind === kind).map((a) => ({ id: a.id, name: a.name, duration: a.duration }))),
    [kind, useLetters],
  );

  if (clip.type === 'audio') return null;
  const visual = clip as VisualClip;
  const current: ClipAnimations | undefined = useLetters && clip.type === 'text' ? clip.textAnim : visual.anim;
  const ref = current?.[kind];

  const apply = (next: AnimRef | null): void =>
    editClips(ids, (c) => {
      if (c.type === 'audio') return;
      if (useLetters) {
        if (c.type !== 'text') return;
        const anim = { ...(c.textAnim ?? {}) };
        if (next) anim[kind] = next;
        else delete anim[kind];
        if (Object.keys(anim).length) c.textAnim = anim;
        else delete c.textAnim;
      } else {
        const anim = { ...(c.anim ?? {}) };
        if (next) anim[kind] = next;
        else delete anim[kind];
        if (Object.keys(anim).length) c.anim = anim;
        else delete c.anim;
      }
    });

  const maxDuration = kind === 'loop' ? 10 : Math.max(0.2, Math.min(5, clip.duration));
  const kindLabel = (k: AnimKind): string => (k === 'in' ? t('In', undefined, 'anim') : k === 'out' ? t('Out', undefined, 'anim') : t('Loop'));
  const describe = (k: AnimKind): string => {
    const r = current?.[k];
    if (!r) return t('None');
    return (useLetters ? getTextAnimation(r.id)?.name : getAnimation(r.id)?.name) ?? t('None');
  };

  return (
    <>
      <div className="tab-toolbar">
        {isText && (
          <Segmented
            value={target}
            style={{ width: '100%' }}
            options={[
              { value: 'letters', label: t('Letters & words'), title: t('Animate each letter, word or line') },
              { value: 'layer', label: t('Whole layer'), title: t('Animate the text as one block') },
            ]}
            onChange={setTarget}
          />
        )}
        <Segmented
          value={kind}
          style={{ width: '100%' }}
          options={(['in', 'out', 'loop'] as AnimKind[]).map((k) => ({
            value: k,
            label: (
              <span className="seg-2line">
                <strong>{kindLabel(k)}</strong>
                <small className="truncate">{describe(k)}</small>
              </span>
            ),
          }))}
          onChange={setKind}
        />
      </div>
      {ref && (
        <Section title={tMaybe(KIND_SETTINGS[kind])} id="anim-settings">
          <SliderField
            label={kind === 'loop' ? t('Period') : t('Duration')}
            value={Math.min(ref.duration, maxDuration)}
            min={0.1}
            max={maxDuration}
            step={0.05}
            precision={2}
            suffix="s"
            onChange={(v) => apply({ id: ref.id, duration: v })}
          />
        </Section>
      )}
      <div className="anim-grid">
        <button type="button" className={`anim-tile ${!ref ? 'is-active' : ''}`} onClick={() => apply(null)}>
          <span className="anim-tile__none">
            <Ban size={18} />
          </span>
          <span>{t('None')}</span>
        </button>
        {list.map((a) => (
          <AnimTile key={`${target}:${a.id}`} id={a.id} name={a.name} kind={kind} duration={a.duration} target={useLetters ? 'letters' : 'layer'} active={ref?.id === a.id} onPick={() => apply({ id: a.id, duration: Math.min(a.duration, maxDuration) })} />
        ))}
      </div>
    </>
  );
}
