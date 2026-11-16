/**
 * Pointer-driven drag & drop from the library to the timeline / preview. HTML5 drag events are
 * avoided on purpose: pointer events give precise positions, a custom ghost and no flicker.
 */

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { ID, ShapeKind } from '@/core/types';
import type { TemplateVariation } from '@/library/templateEngine';

export type DragPayload =
  | { kind: 'asset'; assetId: ID }
  | { kind: 'text'; presetId: string | null }
  | { kind: 'sticker'; stickerId: string }
  | { kind: 'shape'; shape: ShapeKind }
  | { kind: 'generator'; generatorId: string }
  | { kind: 'adjustment' }
  | { kind: 'sound'; soundId: string; duration: number }
  | { kind: 'transition'; type: string }
  | { kind: 'effect'; effectId: string }
  | { kind: 'filter'; filterId: string }
  | { kind: 'template'; variation: TemplateVariation; duration: number };

export interface DropTarget {
  over: (payload: DragPayload, x: number, y: number) => boolean;
  leave: () => void;
  drop: (payload: DragPayload, x: number, y: number) => void;
}

interface DragState {
  payload: DragPayload | null;
  label: string;
  x: number;
  y: number;
  /** Whether the element under the pointer accepts the payload. */
  accepted: boolean;
}

export const useDrag = create<DragState>()(() => ({ payload: null, label: '', x: 0, y: 0, accepted: false }));

const targets = new Map<HTMLElement, DropTarget>();

export function registerDropTarget(el: HTMLElement, target: DropTarget): () => void {
  targets.set(el, target);
  return () => targets.delete(el);
}

function targetAt(x: number, y: number): { el: HTMLElement; target: DropTarget } | null {
  let node = document.elementFromPoint(x, y) as HTMLElement | null;
  while (node) {
    const target = targets.get(node);
    if (target) return { el: node, target };
    node = node.parentElement;
  }
  return null;
}

const DRAG_THRESHOLD = 5;

/**
 * Start a potential drag from a library tile. A press without movement counts as a click and
 * runs `onClick` (the "add at playhead" quick action).
 */
export function startDrag(e: React.PointerEvent, payload: DragPayload, label: string, onClick?: () => void): void {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let current: { el: HTMLElement; target: DropTarget } | null = null;

  const move = (ev: PointerEvent): void => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      document.body.classList.add('is-dragging');
    }
    const hit = targetAt(ev.clientX, ev.clientY);
    if (current && current.el !== hit?.el) current.target.leave();
    current = hit;
    const accepted = hit ? hit.target.over(payload, ev.clientX, ev.clientY) : false;
    useDrag.setState({ payload, label, x: ev.clientX, y: ev.clientY, accepted });
  };
  const finish = (ev: PointerEvent, cancelled: boolean): void => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('keydown', key, true);
    document.body.classList.remove('is-dragging');
    if (dragging) {
      const hit = cancelled ? null : targetAt(ev.clientX, ev.clientY);
      if (current && current.el !== hit?.el) current.target.leave();
      if (hit && hit.target.over(payload, ev.clientX, ev.clientY)) hit.target.drop(payload, ev.clientX, ev.clientY);
      hit?.target.leave();
      current?.target.leave();
      useDrag.setState({ payload: null, label: '', accepted: false });
    } else if (!cancelled) {
      onClick?.();
    }
  };
  const up = (ev: PointerEvent): void => finish(ev, false);
  const cancel = (ev: PointerEvent): void => finish(ev, true);
  const key = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && dragging) {
      ev.stopPropagation();
      finish(new PointerEvent('pointercancel'), true);
    }
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('keydown', key, true);
}

/** Floating label that follows the pointer while dragging a library item. */
export function DragGhost(): ReactNode {
  const { payload, label, x, y, accepted } = useDrag();
  if (!payload) return null;
  return createPortal(
    <div className={`drag-ghost ${accepted ? 'is-accepted' : ''}`} style={{ transform: `translate(${x + 14}px, ${y + 16}px)` }}>
      {label}
    </div>,
    document.body,
  );
}
