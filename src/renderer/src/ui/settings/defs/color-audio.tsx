/** Settings → Colour LUTs: manage the LUT library (import, rename, delete). */

import { FolderInput, Palette, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { deleteLut, refreshLutLibrary, renameLut, useLutLibrary, BUILTIN_LUT_INFOS } from '@/engine/color/lutStore';
import { toast } from '@/store/ui';
import { importLutsWithFeedback } from '../../coloraudio/LutPanel';
import type { SettingsSectionDef } from '../index';
import '../../coloraudio/color-audio.css';

function LutLibrarySettings(): ReactNode {
  const user = useLutLibrary((s) => s.user);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    void refreshLutLibrary().catch(() => undefined);
  }, []);
  return (
    <div className="lut-settings">
      <p className="hint">
        Imported <span className="mono">.cube</span> LUTs (1D and 3D, up to 65 points) are copied into Kinora's library so projects keep working if the original file moves. {BUILTIN_LUT_INFOS.length} built-in looks are always available.
      </p>
      <div className="lut-settings__list" data-lut-library>
        {user.length === 0 && <div className="lut-settings__empty">No imported LUTs yet.</div>}
        {user.map((l) => (
          <div key={l.id} className="lut-settings__row" data-lut-row={l.id}>
            {renaming === l.id ? (
              <input
                autoFocus
                className="input"
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
            ) : (
              <span className="lut-settings__name truncate" onDoubleClick={() => setRenaming(l.id)}>
                {l.name}
              </span>
            )}
            <span className="lut-settings__meta mono">
              {l.kind.toUpperCase()} · {l.size}
            </span>
            {confirm === l.id ? (
              <>
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  onClick={() => {
                    setConfirm(null);
                    void deleteLut(l.id).then(
                      () => toast('success', `Deleted “${l.name}”`),
                      (err) => toast('error', 'Could not delete the LUT', (err as Error).message),
                    );
                  }}
                >
                  Delete
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" className="icon-btn icon-btn--sm" title="Rename" onClick={() => setRenaming(l.id)}>
                  <Pencil size={12} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" title="Delete from library" onClick={() => setConfirm(l.id)}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--sm btn--outline" onClick={() => void importLutsWithFeedback()}>
        <FolderInput size={13} /> Import .cube…
      </button>
    </div>
  );
}

const sections: SettingsSectionDef[] = [{ id: 'color-luts', title: 'Colour LUTs', icon: <Palette size={15} />, order: 60, Component: LutLibrarySettings }];

export default sections;
