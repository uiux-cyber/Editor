import { Clock, FolderOpen, History, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDuration } from '@/core/time';
import { LIBRARY_COUNTS, TEMPLATES, getTemplate } from '@/library';
import { ASPECT_SIZES, hasMorePages, isUserTemplate, sortCategories, supportsAspect, variationPage, type TemplateVariation } from '@/library/templateEngine';
import type { AspectId, TemplateCategory } from '@/library/types';
import { api } from '@/platform/api';
import type { AutosaveEntry, RecentProject } from '@shared/ipc';
import { Chips, labelOf, unique } from '../library/common';
import { LiveThumb, type ThumbSpec } from '../library/thumbs';
import { newProject, openProject, recoverAutosave } from '../projectIO';
import { startProjectFromTemplate, templateThumbSpec } from '../templates/apply';
import { BrandToggle, MusicBadge, MusicToggle, openUserTemplateMenu, useGalleryState } from '../templates/gallery';
import { Logo } from './TitleBar';

export const PROJECT_FORMATS: { id: AspectId | '21:9'; label: string; hint: string; w: number; h: number }[] = [
  { id: '16:9', label: '16:9', hint: 'YouTube · landscape', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16', hint: 'Reels · Shorts · stories', w: 1080, h: 1920 },
  { id: '1:1', label: '1:1', hint: 'Square posts', w: 1080, h: 1080 },
  { id: '4:5', label: '4:5', hint: 'Portrait feed', w: 1080, h: 1350 },
  { id: '21:9', label: '21:9', hint: 'Cinematic', w: 2560, h: 1080 },
];

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
}

function HomeTemplate({ variation, aspect, epoch, onPick }: { variation: TemplateVariation; aspect: AspectId; epoch: number; onPick: () => void }): ReactNode {
  const def = getTemplate(variation.templateId);
  const size = ASPECT_SIZES[aspect];
  const w = size.ch > size.cw ? 216 : 384;
  const h = Math.round((w * size.ch) / size.cw);
  // Includes brand logos and media embedded in the user's own templates (ui/templates).
  const build = useCallback((): ThumbSpec | null => templateThumbSpec(variation, size.cw, size.ch, w, h), [variation, size.cw, size.ch, w, h]);
  if (!def) return null;
  const mine = isUserTemplate(def);
  return (
    <button type="button" className={`home-tpl ${mine ? 'home-tpl--mine' : ''}`} onClick={onPick} title={`Start a project from “${def.name}”`} data-template={def.id} onContextMenu={(e) => mine && openUserTemplateMenu(e, def.id)}>
      <span className="home-tpl__thumb" style={{ aspectRatio: `${w} / ${h}` }}>
        <LiveThumb id={`home:${variation.key}:${epoch}:${aspect}`} width={w} height={h} build={build} />
        <MusicBadge def={def} />
      </span>
      <span className="home-tpl__name truncate">
        {mine && <span className="home-tpl__mine">Mine</span>}
        {def.name}
      </span>
    </button>
  );
}

export function Home(): ReactNode {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [autosaves, setAutosaves] = useState<AutosaveEntry[]>([]);
  const [aspect, setAspect] = useState<AspectId>('16:9');
  const [category, setCategory] = useState<TemplateCategory | 'all' | 'mine'>('all');
  const [pages, setPages] = useState(1);
  const sentinel = useRef<HTMLDivElement>(null);
  // Brand kit, "My templates" and content packs (ui/templates).
  const g = useGalleryState();

  const refresh = useCallback(async (): Promise<void> => {
    const [r, a] = await Promise.all([api.app.getRecent(), api.autosave.list()]);
    setRecent(r);
    // Only offer recovery for work that is not simply the last saved state of a recent file.
    setAutosaves(a.slice(0, 4));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = useMemo(() => sortCategories(unique(TEMPLATES.filter((t) => supportsAspect(t, aspect) && !isUserTemplate(t)).map((t) => t.category))), [aspect, g.libraryVersion]);
  const variations = useMemo(() => {
    const out: TemplateVariation[] = [];
    for (let p = 0; p < pages; p++) out.push(...variationPage({ aspect, category, brand: g.brand }, p));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, category, pages, g.brand, g.brandRevision, g.libraryVersion]);

  useEffect(() => setPages(1), [aspect, category, g.brand]);
  useEffect(() => {
    if (category === 'mine' && g.mineCount === 0) setCategory('all');
  }, [category, g.mineCount]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || variations.length === 0) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setPages((p) => Math.min(p + 1, 300)), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [variations.length, pages]);

  const format = PROJECT_FORMATS.find((f) => f.id === aspect) ?? PROJECT_FORMATS[0];
  const portrait = format.h > format.w;

  return (
    <div className="home">
      <div className="home__inner">
        <section className="home__hero">
          <div className="home__brand">
            <Logo size={44} />
            <div>
              <h1>Kinora</h1>
              <p>Edit, animate and export — all on your GPU.</p>
            </div>
          </div>
          <div className="home__stats">
            <span>
              <strong>{LIBRARY_COUNTS.transitions}</strong> transitions
            </span>
            <span>
              <strong>{LIBRARY_COUNTS.effects + LIBRARY_COUNTS.filters}</strong> effects & filters
            </span>
            <span>
              <strong>{LIBRARY_COUNTS.stickers.toLocaleString()}</strong> stickers
            </span>
            <span>
              <strong>{LIBRARY_COUNTS.textPresets}</strong> text styles
            </span>
            <span>
              <strong>∞</strong> templates
            </span>
          </div>
        </section>

        <section className="home__section">
          <header className="home__head">
            <h2>Start a new project</h2>
            <button type="button" className="btn btn--outline" onClick={() => void openProject()}>
              <FolderOpen size={14} /> Open project…
            </button>
          </header>
          <div className="home__formats">
            {PROJECT_FORMATS.map((f) => (
              <button key={f.id} type="button" className="format-card" onClick={() => void newProject({ width: f.w, height: f.h, fps: 30 })}>
                <span className="format-card__art">
                  <span className="format-card__shape" style={{ width: Math.round(Math.min(150, (86 * f.w) / f.h)), height: Math.round(Math.min(86, (150 * f.h) / f.w)) }}>
                    <Plus size={16} />
                  </span>
                </span>
                <strong>{f.label}</strong>
                <small>{f.hint}</small>
                <small className="mono">
                  {f.w} × {f.h}
                </small>
              </button>
            ))}
          </div>
        </section>

        {autosaves.length > 0 && (
          <section className="home__section">
            <header className="home__head">
              <h2>
                <History size={16} /> Recover unsaved work
              </h2>
            </header>
            <div className="home__recover">
              {autosaves.map((a) => (
                <div key={a.id} className="recover-row">
                  <div className="truncate">
                    <strong>{a.name}</strong>
                    <small>Autosaved {relativeTime(a.savedAt)}</small>
                  </div>
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => void recoverAutosave(a)}>
                    Recover
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    title="Discard this recovery copy"
                    onClick={() => void api.autosave.remove(a.id).then(refresh)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section className="home__section">
            <header className="home__head">
              <h2>
                <Clock size={16} /> Recent projects
              </h2>
            </header>
            <div className="home__recent">
              {recent.slice(0, 10).map((r) => (
                <div key={r.path} className="recent-card" onClick={() => void openProject(r.path)} title={r.path} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && void openProject(r.path)}>
                  <span className="recent-card__thumb">{r.thumbnail ? <img src={r.thumbnail} alt="" draggable={false} /> : <Logo size={26} />}</span>
                  <span className="recent-card__body">
                    <strong className="truncate">{r.name}</strong>
                    <small>
                      {relativeTime(r.openedAt)}
                      {r.duration ? ` · ${formatDuration(r.duration)}` : ''}
                      {r.width && r.height ? ` · ${r.width}×${r.height}` : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm recent-card__remove"
                    title="Remove from this list"
                    onClick={(e) => {
                      e.stopPropagation();
                      void api.app.removeRecent(r.path).then(refresh);
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="home__section">
          <header className="home__head">
            <h2>Start from a template</h2>
            <div className="home__tpl-tools">
              <BrandToggle />
              <MusicToggle />
              <div className="segmented">
                {(['16:9', '9:16', '1:1', '4:5'] as AspectId[]).map((a) => (
                  <button key={a} type="button" className={aspect === a ? 'is-active' : ''} onClick={() => setAspect(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </header>
          <div style={{ margin: '0 -12px 4px' }}>
            <Chips
              value={category}
              onChange={setCategory}
              options={[...(g.mineCount > 0 ? [{ value: 'mine' as const, label: `My templates · ${g.mineCount}` }] : []), { value: 'all' as const, label: 'All' }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]}
            />
          </div>
          <div className={`home__templates ${portrait ? 'is-portrait' : aspect === '1:1' || aspect === '4:5' ? 'is-square' : ''}`}>
            {g.thumbsReady &&
              variations.map((v, i) => (
                <HomeTemplate key={`${i}:${v.key}`} variation={v} aspect={aspect} epoch={g.epoch} onPick={() => void startProjectFromTemplate({ width: format.w, height: format.h, fps: 30 }, v)} />
              ))}
          </div>
          {variations.length === 0 ? (
            <div className="empty">
              <p>No templates for this format yet.</p>
            </div>
          ) : (
            hasMorePages({ aspect, category, brand: g.brand }, pages) && (
              <div ref={sentinel} className="lib__more">
                <span className="spinner" /> Generating more styles…
              </div>
            )
          )}
        </section>
      </div>
    </div>
  );
}
