/**
 * Two-up frame view shown over the preview while rolling a cut (outgoing / incoming frame) or
 * slipping a clip (new in / out frame). Frames come from `frameGrabber`, which renders them
 * with the compositor.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { ID } from '@/core/types';
import { useProjectStore } from '@/store/project';
import { useT } from '../i18n';
import { frameGrabber } from './frameGrabber';

export interface MonitorFrame {
  clipId: ID;
  /** Timeline time of the frame to show. */
  time: number;
  title: string;
  /** Secondary line, e.g. the source timecode. */
  detail: string;
}

export interface MonitorView {
  mode: 'roll' | 'slip';
  left: MonitorFrame;
  right: MonitorFrame;
}

export const useTrimMonitor = create<{ view: MonitorView | null }>(() => ({ view: null }));

function FramePane({ frame, aspect, token }: { frame: MonitorFrame; aspect: number; token: () => number }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const project = useProjectStore((s) => s.project);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const mine = token();
    void frameGrabber.render(project, frame.clipId, frame.time, canvas, () => token() === mine);
  }, [project, frame.clipId, frame.time, token]);
  return (
    <figure className="trim-monitor__pane">
      <canvas ref={ref} className="trim-monitor__frame" style={{ aspectRatio: String(aspect) }} />
      <figcaption>
        <strong>{frame.title}</strong>
        <span className="mono">{frame.detail}</span>
      </figcaption>
    </figure>
  );
}

export function TrimMonitor(): ReactNode {
  const t = useT();
  const view = useTrimMonitor((s) => s.view);
  const settings = useProjectStore((s) => s.project.settings);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const counter = useRef(0);
  const open = !!view;

  // Every change of the view bumps the token so queued renders for older positions are skipped.
  const tokenRef = useRef(() => counter.current);
  useLayoutEffect(() => {
    counter.current++;
  });

  useLayoutEffect(() => {
    if (!open) {
      frameGrabber.release();
      return;
    }
    const area = document.querySelector('.preview__area');
    const r = area?.getBoundingClientRect();
    setRect(r && r.width > 40 && r.height > 40 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
  }, [open]);

  if (!view || !rect) return null;
  const aspect = settings.width / settings.height;
  return createPortal(
    <div className={`trim-monitor trim-monitor--${view.mode}`} style={rect} data-trim-monitor={view.mode}>
      <div className="trim-monitor__pair">
        <FramePane frame={view.left} aspect={aspect} token={tokenRef.current} />
        <FramePane frame={view.right} aspect={aspect} token={tokenRef.current} />
      </div>
      <div className="trim-monitor__mode">{view.mode === 'roll' ? t('Roll edit') : t('Slip')}</div>
    </div>,
    document.body,
  );
}
