import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { drawCanvasSticker } from '@/engine/sources/sticker';
import { STICKERS } from '@/library';
import type { CanvasStickerDef, StickerCategory, StickerDef } from '@/library/types';
import { addSticker } from '../actions';
import { startDrag } from '../dnd';
import { Chips, SearchBox, labelOf, unique, useIncremental } from './common';

/** Canvas sticker tile: static poster, plays while hovered. */
const CanvasStickerTile = memo(function CanvasStickerTile({ def }: { def: CanvasStickerDef }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const px = 132;
  const w = Math.round(px * Math.min(def.aspect, 3));
  const h = Math.round(w / def.aspect);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let hovering = false;
    const paint = (t: number): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawCanvasSticker(ctx, def, t, canvas.height, undefined);
    };
    // Poster: a point in the loop where animated stickers usually look complete.
    const poster = (): void => paint(def.animated ? (def.period ?? 1) * 0.3 : 0);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && poster(), { rootMargin: '100px' });
    io.observe(canvas);
    const host = canvas.parentElement ?? canvas;
    const enter = (): void => {
      if (!def.animated || raf) return;
      hovering = true;
      const t0 = performance.now();
      const step = (): void => {
        if (!hovering) {
          raf = 0;
          poster();
          return;
        }
        paint((performance.now() - t0) / 1000);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const leave = (): void => {
      hovering = false;
    };
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
    };
  }, [def]);

  return (
    <button
      type="button"
      className={`sticker-tile ${def.aspect > 1.6 ? 'sticker-tile--wide' : ''}`}
      title={def.name}
      onPointerDown={(e) => startDrag(e, { kind: 'sticker', stickerId: def.id }, def.name, () => addSticker(def.id))}
    >
      <canvas ref={ref} width={w} height={h} />
      {def.animated && <span className="sticker-tile__dot" />}
    </button>
  );
});

const EmojiTile = memo(function EmojiTile({ def }: { def: Extract<StickerDef, { kind: 'emoji' }> }): ReactNode {
  return (
    <button type="button" className="sticker-tile sticker-tile--emoji" title={def.name} onPointerDown={(e) => startDrag(e, { kind: 'sticker', stickerId: def.id }, def.name, () => addSticker(def.id))}>
      <span>{def.char}</span>
    </button>
  );
});

// Vector packs first, emoji afterwards.
const CATEGORY_ORDER: StickerCategory[] = ['animated', 'social', 'callouts', 'badges', 'arrows', 'celebration', 'decor', 'smileys', 'gestures', 'people', 'animals', 'food', 'travel', 'activities', 'objects', 'nature', 'symbols'];

export function StickersTab(): ReactNode {
  const [category, setCategory] = useState<StickerCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const categories = useMemo(() => {
    const present = unique(STICKERS.map((s) => s.category));
    return [...CATEGORY_ORDER.filter((c) => present.includes(c)), ...present.filter((c) => !CATEGORY_ORDER.includes(c))];
  }, []);

  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = STICKERS.filter((s) => {
      if (category !== 'all' && s.category !== category) return false;
      if (!term) return true;
      return s.name.toLowerCase().includes(term) || s.keywords.some((k) => k.includes(term));
    });
    // In the combined view show the designed vector stickers before the emoji set.
    return category === 'all' ? [...filtered.filter((s) => s.kind === 'canvas'), ...filtered.filter((s) => s.kind === 'emoji')] : filtered;
  }, [category, search]);
  const { count, sentinel } = useIncremental(list.length, 120, `${category}|${search}`);
  const shown = list.slice(0, count);
  const canvases = shown.filter((s): s is CanvasStickerDef => s.kind === 'canvas');
  const emoji = shown.filter((s): s is Extract<StickerDef, { kind: 'emoji' }> => s.kind === 'emoji');

  return (
    <div className="lib">
      <header className="lib__head">
        <h3>Stickers</h3>
        <span className="badge">{STICKERS.length.toLocaleString()}</span>
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder="Search stickers & emoji" />
      </div>
      <Chips value={category} onChange={setCategory} options={[{ value: 'all' as const, label: 'All' }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]} />
      <div className="lib__scroll">
        {list.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No stickers found</div>
            <p>Try another word, like “arrow” or “party”.</p>
          </div>
        ) : (
          <>
            {canvases.length > 0 && (
              <div className="grid grid--stickers">
                {canvases.map((s) => (
                  <CanvasStickerTile key={s.id} def={s} />
                ))}
              </div>
            )}
            {emoji.length > 0 && (
              <div className="grid grid--emoji" style={canvases.length ? { marginTop: 10 } : undefined}>
                {emoji.map((s) => (
                  <EmojiTile key={s.id} def={s} />
                ))}
              </div>
            )}
          </>
        )}
        {sentinel}
      </div>
    </div>
  );
}
