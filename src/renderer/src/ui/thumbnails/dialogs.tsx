/**
 * Thumbnail dialogs: pick a video frame, preview thumbnails in a video feed, export a picture.
 */

import { ChevronLeft, ChevronRight, Download, Moon, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { projectDuration } from '@/core/project';
import type { ShapeClip } from '@/core/types';
import { getThumbnail } from '@/core/thumbnails';
import { formatTimecode } from '@/core/time';
import { engine } from '@/engine/engine';
import { FramingPreview } from '@/engine/export/framingPreview';
import { getRootProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { Segmented } from '../common/controls';
import { Modal } from '../common/overlays';
import { useT } from '../i18n';
import { samplePicture } from '../library/samples';
import { useTemplates } from '../templates/store';
import { changeThumbnailFrame, exportThumbnail, newThumbnailFromFrame, openThumbnailId, renderThumbnail, thumbnailSize, useThumbnails, videoPlayhead, type ThumbnailFormat } from './actions';
import './thumbnails.css';

// ---------------------------------------------------------------------------------------------
// Frame picker
// ---------------------------------------------------------------------------------------------

let pickerMode: 'change' | 'new' = 'change';

/** Choose a moment of the video: for the open thumbnail's background, or for a new thumbnail. */
export function openFramePicker(mode: 'change' | 'new'): void {
  pickerMode = mode;
  engine.pause();
  useUI.getState().openModal('thumbnailFrame');
}

const STRIP = 8;

export function FramePickerDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const mode = pickerMode;
  // The video as it is now (the thumbnail being edited does not change it).
  const video = useMemo(() => getRootProject(), []);
  const fps = video.settings.fps;
  const duration = Math.max(1 / fps, projectDuration(video));
  const start = useMemo(() => {
    const th = getThumbnail(video, openThumbnailId());
    return Math.min(duration, mode === 'change' && th?.frameTime !== undefined ? th.frameTime : videoPlayhead());
  }, [video, duration, mode]);
  const [time, setTime] = useState(start);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => new FramingPreview(), []);
  const main = useRef<HTMLCanvasElement>(null);
  const strip = useRef<(HTMLCanvasElement | null)[]>([]);
  const ratio = video.settings.width / video.settings.height;
  const pw = ratio >= 1 ? 640 : Math.round(400 * ratio);
  const ph = Math.round(pw / ratio);
  const moments = useMemo(() => Array.from({ length: STRIP }, (_, i) => (duration * (i + 0.5)) / STRIP), [duration]);

  useEffect(() => () => void preview.dispose(), [preview]);
  useEffect(() => {
    if (main.current) void preview.draw(video, time, main.current);
  }, [preview, video, time]);
  useEffect(() => {
    // The strip renders once, after the big preview.
    moments.forEach((m, i) => {
      const c = strip.current[i];
      if (c) void preview.draw(video, m, c);
    });
  }, [preview, video, moments]);

  const step = (d: number): void => setTime((v) => Math.min(duration, Math.max(0, Math.round((v + d) * fps) / fps)));
  const confirm = async (): Promise<void> => {
    setBusy(true);
    const ok = mode === 'new' ? !!(await newThumbnailFromFrame(time)) : await changeThumbnailFrame(time);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={mode === 'new' ? t('New thumbnail from a video frame') : t('Change the video frame')}
      subtitle={t('Pick the moment that tells the story best: faces and action read well at small sizes.')}
      width={Math.max(560, pw + 48)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void confirm()} data-thumbnail-use-frame>
            {busy ? t('Capturing…') : t('Use this frame')}
          </button>
        </>
      }
    >
      <div className="thumb-picker">
        <canvas ref={main} width={pw} height={ph} className="thumb-picker__main" style={{ aspectRatio: `${pw} / ${ph}` }} />
        <div className="thumb-picker__scrub">
          <button type="button" className="icon-btn icon-btn--sm" title={t('Previous frame')} onClick={() => step(-1 / fps)}>
            <ChevronLeft size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={duration}
            step={1 / fps}
            value={time}
            aria-label={t('Video time')}
            onChange={(e) => setTime(Number(e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="button" className="icon-btn icon-btn--sm" title={t('Next frame')} onClick={() => step(1 / fps)}>
            <ChevronRight size={14} />
          </button>
          <span className="mono thumb-picker__time">{formatTimecode(time, fps)}</span>
        </div>
        <div className="thumb-picker__strip">
          {moments.map((m, i) => (
            <button key={i} type="button" title={formatTimecode(m, fps)} className={Math.abs(m - time) < 0.5 / fps ? 'is-active' : ''} onClick={() => setTime(Math.round(m * fps) / fps)}>
              <canvas
                ref={(el) => {
                  strip.current[i] = el;
                }}
                width={160}
                height={Math.round(160 / ratio)}
              />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Feed preview
// ---------------------------------------------------------------------------------------------

/** Neutral neighbours for the feed mock-up (no real channels or brands). */
const NEIGHBOURS = [
  {
    title: '10 editing mistakes every beginner makes',
    channel: 'Studio Notes',
    meta: '84K views · 3 days ago',
    time: '12:48',
  },
  {
    title: 'I tried living on a boat for a week',
    channel: 'Slow Weekends',
    meta: '1.2M views · 2 weeks ago',
    time: '21:05',
  },
  {
    title: 'The easiest bread recipe (no mixer)',
    channel: 'Kitchen Table',
    meta: '310K views · 5 days ago',
    time: '8:32',
  },
  {
    title: 'Our first trip to the mountains',
    channel: 'Two Backpacks',
    meta: '46K views · 1 month ago',
    time: '15:10',
  },
];

const mmss = (s: number): string => {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

interface CardProps {
  src: string | null;
  title: string;
  channel: string;
  meta: string;
  duration: string;
  ratio: number;
  mine?: boolean;
  layout?: 'grid' | 'row';
  width?: number;
}

function FeedCard({ src, title, channel, meta, duration, ratio, mine, layout = 'grid', width }: CardProps): ReactNode {
  return (
    <div className={`feed-card feed-card--${layout} ${mine ? 'is-mine' : ''}`} style={width ? { width } : undefined}>
      <div
        className="feed-card__thumb"
        style={{
          aspectRatio: String(ratio),
          ...(layout === 'row' && width ? { width } : {}),
        }}
      >
        {src ? <img src={src} alt="" draggable={false} /> : <span className="feed-card__loading" />}
        <span className="feed-card__time">{duration}</span>
      </div>
      <div className="feed-card__text">
        {layout === 'grid' && <span className="feed-card__avatar" aria-hidden />}
        <div>
          <div className="feed-card__title">{title}</div>
          <div className="feed-card__meta">{channel}</div>
          <div className="feed-card__meta">{meta}</div>
        </div>
      </div>
    </div>
  );
}

export function FeedPreviewDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const { open, list } = useThumbnails();
  const root = useProjectStore((s) => s.root);
  const brandName = useTemplates((s) => (s.brandSet ? s.brand.name.trim() : ''));
  const [dark, setDark] = useState(true);
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const ratio = root.settings.width / root.settings.height;
  const duration = mmss(projectDuration(root));
  const title = root.name || t('Untitled project');
  const channel = brandName || t('Your channel');
  const meta = t('12K views · 1 day ago');
  const others = useMemo(
    () =>
      NEIGHBOURS.map((n, i) => ({
        ...n,
        src: samplePicture(i + 1).toDataURL('image/jpeg', 0.85),
      })),
    [],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      for (const th of list) {
        const w = ratio >= 1 ? 640 : Math.round(640 * ratio);
        const canvas = await renderThumbnail(th.id, {
          width: w,
          height: Math.round(w / ratio),
        }).catch(() => null);
        if (!live || !canvas) continue;
        const url = canvas.toDataURL('image/jpeg', 0.9);
        setPictures((p) => ({ ...p, [th.id]: url }));
      }
    })();
    return () => {
      live = false;
    };
    // Rendered once per opening: the dialog shows the thumbnails as they are now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = open ?? list[0];
  const mine = current ? (pictures[current.id] ?? null) : null;
  return (
    <Modal
      title={t('Preview in feed')}
      subtitle={t('Your thumbnail among other videos, at the sizes people see it. Big faces, few words and strong contrast read best.')}
      width={980}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          {t('Done')}
        </button>
      }
    >
      <div className={`feed ${dark ? 'feed--dark' : 'feed--light'}`} data-thumbnail-feed-preview>
        <div className="feed__bar">
          <Segmented
            value={dark ? 'dark' : 'light'}
            onChange={(v) => setDark(v === 'dark')}
            options={[
              {
                value: 'dark',
                label: <Moon size={13} />,
                title: t('Dark mode'),
              },
              {
                value: 'light',
                label: <Sun size={13} />,
                title: t('Light mode'),
              },
            ]}
          />
        </div>
        <h4 className="feed__heading">{t('Home feed')}</h4>
        <div className="feed__grid">
          <FeedCard src={mine} title={title} channel={channel} meta={meta} duration={duration} ratio={ratio} mine />
          {others.slice(0, 2).map((o) => (
            <FeedCard key={o.title} src={o.src} title={o.title} channel={o.channel} meta={o.meta} duration={o.time} ratio={ratio} />
          ))}
        </div>
        <div className="feed__columns">
          <div>
            <h4 className="feed__heading">{t('Search results')}</h4>
            <FeedCard src={mine} title={title} channel={channel} meta={meta} duration={duration} ratio={ratio} layout="row" width={240} mine />
            <FeedCard src={others[2].src} title={others[2].title} channel={others[2].channel} meta={others[2].meta} duration={others[2].time} ratio={ratio} layout="row" width={240} />
          </div>
          <div>
            <h4 className="feed__heading">{t('Up next (small)')}</h4>
            <FeedCard src={mine} title={title} channel={channel} meta={meta} duration={duration} ratio={ratio} layout="row" width={150} mine />
            <FeedCard src={others[3].src} title={others[3].title} channel={others[3].channel} meta={others[3].meta} duration={others[3].time} ratio={ratio} layout="row" width={150} />
          </div>
        </div>
        {list.length > 1 && (
          <>
            <h4 className="feed__heading">{t('Your variants side by side')}</h4>
            <div className="feed__variants">
              {list.map((th) => (
                <div key={th.id} className={`feed__variant ${th.id === current?.id ? 'is-current' : ''}`}>
                  <div className="feed-card__thumb" style={{ aspectRatio: String(ratio) }}>
                    {pictures[th.id] ? <img src={pictures[th.id]} alt="" draggable={false} /> : <span className="feed-card__loading" />}
                    <span className="feed-card__time">{duration}</span>
                  </div>
                  <div className="feed__variant-name">{th.name}</div>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => void exportThumbnail(th.id, { format: 'jpg' })}>
                    <Download size={12} /> {t('Export')}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

export function ThumbnailExportDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const { open, list } = useThumbnails();
  const settings = useProjectStore((s) => s.root.settings);
  const [target, setTarget] = useState(open?.id ?? list[0]?.id ?? '');
  const [format, setFormat] = useState<ThumbnailFormat>('jpg');
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picture, setPicture] = useState<string | null>(null);
  const small = thumbnailSize(settings);
  const ratio = settings.width / settings.height;
  const empty = list.find((x) => x.id === target)?.sequence.clips;
  const placeholders = empty ? Object.values(empty).filter((c): c is ShapeClip => c.type === 'shape' && !!c.shape.slot) : [];
  const people = placeholders.filter((c) => c.cutout?.enabled).length;

  useEffect(() => {
    let live = true;
    setPicture(null);
    const w = ratio >= 1 ? 480 : Math.round(320 * ratio);
    void renderThumbnail(target, { width: w, height: Math.round(w / ratio) })
      .then((c) => live && c && setPicture(c.toDataURL('image/jpeg', 0.9)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [target, ratio]);

  const run = async (): Promise<void> => {
    setBusy(true);
    const path = await exportThumbnail(target, { format, full });
    setBusy(false);
    if (path) onClose();
  };

  return (
    <Modal
      title={t('Export thumbnail')}
      subtitle={t('Saves the picture under the playhead of the thumbnail.')}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || !target} onClick={() => void run()} data-thumbnail-save>
            <Download size={14} /> {busy ? t('Saving…') : t('Save…')}
          </button>
        </>
      }
    >
      <div className="thumb-export">
        <div className="thumb-export__picture" style={{ aspectRatio: String(ratio) }}>
          {picture ? <img src={picture} alt="" /> : <span className="feed-card__loading" />}
        </div>
        <div className="thumb-export__fields">
          {list.length > 1 && (
            <label className="field">
              <span className="field__label">{t('Thumbnail')}</span>
              <Segmented
                value={target}
                onChange={setTarget}
                options={list.map((th) => ({
                  value: th.id,
                  label: th.name.replace(/^Thumbnail /, '') || th.name,
                  title: th.name,
                }))}
              />
            </label>
          )}
          <label className="field">
            <span className="field__label">{t('Format')}</span>
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                {
                  value: 'jpg',
                  label: 'JPG',
                  title: t('Recommended: small files, kept under 2 MB for YouTube'),
                },
                {
                  value: 'png',
                  label: 'PNG',
                  title: t('Lossless, larger files'),
                },
              ]}
            />
          </label>
          {(small.width !== settings.width || small.height !== settings.height) && (
            <label className="field">
              <span className="field__label">{t('Size')}</span>
              <Segmented
                value={full ? 'full' : 'small'}
                onChange={(v) => setFull(v === 'full')}
                options={[
                  {
                    value: 'small',
                    label: `${small.width} × ${small.height}`,
                    title: t('The size YouTube recommends'),
                  },
                  {
                    value: 'full',
                    label: `${settings.width} × ${settings.height}`,
                    title: t('The project’s full size'),
                  },
                ]}
              />
            </label>
          )}
          <p className="thumb-export__note">
            {format === 'jpg' ? t('JPG files are kept under 2 MB, the YouTube limit.') : t('PNG files can be larger than 2 MB at full size; YouTube may refuse them.')}
          </p>
          {placeholders.length > 0 && (
            <p className="thumb-export__warn" data-thumbnail-empty>
              {t('{count, plural, one {# placeholder is still empty} other {# placeholders are still empty}}: drag a photo or video from Media onto it.', { count: placeholders.length })}{' '}
              {people > 0 && t('Person placeholders remove the background and outline the picture.')}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
