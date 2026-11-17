/** Undoable edits of the colour data of visual clips (curves, wheels, LUT). */

import { identityCurves, isDefaultCurves, sanitizeCurves, type CurveChannel } from '@/core/color/curves';
import { isNeutralWheels, neutralWheels, sanitizeWheels, type WheelId } from '@/core/color/wheels';
import type { CurvePoints, Curves, ID, VisualClip, WheelValue } from '@/core/types';
import { editVisual } from '../actions';

export function clipCurves(clip: VisualClip): Curves {
  return clip.adjust?.curves ? sanitizeCurves(clip.adjust.curves) : identityCurves();
}

/** Write curves to every clip in `ids` (untouched curves remove the field). */
export function setCurves(ids: ID[], curves: Curves, coalesce?: string): void {
  editVisual(
    ids,
    (c) => {
      const adjust = { ...(c.adjust ?? {}) };
      if (isDefaultCurves(curves)) delete adjust.curves;
      else adjust.curves = curves;
      if (Object.keys(adjust).length) c.adjust = adjust;
      else delete c.adjust;
    },
    coalesce,
  );
}

export function setCurveChannel(ids: ID[], base: Curves, channel: CurveChannel, points: CurvePoints, coalesce?: string): void {
  setCurves(ids, { ...base, [channel]: points }, coalesce);
}

export function clipWheels(clip: VisualClip) {
  return clip.adjust?.wheels ? sanitizeWheels(clip.adjust.wheels) : neutralWheels();
}

export function setWheel(ids: ID[], primary: VisualClip, id: WheelId, patch: Partial<WheelValue>, coalesce?: string): void {
  const wheels = clipWheels(primary);
  wheels[id] = { ...wheels[id], ...patch };
  editVisual(
    ids,
    (c) => {
      const adjust = { ...(c.adjust ?? {}) };
      if (isNeutralWheels(wheels)) delete adjust.wheels;
      else adjust.wheels = wheels;
      if (Object.keys(adjust).length) c.adjust = adjust;
      else delete c.adjust;
    },
    coalesce,
  );
}

export function resetWheels(ids: ID[]): void {
  editVisual(ids, (c) => {
    if (!c.adjust?.wheels) return;
    const adjust = { ...c.adjust };
    delete adjust.wheels;
    if (Object.keys(adjust).length) c.adjust = adjust;
    else delete c.adjust;
  });
}

export function setLut(ids: ID[], id: string | null): void {
  editVisual(ids, (c) => {
    if (id) c.lut = { id, intensity: c.lut?.intensity ?? 1 };
    else delete c.lut;
  });
}

export function setLutIntensity(ids: ID[], intensity: number): void {
  editVisual(ids, (c) => {
    if (c.lut) c.lut.intensity = Math.min(1, Math.max(0, intensity));
  });
}
