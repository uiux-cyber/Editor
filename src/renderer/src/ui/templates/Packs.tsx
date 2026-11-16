import { CircleAlert, FileDown, Package, PackagePlus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from '@/store/ui';
import samplePackText from '../../../../../resources/packs/sample.kinorapack?raw';
import { Modal } from '../common/overlays';
import './templates.css';
import { errorText, installPackText, pickPackFile, removePack, useTemplates, type InstallResult } from './store';

interface Failure {
  name: string;
  errors: string[];
}

/** Ask for a pack file, validate it and install it. Returns the result (null when cancelled). */
export async function installPackFromFile(): Promise<InstallResult | null> {
  let picked: { name: string; text: string } | null;
  try {
    picked = await pickPackFile();
  } catch (err) {
    return { ok: false, errors: [errorText(err)], warnings: [] };
  }
  if (!picked) return null;
  return installPackText(picked.text);
}

function announce(res: InstallResult): void {
  if (!res.ok || !res.pack) return;
  toast('success', `${res.replaced ? 'Updated' : 'Installed'} “${res.pack.name}”`, res.pack.summary ? `Added ${res.pack.summary}.` : undefined);
}

/** The installed packs, with install / remove (Content packs window and Settings › Content packs). */
export function PacksPanel({ installOnOpen = false }: { installOnOpen?: boolean }): ReactNode {
  const packs = useTemplates((s) => s.packs);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const autoRan = useRef(false);

  const run = async (source: 'file' | 'sample'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = source === 'file' ? await installPackFromFile() : await installPackText(samplePackText);
      if (!res) return;
      if (res.ok) announce(res);
      else setFailure({ name: source === 'sample' ? 'Sample pack' : 'This pack', errors: res.errors });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (installOnOpen && !autoRan.current) {
      autoRan.current = true;
      void run('file');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installOnOpen]);

  const sampleInstalled = packs.some((p) => p.id === 'kinora-sample');

  return (
    <div className="packs">
      <div className="packs__actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void run('file')} data-testid="install-pack">
          {busy ? <span className="spinner" /> : <PackagePlus size={14} />} Install content pack…
        </button>
        {!sampleInstalled && (
          <button type="button" className="btn btn--outline" disabled={busy} onClick={() => void run('sample')}>
            <FileDown size={14} /> Install the sample pack
          </button>
        )}
      </div>

      {failure && (
        <div className="packs__failure" role="alert" data-testid="pack-errors">
          <div className="packs__failure-title">
            <CircleAlert size={15} /> {failure.name} can’t be installed
          </div>
          <ul>
            {failure.errors.slice(0, 12).map((e, i) => (
              <li key={i} className="mono">
                {e}
              </li>
            ))}
            {failure.errors.length > 12 && <li>…and {failure.errors.length - 12} more problems</li>}
          </ul>
        </div>
      )}

      {packs.length === 0 ? (
        <div className="empty packs__empty">
          <div className="empty__icon">
            <Package size={20} />
          </div>
          <div className="empty__title">No content packs yet</div>
          <p>Packs add palettes, font pairings, filters, text styles, transitions, effects, backgrounds and templates.</p>
        </div>
      ) : (
        <div className="packs__list">
          {packs.map((p) => (
            <div key={p.id} className={`pack-card ${p.loaded ? '' : 'is-broken'}`} data-pack={p.id}>
              <span className="pack-card__icon">
                <Package size={18} />
              </span>
              <div className="pack-card__body">
                <div className="pack-card__title">
                  <strong className="truncate">{p.name}</strong>
                  {p.packVersion && <span className="badge">v{p.packVersion}</span>}
                </div>
                <div className="pack-card__meta">
                  {p.loaded ? p.summary : 'Not loaded'}
                  {p.author ? ` · by ${p.author}` : ''}
                </div>
                {p.description && <p className="pack-card__desc">{p.description}</p>}
                {!p.loaded && (
                  <ul className="pack-card__errors">
                    {p.errors.slice(0, 4).map((e, i) => (
                      <li key={i} className="mono">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {confirm === p.id ? (
                <div className="pack-card__confirm">
                  <span>Remove?</span>
                  <button type="button" className="btn btn--sm btn--outline" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={() => {
                      setConfirm(null);
                      void removePack(p.id).then(() => toast('info', `Removed “${p.name}”`, 'Projects that used its items show them as missing until it is installed again.'));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button type="button" className="icon-btn" title="Remove this pack" onClick={() => setConfirm(p.id)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="packs__note">
        <ShieldCheck size={13} /> Packs are data only (JSON and shader code). Every pack is checked before it is installed — shaders are compiled in an isolated context and nothing in a pack can run
        programs on your PC.
      </p>
    </div>
  );
}

export function PacksWindow({ onClose, installOnOpen }: { onClose: () => void; installOnOpen?: boolean }): ReactNode {
  return (
    <Modal title="Content packs" subtitle="Add palettes, styles, effects and templates made by others." onClose={onClose} width={640} footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn--primary" onClick={onClose}>Done</button></>}>
      <PacksPanel installOnOpen={installOnOpen} />
    </Modal>
  );
}
