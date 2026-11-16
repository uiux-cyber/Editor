import { Infinity as InfinityIcon, MoreHorizontal, Shuffle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { designSize } from '@/core/project';
import { TEMPLATES, getTemplate } from '@/library';
import { ASPECT_SIZES, sortCategories, aspectIdFor, isUserTemplate, looksPerDesign, shuffleVariation, supportsAspect, templateCount, variationPage, type TemplateVariation } from '@/library/templateEngine';
import { useProjectStore } from '@/store/project';
import { applyTemplate } from '../actions';
import { startDrag } from '../dnd';
// Templates & branding (my templates, brand kit, music, packs) — see ui/templates/.
import { GalleryToolbar, MusicBadge, SaveSelectionBanner, openUserTemplateMenu, useGalleryState } from '../templates/gallery';
import { templateThumbSpec } from '../templates/apply';
import { Chips, SearchBox, labelOf, unique } from './common';
import { LiveThumb, type ThumbSpec } from './thumbs';

function TemplateTile({ variation, thumbW, thumbH, cw, ch, epoch, onShuffle }: { variation: TemplateVariation; thumbW: number; thumbH: number; cw: number; ch: number; epoch: number; onShuffle: () => void }): ReactNode {
  const def = getTemplate(variation.templateId);
  const build = useCallback((): ThumbSpec | null => templateThumbSpec(variation, cw, ch, thumbW, thumbH), [variation, cw, ch, thumbW, thumbH]);
  if (!def) return null;
  const mine = isUserTemplate(def);
  return (
    <div
      className={`tile tile--template ${mine ? 'tile--mine' : ''}`}
      title={`${def.name}\nClick to add at the playhead, or drag to the timeline`}
      data-template={def.id}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
        startDrag(e, { kind: 'template', variation, duration: def.duration }, def.name, () => applyTemplate(variation));
      }}
      onContextMenu={(e) => mine && openUserTemplateMenu(e, def.id)}
    >
      <div className="tile__thumb" style={{ aspectRatio: `${thumbW} / ${thumbH}` }}>
        <LiveThumb id={`tpl:${variation.key}:${epoch}:${thumbW}x${thumbH}`} width={thumbW} height={thumbH} build={build} />
        {mine ? (
          <button type="button" data-no-drag className="tile__action" title="Rename, duplicate or delete" onClick={(e) => openUserTemplateMenu(e, def.id)}>
            <MoreHorizontal size={13} />
          </button>
        ) : (
          !def.fixed && (
            <button type="button" data-no-drag className="tile__action" title="Try another colour & font combination" onClick={onShuffle}>
              <Shuffle size={12} />
            </button>
          )
        )}
        <span className="tile__badge mono">{Math.round(def.duration * 10) / 10}s</span>
        <MusicBadge def={def} />
      </div>
      <div className="tile__label truncate">{def.name}</div>
    </div>
  );
}

export function TemplatesTab(): ReactNode {
  const settings = useProjectStore((s) => s.project.settings);
  const { cw, ch } = designSize(settings);
  const aspect = aspectIdFor(cw, ch);
  const g = useGalleryState();
  const category = g.category;
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);
  const [overrides, setOverrides] = useState<Record<string, TemplateVariation>>({});
  const sentinel = useRef<HTMLDivElement>(null);

  const categories = useMemo(() => sortCategories(unique(TEMPLATES.filter((t) => supportsAspect(t, aspect) && !isUserTemplate(t)).map((t) => t.category))), [aspect, g.libraryVersion]);
  const query = useMemo(() => ({ aspect, category, search, brand: g.brand }), [aspect, category, search, g.brand]);
  const count = templateCount(query);

  useEffect(() => {
    setPages(1);
    setOverrides({});
  }, [aspect, category, search, g.brand, g.libraryVersion, g.brandRevision]);

  const variations = useMemo(() => {
    const out: TemplateVariation[] = [];
    for (let p = 0; p < pages; p++) out.push(...variationPage(query, p));
    return out;
    // The library version and brand revision change what the pages contain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pages, g.libraryVersion, g.brandRevision]);

  // Endless feed: every time the end comes into view, generate another page of variations.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || count === 0 || category === 'mine') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setPages((p) => Math.min(p + 1, 400));
      },
      { rootMargin: '500px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count, pages, category]);

  // Thumbnails are rendered for the project's own aspect ratio so they show the real layout.
  const size = ASPECT_SIZES[aspect];
  const portrait = size.ch > size.cw;
  const thumbW = portrait ? 216 : 352;
  const thumbH = Math.round((thumbW * size.ch) / size.cw);
  const chipOptions = [
    ...(g.mineCount > 0 ? [{ value: 'mine' as const, label: `My templates · ${g.mineCount}` }] : []),
    { value: 'all' as const, label: 'All' },
    ...categories.map((c) => ({ value: c, label: labelOf(c) })),
  ];

  return (
    <div className="lib">
      <header className="lib__head">
        <h3>Templates</h3>
        <span className="badge badge--accent" title={`${count} designs × ${looksPerDesign()} colour and type combinations, generated endlessly as you scroll`}>
          <InfinityIcon size={12} style={{ marginRight: 4 }} /> Endless
        </span>
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder="Search templates" />
      </div>
      <GalleryToolbar />
      <Chips value={category} onChange={g.setCategory} options={chipOptions} />
      <div className="lib__scroll">
        <SaveSelectionBanner />
        {!g.thumbsReady ? (
          <div className="lib__more">
            <span className="spinner" /> Loading your brand…
          </div>
        ) : count === 0 ? (
          <div className="empty">
            <div className="empty__title">{category === 'mine' ? 'No saved templates yet' : 'No templates found'}</div>
            <p>{category === 'mine' ? 'Select layers on the timeline and choose “Save as template…” to reuse them.' : 'Try a different search or category.'}</p>
          </div>
        ) : (
          <>
            <div className={`grid ${portrait ? 'grid--3' : 'grid--2'}`}>
              {variations.map((v, i) => {
                const slot = `${i}`;
                const shown = overrides[slot] ?? v;
                return (
                  <TemplateTile
                    key={`${slot}:${shown.key}`}
                    variation={shown}
                    thumbW={thumbW}
                    thumbH={thumbH}
                    cw={cw}
                    ch={ch}
                    epoch={g.epoch}
                    onShuffle={() => setOverrides((o) => ({ ...o, [slot]: shuffleVariation(shown) }))}
                  />
                );
              })}
            </div>
            {category !== 'mine' && (
              <div ref={sentinel} className="lib__more">
                <span className="spinner" /> Generating more styles…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
