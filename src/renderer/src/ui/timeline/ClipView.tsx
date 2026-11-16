import { Film, Image as ImageIcon, Layers, Music, Shapes, Smile, Sparkles, Type, VolumeX } from 'lucide-react';
import { memo, useEffect, useRef, type ReactNode } from 'react';
import { allKeyframeTimes } from '@/core/keyframes';
import { sourceTimeAt } from '@/core/timemap';
import type { Clip, MediaAsset } from '@/core/types';
import { PEAKS_PER_SECOND, filmFrameAt, getFilmstrip, getWaveform, onAssetVisuals } from '@/engine/media/peaks';
import { getSticker } from '@/library';
import { CompoundMini, RampOverlay, TimeTags } from '../time/ClipDecor';
import { LEFT_PAD } from './geometry';

const ICONS: Record<Clip['type'], ReactNode> = {
  video: <Film size={11} />,
  image: <ImageIcon size={11} />,
  audio: <Music size={11} />,
  text: <Type size={11} />,
  sticker: <Smile size={11} />,
  shape: <Shapes size={11} />,
  generator: <Sparkles size={11} />,
  adjustment: <Layers size={11} />,
  compound: <Layers size={11} />,
};

const BUFFER = 300;

interface CanvasProps {
  clip: Clip;
  asset: MediaAsset | undefined;
  pps: number;
  /** Visible window of the timeline content, in px. */
  viewLeft: number;
  viewWidth: number;
  height: number;
  thumb: string | null;
}

/**
 * Filmstrip / waveform painted only for the part of the clip that is on screen, so very long
 * clips at high zoom never allocate huge canvases.
 */
const ClipCanvas = memo(function ClipCanvas({ clip, asset, pps, viewLeft, viewWidth, height, thumb }: CanvasProps): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const clipLeft = LEFT_PAD + clip.start * pps;
  const clipWidth = clip.duration * pps;
  const from = Math.max(0, Math.floor(viewLeft - clipLeft - BUFFER));
  const to = Math.min(clipWidth, Math.ceil(viewLeft - clipLeft + viewWidth + BUFFER));
  const width = Math.max(0, Math.round(to - from));
  const timed = clip.type === 'video' || clip.type === 'audio' ? clip : null;
  // Everything the source mapping depends on (speed, ramp, reverse, freeze, length).
  const mapKey = timed ? `${timed.trimIn}|${timed.speed}|${timed.duration}|${timed.reverse ? 1 : 0}|${timed.freeze ? 1 : 0}|${timed.speedRamp ? JSON.stringify(timed.speedRamp) : ''}` : '';
  const muted = (clip.type === 'video' || clip.type === 'audio') && clip.muted;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0 || !asset) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;

    const draw = (): void => {
      raf = 0;
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const hasWave = asset.hasAudio && clip.type !== 'image';
      const waveH = clip.type === 'audio' ? height : hasWave ? Math.min(16, height * 0.32) : 0;
      const filmH = clip.type === 'audio' ? 0 : height - waveH;

      if (clip.type === 'video' && filmH > 4) {
        const strip = getFilmstrip(asset);
        if (strip) {
          const tileW = Math.max(8, filmH * (strip.width / strip.height));
          const first = Math.floor(from / tileW);
          const last = Math.ceil((from + width) / tileW);
          for (let i = first; i < last; i++) {
            const x = i * tileW;
            const time = timed ? sourceTimeAt(timed, x / pps) : 0;
            const frame = filmFrameAt(strip, time);
            if (frame) ctx.drawImage(frame as CanvasImageSource, x - from, 0, tileW, filmH);
          }
        }
      } else if (clip.type === 'image' && filmH > 4) {
        const img = imgRef.current;
        if (img && img.complete && img.naturalWidth > 0) {
          const tileW = Math.max(8, filmH * (img.naturalWidth / img.naturalHeight));
          const first = Math.floor(from / tileW);
          const last = Math.ceil((from + width) / tileW);
          for (let i = first; i < last; i++) ctx.drawImage(img, i * tileW - from, 0, tileW, filmH);
        }
      }

      if (waveH > 0 && !timed?.freeze) {
        const wave = getWaveform(asset);
        if (wave && timed) {
          const top = filmH;
          if (clip.type !== 'audio') {
            ctx.fillStyle = 'rgba(8, 10, 14, 0.62)';
            ctx.fillRect(0, top, width, waveH);
          }
          ctx.fillStyle = muted ? 'rgba(255,255,255,0.25)' : clip.type === 'audio' ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.7)';
          const mid = top + waveH / 2;
          const half = waveH / 2 - 1;
          ctx.beginPath();
          for (let x = 0; x < width; x++) {
            // Source range under this pixel column (reversed / ramped clips map non-linearly).
            const sa = sourceTimeAt(timed, (from + x) / pps);
            const sb = sourceTimeAt(timed, (from + x + 1) / pps);
            const b0 = Math.floor(Math.min(sa, sb) * PEAKS_PER_SECOND);
            const b1 = Math.max(b0 + 1, Math.floor(Math.max(sa, sb) * PEAKS_PER_SECOND));
            let peak = 0;
            // Cap the scan so extreme zoom-outs stay cheap.
            const stride = Math.max(1, Math.floor((b1 - b0) / 24));
            for (let b = b0; b < b1 && b < wave.peaks.length; b += stride) {
              if (b >= 0 && wave.peaks[b] > peak) peak = wave.peaks[b];
            }
            const amp = Math.max(0.5, Math.pow(peak, 0.75) * half);
            ctx.rect(x, mid - amp, 1, amp * 2);
          }
          ctx.fill();
        }
      }
    };
    const request = (): void => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    if (clip.type === 'image' && thumb) {
      if (!imgRef.current || imgRef.current.src !== thumb) {
        const img = new Image();
        img.onload = request;
        img.src = thumb;
        imgRef.current = img;
      }
    }
    request();
    const off = onAssetVisuals(asset.id, request);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, clip.type, clip.id, from, width, height, pps, mapKey, muted, thumb]);

  if (width <= 0 || !asset) return null;
  return <canvas ref={ref} className="clip__canvas" style={{ left: from, width, height }} />;
});

export interface ClipViewProps {
  clip: Clip;
  asset: MediaAsset | undefined;
  pps: number;
  viewLeft: number;
  viewWidth: number;
  height: number;
  selected: boolean;
  missing: boolean;
  locked: boolean;
  dimmed: boolean;
  /** Highlighted as the target of an effect / filter drop. */
  dropTarget: boolean;
  thumb: string | null;
}

export const ClipView = memo(function ClipView({ clip, asset, pps, viewLeft, viewWidth, height, selected, missing, locked, dimmed, dropTarget, thumb }: ClipViewProps): ReactNode {
  const left = LEFT_PAD + clip.start * pps;
  const width = Math.max(2, clip.duration * pps);
  const keyframes = clip.keyframes ? allKeyframeTimes(clip) : [];
  const visual = clip.type !== 'audio' ? clip : null;
  const muted = (clip.type === 'video' || clip.type === 'audio') && clip.muted;
  const fxCount = visual ? visual.effects.length + (visual.filter ? 1 : 0) : 0;
  const hasAnim = !!visual?.anim || (clip.type === 'text' && !!clip.textAnim);
  const emoji = clip.type === 'sticker' ? getSticker(clip.stickerId) : undefined;
  const slot = clip.type === 'shape' && clip.shape.slot;
  const inner = height - 2;
  const compact = width < 46;
  // Keep the label readable when the clip starts off-screen to the left.
  const labelShift = Math.max(0, Math.min(width - 60, viewLeft - left));
  const frozen = clip.type === 'video' && !!clip.freeze;
  // Visible part of the clip in clip-local px (for the decorations).
  const visFrom = Math.max(0, viewLeft - left - 300);
  const visTo = viewLeft - left + viewWidth + 300;

  return (
    <div
      className={`clip clip--${clip.type} ${selected ? 'is-selected' : ''} ${missing ? 'is-missing' : ''} ${locked ? 'is-locked' : ''} ${dimmed ? 'is-dimmed' : ''} ${dropTarget ? 'is-drop' : ''} ${slot ? 'is-slot' : ''} ${frozen ? 'is-freeze' : ''}`}
      style={{ left, width, height }}
      data-clip={clip.id}
    >
      {(clip.type === 'video' || clip.type === 'image' || clip.type === 'audio') && <ClipCanvas clip={clip} asset={asset} pps={pps} viewLeft={viewLeft} viewWidth={viewWidth} height={inner} thumb={thumb} />}
      {clip.type === 'compound' && <CompoundMini clip={clip} pps={pps} from={visFrom} to={visTo} height={inner} />}
      <RampOverlay clip={clip} pps={pps} from={visFrom} to={visTo} height={inner} />
      {!compact && (
        <div className="clip__label" style={{ transform: `translateX(${labelShift}px)` }}>
          <span className="clip__icon">{emoji && emoji.kind === 'emoji' ? <span className="clip__emoji">{emoji.char}</span> : ICONS[clip.type]}</span>
          <span className="clip__name truncate">{missing ? `Missing: ${clip.name}` : clip.type === 'text' ? clip.text.content.replace(/\s+/g, ' ') : clip.name}</span>
          <TimeTags clip={clip} />
          {muted && (
            <span className="clip__tag">
              <VolumeX size={10} />
            </span>
          )}
          {fxCount > 0 && <span className="clip__tag">FX</span>}
        </div>
      )}
      {hasAnim && !compact && (
        <>
          {(visual?.anim?.in || (clip.type === 'text' && clip.textAnim?.in)) && <span className="clip__anim clip__anim--in" />}
          {(visual?.anim?.out || (clip.type === 'text' && clip.textAnim?.out)) && <span className="clip__anim clip__anim--out" />}
        </>
      )}
      {keyframes.map((t) => (
        <span key={t} className="clip__kf" style={{ left: t * pps }} />
      ))}
      {!locked && (
        <>
          <span className="clip__handle clip__handle--l" data-handle="l" />
          <span className="clip__handle clip__handle--r" data-handle="r" />
        </>
      )}
    </div>
  );
});
