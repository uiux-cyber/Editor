/**
 * LUT section of the Adjust tab: a library of looks (built-ins + imported .cube files) shown as
 * thumbnails rendered through each LUT, import, rename / delete (context menu), intensity, and a
 * clear warning when a clip references a LUT that is not available.
 */

import { AlertTriangle, FolderInput, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { sampleCube } from '@shared/cube';
import type { ID, VisualClip } from '@/core/types';
import { allLuts, deleteLut, getLutData, importLutFiles, lutDisplayName, lutStatus, lutVersion, refreshLutLibrary, renameLut, useLutLibrary, type LutInfo } from '@/engine/color/lutStore';
import { toast, useUI } from '@/store/ui';
import { SliderField } from '../common/controls';
import { Modal, openContextMenu } from '../common/overlays';
import { setLut, setLutIntensity } from './gradeEdit';

const THUMB_W = 96;
const THUMB_H = 54;

let reference: ImageData | null = null;
/** A small procedural scene with sky, skin, foliage and a grey ramp — shows a look at a glance. */
function referenceImage(): ImageData {
  if (reference) return reference;
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, THUMB_H * 0.62);
  sky.addColorStop(0, '#3d6fb8');
  sky.addColorStop(0.65, '#9cc3e8');
  sky.addColorStop(1, '#f2c79a');
  g.fillStyle = sky;
  g.fillRect(0, 0, THUMB_W, THUMB_H);
  const sun = g.createRadialGradient(THUMB_W * 0.74, THUMB_H * 0.5, 1, THUMB_W * 0.74, THUMB_H * 0.5, THUMB_H * 0.45);
  sun.addColorStop(0, 'rgba(255,240,200,0.95)');
  sun.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, THUMB_W, THUMB_H);
  g.fillStyle = '#3f6a2e';
  g.beginPath();
  g.moveTo(0, THUMB_H * 0.62);
  g.quadraticCurveTo(THUMB_W * 0.3, THUMB_H * 0.48, THUMB_W * 0.62, THUMB_H * 0.64);
  g.quadraticCurveTo(THUMB_W * 0.85, THUMB_H * 0.72, THUMB_W, THUMB_H * 0.6);
  g.lineTo(THUMB_W, THUMB_H);
  g.lineTo(0, THUMB_H);
  g.fill();
  const hill = g.createLinearGradient(0, THUMB_H * 0.6, 0, THUMB_H);
  hill.addColorStop(0, 'rgba(120,170,80,0.5)');
  hill.addColorStop(1, 'rgba(20,35,15,0.7)');
  g.fillStyle = hill;
  g.fill();
  // Skin tone.
  const skin = g.createRadialGradient(THUMB_W * 0.27, THUMB_H * 0.42, 2, THUMB_W * 0.27, THUMB_H * 0.47, 12);
  skin.addColorStop(0, '#f1c4a4');
  skin.addColorStop(1, '#a8694a');
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(THUMB_W * 0.27, THUMB_H * 0.47, 9, 11, 0, 0, Math.PI * 2);
  g.fill();
  // Grey ramp.
  const ramp = g.createLinearGradient(0, 0, THUMB_W, 0);
  ramp.addColorStop(0, '#000');
  ramp.addColorStop(1, '#fff');
  g.fillStyle = ramp;
  g.fillRect(0, THUMB_H - 5, THUMB_W, 5);
  reference = g.getImageData(0, 0, THUMB_W, THUMB_H);
  return reference;
}

const thumbs = new Map<string, string>();
function lutThumb(id: string | null): string | null {
  const key = id ? `${id}#${lutVersion(id)}` : 'none';
  const hit = thumbs.get(key);
  if (hit) return hit;
  const ref = referenceImage();
  let out = ref;
  if (id) {
    const lut = getLutData(id);
    if (!lut) return null;
    out = new ImageData(THUMB_W, THUMB_H);
    for (let i = 0; i < ref.data.length; i += 4) {
      const [r, g, b] = sampleCube(lut, ref.data[i] / 255, ref.data[i + 1] / 255, ref.data[i + 2] / 255);
      out.data[i] = r * 255;
      out.data[i + 1] = g * 255;
      out.data[i + 2] = b * 255;
      out.data[i + 3] = 255;
    }
  }
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  c.getContext('2d')!.putImageData(out, 0, 0);
  const url = c.toDataURL();
  thumbs.set(key, url);
  return url;
}

function LutTile({ info, active, onPick, onRename, owner }: { info: LutInfo | null; active: boolean; onPick: () => void; onRename?: () => void; owner?: string }): ReactNode {
  useLutLibrary((s) => s.revision);
  const url = lutThumb(info?.id ?? null);
  const status = info ? lutStatus(info.id) : 'ready';
  return (
    <button
      type="button"
      className={`lut-tile ${active ? 'is-active' : ''}`}
      data-lut={info?.id ?? 'none'}
      title={info ? `${info.name}${info.description ? ` — ${info.description}` : ''}${info.builtin ? '' : ` · ${info.kind.toUpperCase()} ${info.size}`}` : 'No LUT'}
      onClick={onPick}
      onContextMenu={(e) => {
        if (!info || info.builtin) return;
        openContextMenu(e, [
          { label: 'Rename…', icon: <Pencil size={14} />, run: () => onRename?.() },
          { type: 'separator' },
          { label: 'Delete from library…', icon: <Trash2 size={14} />, danger: true, run: () => useLutDelete.setState({ info, owner: owner ?? null }) },
        ]);
      }}
    >
      <span className="lut-tile__img">
        {url ? <img src={url} alt="" draggable={false} /> : <span className={`lut-tile__ph ${status === 'error' ? 'is-error' : ''}`} />}
        {!info && <span className="lut-tile__none">None</span>}
      </span>
      <span className="lut-tile__name truncate">{info ? info.name : 'None'}</span>
    </button>
  );
}

// Delete confirmation: owned by the grid that opened it (several grids can be mounted).
const useLutDelete = create<{ info: LutInfo | null; owner: string | null }>()(() => ({ info: null, owner: null }));

function DeleteDialog({ owner }: { owner: string }): ReactNode {
  const info = useLutDelete((s) => (s.owner === owner ? s.info : null));
  if (!info) return null;
  const close = (): void => useLutDelete.setState({ info: null, owner: null });
  return (
    <Modal
      title="Delete LUT?"
      onClose={close}
      width={400}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            data-action="confirm-delete-lut"
            onClick={() => {
              close();
              void deleteLut(info.id).then(
                () => toast('success', `Deleted “${info.name}”`),
                (err) => toast('error', 'Could not delete the LUT', (err as Error).message),
              );
            }}
          >
            Delete
          </button>
        </>
      }
    >
      <p className="hint" style={{ color: 'var(--text-1)', fontSize: 12.5 }}>
        “{info.name}” will be removed from your LUT library. Clips that use it will show without the look until you import it again.
      </p>
    </Modal>
  );
}

export async function importLutsWithFeedback(applyTo?: ID[]): Promise<void> {
  try {
    const res = await importLutFiles();
    if (res.imported.length) {
      toast('success', res.imported.length === 1 ? `Imported “${res.imported[0].name}”` : `Imported ${res.imported.length} LUTs`);
      if (applyTo?.length) setLut(applyTo, res.imported[0].id);
    }
    for (const f of res.failures) useUI.getState().toast({ kind: 'error', message: `Could not import ${f.name}`, detail: f.error });
  } catch (err) {
    toast('error', 'Could not import the LUT', (err as Error).message);
  }
}

/** Library grid (also used by the Settings page, without a clip). */
export function LutGrid({ activeId, onPick, showNone = true }: { activeId: string | null; onPick: (id: string | null) => void; showNone?: boolean }): ReactNode {
  const user = useLutLibrary((s) => s.user);
  const loaded = useLutLibrary((s) => s.loaded);
  const [renaming, setRenaming] = useState<string | null>(null);
  const owner = useId();
  useEffect(() => {
    if (!loaded) void refreshLutLibrary().catch((err) => console.warn('[lut] library unavailable', err));
  }, [loaded]);
  const luts = useMemo(() => allLuts(), [user]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="lut-grid">
        {showNone && <LutTile info={null} active={!activeId} onPick={() => onPick(null)} />}
        {luts.map((l) =>
          renaming === l.id ? (
            <div key={l.id} className="lut-tile is-renaming">
              <span className="lut-tile__img">{lutThumb(l.id) && <img src={lutThumb(l.id)!} alt="" />}</span>
              <input
                autoFocus
                className="input lut-tile__rename"
                defaultValue={l.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  setRenaming(null);
                  if (name && name !== l.name) void renameLut(l.id, name).catch((err) => toast('error', 'Could not rename the LUT', (err as Error).message));
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            </div>
          ) : (
            <LutTile key={l.id} info={l} owner={owner} active={activeId === l.id} onPick={() => onPick(l.id)} onRename={() => setRenaming(l.id)} />
          ),
        )}
      </div>
      <DeleteDialog owner={owner} />
    </>
  );
}

export function LutPanel({ clip, ids }: { clip: VisualClip; ids: ID[] }): ReactNode {
  useLutLibrary((s) => s.revision);
  useLutLibrary((s) => s.user);
  const ref = clip.lut;
  const status = ref ? lutStatus(ref.id) : 'ready';
  // Kick off loading so the status settles.
  if (ref) getLutData(ref.id);
  return (
    <div className="lut-panel">
      {ref && (status === 'missing' || status === 'error') && (
        <div className="lut-missing" data-lut-missing>
          <AlertTriangle size={14} />
          <span>
            <strong>{lutDisplayName(ref.id)}</strong> is not available on this computer. The clip is shown without it.
          </span>
          <button type="button" className="btn btn--sm btn--outline" onClick={() => setLut(ids, null)}>
            Remove
          </button>
        </div>
      )}
      <LutGrid activeId={ref?.id ?? null} onPick={(id) => setLut(ids, id)} />
      {ref && <SliderField label="Intensity" value={ref.intensity} min={0} max={1} step={0.01} scale={100} suffix="%" defaultValue={1} onChange={(v) => setLutIntensity(ids, v)} />}
      <div className="lut-panel__actions">
        <button type="button" className="btn btn--sm btn--outline" data-action="import-lut" onClick={() => void importLutsWithFeedback(ids)}>
          <FolderInput size={13} /> Import .cube…
        </button>
        <span className="hint">Right-click an imported LUT to rename or delete it.</span>
      </div>
    </div>
  );
}
