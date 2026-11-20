import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MotionAnimation, testMotion } from '@/engine/media/motion';
import { MOTION_CATEGORIES, MOTION_PRESETS, type MotionCategory, type MotionPresetDef } from '@/library/motionPresets';
import { motionValuesKey, normalizeMotionParams, type MotionMeta, type MotionParam, type MotionValue } from '@shared/motion';
import { tk, tMaybe, useT } from '../i18n';
import { addMotionPreset, brandValues } from '../motion/actions';
import { BrandToggle } from '../templates/gallery';
import { useTemplates } from '../templates/store';
import { startDrag } from '../dnd';
import { Chips } from './common';
import '../motion/motion.css';

const THUMB_W = 384;
const THUMB_H = 216;

const CATEGORY_LABELS: Record<MotionCategory, string> = {
  titles: tk('Titles'),
  'lower-thirds': tk('Lower thirds'),
  social: tk('Social'),
  data: tk('Charts & numbers'),
  '3d': tk('3D'),
  effects: tk('Effects'),
};

const thumbMeta = (p: MotionPresetDef): MotionMeta => ({ name: p.name, width: THUMB_W, height: THUMB_H, duration: p.duration, fps: 24, seed: 1, params: normalizeMotionParams(p.params) });

/** Values the gallery shows: the brand kit's when "Use my brand" is on (no logo in thumbnails). */
function useGalleryValues(): (p: MotionPresetDef) => Record<string, MotionValue> | undefined {
  const on = useTemplates((s) => s.useBrand && s.brandSet);
  const revision = useTemplates((s) => s.brand.revision);
  return useMemo(() => {
    void revision;
    if (!on) return () => undefined;
    return (p: MotionPresetDef) => {
      const { values } = brandValues(p.params.filter((x: MotionParam) => x.type !== 'image'));
      return values;
    };
  }, [on, revision]);
}

// ---- posters: rendered one at a time, kept for the session --------------------------------------

const posters = new Map<string, ImageBitmap | null>();
const waiting = new Map<string, Array<(b: ImageBitmap | null) => void>>();
let queue: Promise<void> = Promise.resolve();

function poster(p: MotionPresetDef, values: Record<string, MotionValue> | undefined): Promise<ImageBitmap | null> {
  const key = `${p.id}|${motionValuesKey(values)}`;
  if (posters.has(key)) return Promise.resolve(posters.get(key)!);
  return new Promise((resolve) => {
    const list = waiting.get(key);
    if (list) {
      list.push(resolve);
      return;
    }
    waiting.set(key, [resolve]);
    queue = queue.then(async () => {
      const r = await testMotion(p.code, thumbMeta(p), [p.duration * (p.id === 'shape-wipe' ? 0.3 : 0.55)], values).catch(() => null);
      const bmp = r?.ok ? r.frames[0] : null;
      posters.set(key, bmp);
      waiting.get(key)?.forEach((cb) => cb(bmp));
      waiting.delete(key);
    });
  });
}

function draw(canvas: HTMLCanvasElement | null, src: CanvasImageSource | null): void {
  const g = canvas?.getContext('2d');
  if (!canvas || !g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (src) g.drawImage(src, 0, 0, canvas.width, canvas.height);
}

function MotionTile({ preset, values, brand }: { preset: MotionPresetDef; values: Record<string, MotionValue> | undefined; brand: boolean }): ReactNode {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<ImageBitmap | null | undefined>(undefined);
  const key = motionValuesKey(values);

  useEffect(() => {
    let live = true;
    setImage(undefined);
    void poster(preset, values).then((b) => live && setImage(b));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, key]);

  useEffect(() => {
    if (!hover) {
      draw(ref.current, image ?? null);
      return;
    }
    // Live preview while hovered.
    const anim = new MotionAnimation('', () => undefined, { code: preset.code, meta: thumbMeta(preset) }, values);
    const start = performance.now();
    let raf = 0;
    const tick = (): void => {
      const time = ((performance.now() - start) / 1000) % preset.duration;
      const f = anim.frameAt(time);
      if (f) draw(ref.current, f.source as CanvasImageSource);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      anim.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, image, preset, key]);

  return (
    <button
      type="button"
      className="tile motion-tile"
      data-motion-preset={preset.id}
      title={`${preset.name}\n${preset.about}\n${t('Click to add at the playhead, or drag to the timeline')}`}
      disabled={busy}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(e) =>
        startDrag(e, { kind: 'motion', presetId: preset.id, duration: preset.duration }, preset.name, () => {
          setBusy(true);
          void addMotionPreset(preset, { brand }).finally(() => setBusy(false));
        })
      }
    >
      <div className="tile__thumb motion-tile__thumb" style={{ aspectRatio: `${THUMB_W} / ${THUMB_H}` }}>
        <canvas ref={ref} width={THUMB_W} height={THUMB_H} />
        {image === undefined && <span className="motion-tile__loading" aria-hidden />}
        {image === null && <span className="motion-tile__error">{t('Preview unavailable')}</span>}
      </div>
      <div className="tile__label truncate">{preset.name}</div>
    </button>
  );
}

/** Library ▸ Motion: ready-made animated clips with settings in the inspector. */
export function MotionTab(): ReactNode {
  const t = useT();
  const [category, setCategory] = useState<MotionCategory | 'all'>('all');
  const valuesFor = useGalleryValues();
  const brand = useTemplates((s) => s.useBrand && s.brandSet);
  const list = MOTION_PRESETS.filter((p) => category === 'all' || p.category === category);
  return (
    <div className="lib">
      <header className="lib__head">
        <h3>{t('Motion')}</h3>
        <BrandToggle compact />
      </header>
      <div className="lib__scroll">
        <p className="motion-intro">
          <Sparkles size={14} />
          <span>{t('Animated titles, lower thirds, charts and effects. Change their words, colours and fonts in the inspector, or ask Claude for any animation you can describe.')}</span>
        </p>
        <div style={{ margin: '0 -12px 8px' }}>
          <Chips
            value={category}
            onChange={setCategory}
            options={[{ value: 'all' as const, label: t('All') }, ...MOTION_CATEGORIES.map((c) => ({ value: c, label: tMaybe(CATEGORY_LABELS[c]) }))]}
          />
        </div>
        <div className="grid grid--2">
          {list.map((p) => (
            <MotionTile key={p.id} preset={p} values={valuesFor(p)} brand={brand} />
          ))}
        </div>
      </div>
    </div>
  );
}
