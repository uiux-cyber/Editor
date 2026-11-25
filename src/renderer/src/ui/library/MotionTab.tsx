import { Infinity as InfinityIcon, Shuffle, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { designSize } from '@/core/project';
import { MotionAnimation } from '@/engine/media/motion';
import { MOTION_CATEGORIES, type MotionCategory } from '@/library/motionPresets';
import { backdropFor, matchingPresets, motionHasMore, motionPage, resolveVariation, shuffleMotion, type MotionQuery, type MotionVariation } from '@/library/motionVariations';
import { aspectIdFor, ASPECT_SIZES } from '@/library/templateEngine';
import { useProjectStore } from '@/store/project';
import { normalizeMotionParams, type MotionMeta } from '@shared/motion';
import { tk, tMaybe, useT } from '../i18n';
import { addMotionVariation } from '../motion/actions';
import { motionBrand, motionLibrary } from '../motion/library';
import { requestPoster } from '../motion/posters';
import { BrandToggle } from '../templates/gallery';
import { useTemplates } from '../templates/store';
import { startDrag } from '../dnd';
import { Chips, SearchBox } from './common';
import '../motion/motion.css';

export const MOTION_CATEGORY_LABELS: Record<MotionCategory, string> = {
  titles: tk('Titles'),
  'lower-thirds': tk('Lower thirds'),
  callouts: tk('Callouts'),
  social: tk('Social'),
  text: tk('Quotes & captions'),
  data: tk('Charts & numbers'),
  countdowns: tk('Countdowns'),
  transitions: tk('Transitions'),
  backgrounds: tk('Backgrounds'),
  particles: tk('Particles'),
  '3d': tk('3D'),
  overlays: tk('Overlays'),
  icons: tk('Icons'),
  maps: tk('Maps & travel'),
};

/** The gallery's brand theme; changes when "Use my brand" or the kit changes. */
function useMotionBrand(): MotionQuery['brand'] {
  const on = useTemplates((s) => s.useBrand && s.brandSet);
  const revision = useTemplates((s) => s.brand.revision);
  const name = useTemplates((s) => s.brand.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (on ? motionBrand() : null), [on, revision, name]);
}

function paint(canvas: HTMLCanvasElement | null, backdrop: { bg: string; bg2: string } | null, src: CanvasImageSource | null): void {
  const g = canvas?.getContext('2d');
  if (!canvas || !g) return;
  const { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  if (backdrop) {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, backdrop.bg);
    grad.addColorStop(1, backdrop.bg2);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  if (src) g.drawImage(src, 0, 0, w, h);
}

interface TileProps {
  variation: MotionVariation;
  brand: MotionQuery['brand'];
  thumbW: number;
  thumbH: number;
  onShuffle: () => void;
}

function MotionTile({ variation, brand, thumbW, thumbH, onShuffle }: TileProps): ReactNode {
  const t = useT();
  const lib = motionLibrary();
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [poster, setPoster] = useState<HTMLCanvasElement | null | undefined>(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const r = useMemo(() => resolveVariation(lib, variation, brand), [variation.key, brand]);
  const preset = r?.preset;
  const meta = useMemo<MotionMeta | null>(
    () => (preset && r ? { name: preset.name, width: thumbW, height: thumbH, duration: preset.duration, fps: 24, seed: r.seed, params: normalizeMotionParams(preset.params) } : null),
    [preset, r, thumbW, thumbH],
  );
  const backdrop = preset && !preset.fullFrame ? backdropFor(lib, variation, brand) : null;

  // Render the poster once the tile comes near the screen; forget the request if it scrolls away.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !preset || !meta || !r) return;
    return requestPoster(`${variation.key}|${thumbW}x${thumbH}`, () => ({ code: preset.code, meta, time: preset.duration * (preset.poster ?? 0.55), values: r.values }), setPoster);
  }, [visible, preset, meta, r, variation.key, thumbW, thumbH]);

  useEffect(() => {
    if (!hover || !preset || !meta || !r) {
      paint(canvas.current, backdrop, poster ?? null);
      return;
    }
    // Live preview while hovered.
    const anim = new MotionAnimation('', () => undefined, { code: preset.code, meta }, r.values);
    const start = performance.now();
    let raf = 0;
    const tick = (): void => {
      const time = ((performance.now() - start) / 1000) % preset.duration;
      const f = anim.frameAt(time);
      if (f) paint(canvas.current, backdrop, f.source as CanvasImageSource);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      anim.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, poster, preset, meta, r]);

  if (!preset) return null;
  return (
    <div
      ref={ref}
      className={`tile motion-tile ${busy ? 'is-busy' : ''}`}
      data-motion-preset={preset.id}
      data-motion-version={variation.key}
      title={`${preset.name}\n${preset.about}\n${t('Click to add at the playhead, or drag to the timeline')}`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(e) => {
        if (busy || (e.target as HTMLElement).closest('[data-no-drag]')) return;
        startDrag(e, { kind: 'motion', presetId: preset.id, duration: preset.duration, variation }, preset.name, () => {
          setBusy(true);
          void addMotionVariation(variation).finally(() => setBusy(false));
        });
      }}
    >
      <div className="tile__thumb motion-tile__thumb" style={{ aspectRatio: `${thumbW} / ${thumbH}` }}>
        <canvas ref={canvas} width={thumbW} height={thumbH} />
        {poster === undefined && <span className="motion-tile__loading" aria-hidden />}
        {poster === null && <span className="motion-tile__error">{t('Preview unavailable')}</span>}
        <button type="button" data-no-drag className="tile__action" title={t('Try another colour, font and style')} onClick={onShuffle}>
          <Shuffle size={12} />
        </button>
        <span className="tile__badge mono">{Math.round(preset.duration * 10) / 10}s</span>
      </div>
      <div className="tile__label truncate">{preset.name}</div>
    </div>
  );
}

/** Library ▸ Motion: ready-made animated clips in endless versions, with settings in the inspector. */
export function MotionTab(): ReactNode {
  const t = useT();
  const settings = useProjectStore((s) => s.project.settings);
  const { cw, ch } = designSize(settings);
  const aspect = aspectIdFor(cw, ch);
  const brand = useMotionBrand();
  const [category, setCategory] = useState<MotionCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);
  const [overrides, setOverrides] = useState<Record<string, MotionVariation>>({});
  const sentinel = useRef<HTMLDivElement>(null);
  const lib = motionLibrary();

  const query = useMemo<MotionQuery>(() => ({ category, search, brand }), [category, search, brand]);
  const count = useMemo(() => matchingPresets(lib, query).length, [lib, query]);
  const categories = useMemo(() => MOTION_CATEGORIES.filter((c) => lib.presets.some((p) => p.category === c)), [lib]);

  useEffect(() => {
    setPages(1);
    setOverrides({});
  }, [query]);

  const versions = useMemo(() => {
    const out: MotionVariation[] = [];
    for (let p = 0; p < pages; p++) out.push(...motionPage(lib, query, p));
    return out;
  }, [lib, query, pages]);

  // Endless feed: every time the end comes into view, add another page of versions.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || count === 0 || !motionHasMore(query, pages)) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setPages((p) => Math.min(p + 1, 400)), { rootMargin: '500px' });
    io.observe(el);
    return () => io.disconnect();
  }, [count, pages, query]);

  // Thumbnails use the project's frame shape: clips lay themselves out for it.
  const size = ASPECT_SIZES[aspect];
  const portrait = size.ch > size.cw;
  const thumbW = portrait ? 216 : size.cw === size.ch ? 288 : 384;
  const thumbH = Math.round((thumbW * size.ch) / size.cw);

  return (
    <div className="lib">
      <header className="lib__head">
        <h3>{t('Motion')}</h3>
        <span className="badge badge--accent" title={t('{count} designs, each in endless colour, font and style versions as you scroll', { count: lib.presets.length })}>
          <InfinityIcon size={12} style={{ marginRight: 4 }} /> {t('Endless')}
        </span>
        <BrandToggle compact />
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder={t('Search motion')} />
      </div>
      <Chips value={category} onChange={setCategory} options={[{ value: 'all' as const, label: t('All') }, ...categories.map((c) => ({ value: c, label: tMaybe(MOTION_CATEGORY_LABELS[c]) }))]} />
      <div className="lib__scroll">
        {category === 'all' && !search && (
          <p className="motion-intro">
            <Sparkles size={14} />
            <span>{t('Animated titles, lower thirds, charts and effects. Change their words, colours and fonts in the inspector, or ask Claude for any animation you can describe.')}</span>
          </p>
        )}
        {count === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('No motion found')}</div>
            <p>{t('Try a different search or category.')}</p>
          </div>
        ) : (
          <>
            <div className={`grid ${portrait ? 'grid--3' : 'grid--2'}`}>
              {versions.map((v, i) => {
                const slot = `${i}`;
                const shown = overrides[slot] ?? v;
                return (
                  <MotionTile
                    key={`${slot}:${shown.key}`}
                    variation={shown}
                    brand={brand}
                    thumbW={thumbW}
                    thumbH={thumbH}
                    onShuffle={() => setOverrides((o) => ({ ...o, [slot]: shuffleMotion(lib, shown, brand) }))}
                  />
                );
              })}
            </div>
            {motionHasMore(query, pages) && (
              <div ref={sentinel} className="lib__more">
                <span className="spinner" /> {t('Generating more styles…')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
