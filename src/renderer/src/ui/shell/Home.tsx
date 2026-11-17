import { Clock, FolderOpen, History, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDuration } from '@/core/time';
import { LIBRARY_COUNTS, TEMPLATES, getTemplate } from '@/library';
import { ASPECT_SIZES, sortCategories, buildTemplate, supportsAspect, variationPage, type TemplateVariation } from '@/library/templateEngine';
import type { AspectId, TemplateCategory } from '@/library/types';
import { api } from '@/platform/api';
import type { AutosaveEntry, RecentProject } from '@shared/ipc';
import { formatNumber, formatRelative, useT } from '../i18n';
import { Chips, labelOf, unique } from '../library/common';
import { LiveThumb, templateThumbProject, type ThumbSpec } from '../library/thumbs';
import { newProject, openProject, recoverAutosave } from '../projectIO';
import { useSetting } from '../settings/store';
import { Logo } from './TitleBar';

/** `hint` is an English source string (translated where shown). */
export const PROJECT_FORMATS: { id: AspectId | '21:9'; label: string; hint: string; w: number; h: number }[] = [
  { id: '16:9', label: '16:9', hint: 'YouTube · landscape', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16', hint: 'Reels · Shorts · stories', w: 1080, h: 1920 },
  { id: '1:1', label: '1:1', hint: 'Square posts', w: 1080, h: 1080 },
  { id: '4:5', label: '4:5', hint: 'Portrait feed', w: 1080, h: 1350 },
  { id: '21:9', label: '21:9', hint: 'Cinematic', w: 2560, h: 1080 },
];

function HomeTemplate({ variation, aspect, onPick }: { variation: TemplateVariation; aspect: AspectId; onPick: () => void }): ReactNode {
  const t = useT();
  const def = getTemplate(variation.templateId);
  const size = ASPECT_SIZES[aspect];
  const w = size.ch > size.cw ? 216 : 384;
  const h = Math.round((w * size.ch) / size.cw);
  const build = useCallback((): ThumbSpec | null => {
    const built = buildTemplate(variation, size.cw, size.ch);
    if (!built) return null;
    return { project: templateThumbProject(built.clips, w, h, size.cw, size.ch), poster: built.duration * (built.def.poster ?? 0.6), from: 0, to: built.duration };
  }, [variation, size.cw, size.ch, w, h]);
  if (!def) return null;
  return (
    <button type="button" className="home-tpl" onClick={onPick} title={t('Start a project from “{name}”', { name: def.name })}>
      <span className="home-tpl__thumb" style={{ aspectRatio: `${w} / ${h}` }}>
        <LiveThumb id={`home:${variation.key}:${aspect}`} width={w} height={h} build={build} />
      </span>
      <span className="home-tpl__name truncate">{def.name}</span>
    </button>
  );
}

export function Home(): ReactNode {
  const t = useT();
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [autosaves, setAutosaves] = useState<AutosaveEntry[]>([]);
  const [aspect, setAspect] = useState<AspectId>('16:9');
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all');
  const [pages, setPages] = useState(1);
  // Settings → General → frame rate for new projects.
  const [fps] = useSetting<number>('general.defaultFps', 30);
  const sentinel = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [r, a] = await Promise.all([api.app.getRecent(), api.autosave.list()]);
    setRecent(r);
    // Only offer recovery for work that is not simply the last saved state of a recent file.
    setAutosaves(a.slice(0, 4));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = useMemo(() => sortCategories(unique(TEMPLATES.filter((tp) => supportsAspect(tp, aspect)).map((tp) => tp.category))), [aspect]);
  const variations = useMemo(() => {
    const out: TemplateVariation[] = [];
    for (let p = 0; p < pages; p++) out.push(...variationPage({ aspect, category }, p));
    return out;
  }, [aspect, category, pages]);

  useEffect(() => setPages(1), [aspect, category]);

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
              <p>{t('Edit, animate and export — all on your GPU.')}</p>
            </div>
          </div>
          <div className="home__stats">
            <span>
              <strong>{formatNumber(LIBRARY_COUNTS.transitions)}</strong> {t('transitions')}
            </span>
            <span>
              <strong>{formatNumber(LIBRARY_COUNTS.effects + LIBRARY_COUNTS.filters)}</strong> {t('effects & filters')}
            </span>
            <span>
              <strong>{formatNumber(LIBRARY_COUNTS.stickers)}</strong> {t('stickers')}
            </span>
            <span>
              <strong>{formatNumber(LIBRARY_COUNTS.textPresets)}</strong> {t('text styles')}
            </span>
            <span>
              <strong>∞</strong> {t('templates')}
            </span>
          </div>
        </section>

        <section className="home__section" aria-labelledby="home-new">
          <header className="home__head">
            <h2 id="home-new">{t('Start a new project')}</h2>
            <button type="button" className="btn btn--outline" onClick={() => void openProject()}>
              <FolderOpen size={14} /> {t('Open project…')}
            </button>
          </header>
          <div className="home__formats">
            {PROJECT_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="format-card"
                aria-label={t('New {format} project, {width} × {height}', { format: f.label, width: f.w, height: f.h })}
                onClick={() => void newProject({ width: f.w, height: f.h, fps })}
              >
                <span className="format-card__art" aria-hidden="true">
                  <span className="format-card__shape" style={{ width: Math.round(Math.min(150, (86 * f.w) / f.h)), height: Math.round(Math.min(86, (150 * f.h) / f.w)) }}>
                    <Plus size={16} />
                  </span>
                </span>
                <strong>{f.label}</strong>
                <small>{t(f.hint)}</small>
                <small className="mono">
                  {f.w} × {f.h}
                </small>
              </button>
            ))}
          </div>
        </section>

        {autosaves.length > 0 && (
          <section className="home__section" aria-labelledby="home-recover">
            <header className="home__head">
              <h2 id="home-recover">
                <History size={16} aria-hidden="true" /> {t('Recover unsaved work')}
              </h2>
            </header>
            <div className="home__recover">
              {autosaves.map((a) => (
                <div key={a.id} className="recover-row">
                  <div className="truncate">
                    <strong>{a.name}</strong>
                    <small>{t('Autosaved {when}', { when: formatRelative(a.savedAt) })}</small>
                  </div>
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => void recoverAutosave(a)}>
                    {t('Recover')}
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    title={t('Discard this recovery copy')}
                    aria-label={t('Discard the recovery copy of “{name}”', { name: a.name })}
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
          <section className="home__section" aria-labelledby="home-recent">
            <header className="home__head">
              <h2 id="home-recent">
                <Clock size={16} aria-hidden="true" /> {t('Recent projects')}
              </h2>
            </header>
            <div className="home__recent">
              {recent.slice(0, 10).map((r) => (
                <div
                  key={r.path}
                  className="recent-card"
                  onClick={() => void openProject(r.path)}
                  title={r.path}
                  role="button"
                  tabIndex={0}
                  aria-label={t('Open {name}', { name: r.name })}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void openProject(r.path);
                    }
                  }}
                >
                  <span className="recent-card__thumb">{r.thumbnail ? <img src={r.thumbnail} alt="" draggable={false} /> : <Logo size={26} />}</span>
                  <span className="recent-card__body">
                    <strong className="truncate">{r.name}</strong>
                    <small>
                      {formatRelative(r.openedAt)}
                      {r.duration ? ` · ${formatDuration(r.duration)}` : ''}
                      {r.width && r.height ? ` · ${r.width}×${r.height}` : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm recent-card__remove"
                    title={t('Remove from this list')}
                    aria-label={t('Remove “{name}” from recent projects', { name: r.name })}
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

        <section className="home__section" aria-labelledby="home-templates">
          <header className="home__head">
            <h2 id="home-templates">{t('Start from a template')}</h2>
            <div className="segmented" role="group" aria-label={t('Format')}>
              {(['16:9', '9:16', '1:1', '4:5'] as AspectId[]).map((a) => (
                <button key={a} type="button" className={aspect === a ? 'is-active' : ''} aria-pressed={aspect === a} onClick={() => setAspect(a)}>
                  {a}
                </button>
              ))}
            </div>
          </header>
          <div style={{ margin: '0 -12px 4px' }}>
            <Chips value={category} onChange={setCategory} options={[{ value: 'all' as const, label: t('All') }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]} />
          </div>
          <div className={`home__templates ${portrait ? 'is-portrait' : aspect === '1:1' || aspect === '4:5' ? 'is-square' : ''}`}>
            {variations.map((v, i) => (
              <HomeTemplate key={`${i}:${v.key}`} variation={v} aspect={aspect} onPick={() => void newProject({ width: format.w, height: format.h, fps }, v)} />
            ))}
          </div>
          {variations.length > 0 ? (
            <div ref={sentinel} className="lib__more">
              <span className="spinner" aria-hidden="true" /> {t('Generating more styles…')}
            </div>
          ) : (
            <div className="empty">
              <p>{t('No templates for this format yet.')}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
