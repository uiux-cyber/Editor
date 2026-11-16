import { Infinity as InfinityIcon, Shuffle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { designSize } from '@/core/project';
import { TEMPLATES, getTemplate } from '@/library';
import { ASPECT_SIZES, sortCategories, aspectIdFor, buildTemplate, looksPerDesign, shuffleVariation, supportsAspect, templateCount, variationPage, type TemplateVariation } from '@/library/templateEngine';
import type { TemplateCategory } from '@/library/types';
import { useProjectStore } from '@/store/project';
import { applyTemplate } from '../actions';
import { startDrag } from '../dnd';
import { Chips, SearchBox, labelOf, unique } from './common';
import { LiveThumb, templateThumbProject, type ThumbSpec } from './thumbs';

function TemplateTile({ variation, thumbW, thumbH, cw, ch, onShuffle }: { variation: TemplateVariation; thumbW: number; thumbH: number; cw: number; ch: number; onShuffle: () => void }): ReactNode {
  const def = getTemplate(variation.templateId);
  const build = useCallback((): ThumbSpec | null => {
    const built = buildTemplate(variation, cw, ch);
    if (!built) return null;
    const project = templateThumbProject(built.clips, thumbW, thumbH, cw, ch);
    return { project, poster: built.duration * (built.def.poster ?? 0.6), from: 0, to: built.duration };
  }, [variation, cw, ch, thumbW, thumbH]);
  if (!def) return null;
  return (
    <div
      className="tile tile--template"
      title={`${def.name}\nClick to add at the playhead, or drag to the timeline`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
        startDrag(e, { kind: 'template', variation, duration: def.duration }, def.name, () => applyTemplate(variation));
      }}
    >
      <div className="tile__thumb" style={{ aspectRatio: `${thumbW} / ${thumbH}` }}>
        <LiveThumb id={`tpl:${variation.key}:${thumbW}x${thumbH}`} width={thumbW} height={thumbH} build={build} />
        <button type="button" data-no-drag className="tile__action" title="Try another colour & font combination" onClick={onShuffle}>
          <Shuffle size={12} />
        </button>
        <span className="tile__badge mono">{def.duration}s</span>
      </div>
      <div className="tile__label truncate">{def.name}</div>
    </div>
  );
}

export function TemplatesTab(): ReactNode {
  const settings = useProjectStore((s) => s.project.settings);
  const { cw, ch } = designSize(settings);
  const aspect = aspectIdFor(cw, ch);
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);
  const [overrides, setOverrides] = useState<Record<string, TemplateVariation>>({});
  const sentinel = useRef<HTMLDivElement>(null);

  const categories = useMemo(() => sortCategories(unique(TEMPLATES.filter((t) => supportsAspect(t, aspect)).map((t) => t.category))), [aspect]);
  const query = useMemo(() => ({ aspect, category, search }), [aspect, category, search]);
  const count = templateCount(query);

  useEffect(() => {
    setPages(1);
    setOverrides({});
  }, [aspect, category, search]);

  const variations = useMemo(() => {
    const out: TemplateVariation[] = [];
    for (let p = 0; p < pages; p++) out.push(...variationPage(query, p));
    return out;
  }, [query, pages]);

  // Endless feed: every time the end comes into view, generate another page of variations.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || count === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setPages((p) => Math.min(p + 1, 400));
      },
      { rootMargin: '500px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count, pages]);

  // Thumbnails are rendered for the project's own aspect ratio so they show the real layout.
  const size = ASPECT_SIZES[aspect];
  const portrait = size.ch > size.cw;
  const thumbW = portrait ? 216 : 352;
  const thumbH = Math.round((thumbW * size.ch) / size.cw);

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
      <Chips value={category} onChange={setCategory} options={[{ value: 'all' as const, label: 'All' }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]} />
      <div className="lib__scroll">
        {count === 0 ? (
          <div className="empty">
            <div className="empty__title">No templates found</div>
            <p>Try a different search or category.</p>
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
                    onShuffle={() => setOverrides((o) => ({ ...o, [slot]: shuffleVariation(shown) }))}
                  />
                );
              })}
            </div>
            <div ref={sentinel} className="lib__more">
              <span className="spinner" /> Generating more styles…
            </div>
          </>
        )}
      </div>
    </div>
  );
}
