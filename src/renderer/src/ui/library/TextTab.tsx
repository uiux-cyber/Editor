import { Type } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_TEXT_STYLE, makeText } from '@/core/factory';
import { measureTextBlock } from '@/engine/sources/text';
import { TEXT_PRESETS } from '@/library';
import type { TextPresetCategory, TextPresetDef } from '@/library/types';
import { addText } from '../actions';
import { startDrag } from '../dnd';
import { useT } from '../i18n';
import { Chips, SearchBox, labelOf, unique, useIncremental } from './common';
import { LiveThumb, projectFromLayers, type ThumbSpec } from './thumbs';

const THUMB_W = 336;
const THUMB_H = 190;

/** Perceived brightness of a solid colour, 0..1. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 1;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function PresetTile({ preset }: { preset: TextPresetDef }): ReactNode {
  const t = useT();
  const build = useCallback((): ThumbSpec | null => {
    const style = { ...DEFAULT_TEXT_STYLE, ...preset.style, content: preset.sample };
    // The demo frame is 1920×1080 design px: scale the text so it fills the tile nicely.
    const size = measureTextBlock(style);
    const scale = Math.min(2.2, (1920 * 0.8) / Math.max(1, size.width), (1080 * 0.62) / Math.max(1, size.height));
    const duration = 3.2;
    const clip = makeText(preset.sample, { duration, style: preset.style, anim: preset.anim, textAnim: preset.textAnim, scale });
    if (preset.counter) clip.counter = { ...preset.counter, duration: Math.min(preset.counter.duration ?? duration, duration * 0.55) };
    // Dark text without a box needs a light backdrop to be readable.
    const dark = style.fill.type === 'solid' && !style.background && !style.stroke && !style.glow && luminance(style.fill.color) < 0.3;
    const project = projectFromLayers([clip], THUMB_W, THUMB_H, dark ? '#e8e9ee' : '#14161c');
    return { project, poster: duration * 0.62, from: 0, to: duration };
  }, [preset]);
  return (
    <div
      className="tile"
      title={`${preset.name}\n${t('Click to add at the playhead, or drag to the timeline')}`}
      onPointerDown={(e) => startDrag(e, { kind: 'text', presetId: preset.id }, preset.name, () => addText(preset.id))}
    >
      <div className="tile__thumb" style={{ aspectRatio: `${THUMB_W} / ${THUMB_H}` }}>
        <LiveThumb id={`txt:${preset.id}`} width={THUMB_W} height={THUMB_H} build={build} animate={!!(preset.anim || preset.textAnim || preset.counter)} />
      </div>
      <div className="tile__label truncate">{preset.name}</div>
    </div>
  );
}

export function TextTab(): ReactNode {
  const t = useT();
  const [category, setCategory] = useState<TextPresetCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const categories = useMemo(() => unique(TEXT_PRESETS.map((p) => p.category)), []);
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return TEXT_PRESETS.filter((p) => (category === 'all' || p.category === category) && (!term || p.name.toLowerCase().includes(term) || p.category.includes(term)));
  }, [category, search]);
  const { count, sentinel } = useIncremental(list.length, 24, `${category}|${search}`);

  return (
    <div className="lib">
      <header className="lib__head">
        <h3>{t('Text')}</h3>
        <button type="button" className="btn btn--primary btn--sm" onPointerDown={(e) => startDrag(e, { kind: 'text', presetId: null }, t('Text'), () => addText(null))}>
          <Type size={13} /> {t('Add text')}
        </button>
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder={t('Search text styles')} />
      </div>
      <Chips value={category} onChange={setCategory} options={[{ value: 'all' as const, label: t('All') }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]} />
      <div className="lib__scroll">
        {list.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('No styles found')}</div>
          </div>
        ) : (
          <div className="grid grid--2">
            {list.slice(0, count).map((p) => (
              <PresetTile key={p.id} preset={p} />
            ))}
          </div>
        )}
        {sentinel}
      </div>
    </div>
  );
}
