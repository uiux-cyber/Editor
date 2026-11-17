/**
 * File → Collect project…: choose a folder, copy every media file (optionally proxies) into
 * `<folder>/Media/`, write the project there with relative paths. Shows progress and can be
 * cancelled; reports missing files, low disk space and replaced projects up front.
 */

import { AlertTriangle, CircleCheck, FolderOpen, FolderSync } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/platform/api';
import { useProjectStore } from '@/store/project';
import { toast } from '@/store/ui';
import { Modal } from '../common/overlays';
import { formatNumber, formatSize, useT } from '../i18n';
import { openProject } from '../projectIO';
import { cancelCollect, inspectCollect, pickCollectFolder, runCollect, summarize, type CollectInspect, type CollectOutcome, type CollectProgress } from './collect';

type Phase = 'setup' | 'running' | 'done';

export function CollectDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const summary = useMemo(() => summarize(project), [project]);
  const [phase, setPhase] = useState<Phase>('setup');
  const [folder, setFolder] = useState<string | null>(null);
  const [includeProxies, setIncludeProxies] = useState(false);
  const [switchTo, setSwitchTo] = useState(true);
  const [info, setInfo] = useState<CollectInspect | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<CollectProgress | null>(null);
  const [outcome, setOutcome] = useState<CollectOutcome | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!folder) return;
    let alive = true;
    setChecking(true);
    void inspectCollect(folder, project, includeProxies)
      .then((r) => alive && setInfo(r))
      .catch((err) => toast('error', t('Could not read the folder'), (err as Error).message))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [folder, includeProxies, project, t]);

  const choose = async (): Promise<void> => {
    const picked = await pickCollectFolder(project.name);
    if (picked) setFolder(picked);
  };

  const start = async (): Promise<void> => {
    if (!folder) return;
    setPhase('running');
    setProgress(null);
    try {
      const res = await runCollect(folder, includeProxies, setProgress);
      if (res.cancelled) {
        toast('info', t('Collect cancelled'), t('Files copied so far were removed.'));
        setPhase('setup');
        setCancelling(false);
        return;
      }
      if (switchTo) {
        // Opening the copy closes this dialog, so report through toasts.
        await openProject(res.projectPath, { force: true });
        toast('success', t('Project collected — you are now working in the copy'), res.projectPath);
        if (res.failed.length) toast('warning', t('{count, plural, one {# file could not be copied} other {# files could not be copied}}', { count: res.failed.length }), res.failed.map((f) => f.name).join(', '));
        return;
      }
      setOutcome(res);
      setPhase('done');
    } catch (err) {
      toast('error', t('Could not collect the project'), (err as Error).message);
      setPhase('setup');
      setCancelling(false);
    }
  };

  const lowSpace = !!info && info.freeBytes !== null && info.freeBytes < info.totalBytes * 1.02;
  const pct = progress && progress.totalBytes > 0 ? Math.min(1, progress.bytes / progress.totalBytes) : progress && progress.count > 0 ? progress.done / progress.count : 0;

  if (phase === 'running') {
    return (
      <Modal title={t('Collecting project…')} onClose={() => undefined} dismissable={false} width={520}>
        <div className="collect-progress">
          <div className="progress" role="progressbar" aria-label={t('Copying media')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
            <div className="progress__bar" style={{ width: `${pct * 100}%` }} />
          </div>
          <div className="collect-progress__meta">
            <span className="truncate">{progress?.name ? t('Copying {name}', { name: progress.name }) : t('Preparing…')}</span>
            <span className="mono">
              {progress ? `${formatSize(progress.bytes)} / ${formatSize(progress.totalBytes)}` : ''}
            </span>
          </div>
          <div className="collect-progress__count">
            {progress ? t('File {done, number} of {count, number}', { done: Math.min(progress.count, progress.done + 1), count: progress.count }) : ''}
          </div>
        </div>
        <footer className="modal__foot modal__foot--inline">
          <button
            type="button"
            className="btn btn--outline"
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              cancelCollect();
            }}
          >
            {cancelling ? t('Cancelling…') : t('Cancel')}
          </button>
        </footer>
      </Modal>
    );
  }

  if (phase === 'done' && outcome) {
    return (
      <Modal title={t('Project collected')} onClose={onClose} width={520}>
        <div className="collect-done">
          <CircleCheck size={28} className="collect-done__icon" aria-hidden="true" />
          <div>
            <p>
              {t('{count, plural, =0 {No files needed copying.} one {# file copied.} other {# files copied.}}', { count: outcome.copied })}{' '}
              {outcome.reused > 0 && t('{count, plural, one {# file was already there.} other {# files were already there.}}', { count: outcome.reused })}
            </p>
            <p className="collect-done__path mono" title={outcome.projectPath}>
              {outcome.projectPath}
            </p>
          </div>
        </div>
        {outcome.failed.length > 0 && (
          <div className="collect-warn" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            <div>
              <strong>{t('{count, plural, one {# file could not be copied} other {# files could not be copied}}', { count: outcome.failed.length })}</strong>
              <ul>
                {outcome.failed.slice(0, 6).map((f) => (
                  <li key={f.name}>
                    {f.name} — {f.error}
                  </li>
                ))}
              </ul>
              <span>{t('The collected project still points at their original location.')}</span>
            </div>
          </div>
        )}
        <footer className="modal__foot modal__foot--inline">
          <button type="button" className="btn btn--outline" onClick={() => void api.app.showItemInFolder(outcome.projectPath)}>
            <FolderOpen size={14} /> {t('Show in folder')}
          </button>
          {!switchTo && (
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => {
                onClose();
                void openProject(outcome.projectPath);
              }}
            >
              {t('Open collected project')}
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('Done')}
          </button>
        </footer>
      </Modal>
    );
  }

  return (
    <Modal
      title={t('Collect project')}
      subtitle={t('Copy the project and every file it uses into one folder — to archive it or move it to another computer.')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!folder || checking || !info} onClick={() => void start()} data-action="collect">
            <FolderSync size={14} /> {t('Collect')}
          </button>
        </>
      }
    >
      <div className="collect-summary">
        <div>
          <strong>{formatNumber(summary.files)}</strong>
          <span>{t('{count, plural, one {media file} other {media files}}', { count: summary.files })}</span>
        </div>
        <div>
          <strong>{info ? formatSize(info.totalBytes) : '—'}</strong>
          <span>{t('to copy')}</span>
        </div>
        <div>
          <strong>{formatNumber(summary.generated)}</strong>
          <span>{t('built-in sounds (nothing to copy)')}</span>
        </div>
      </div>

      <div className="collect-field">
        <span className="collect-field__label" id="collect-dest">
          {t('Destination')}
        </span>
        <div className="collect-field__row">
          <span className={`collect-field__path mono ${folder ? '' : 'is-empty'}`} title={folder ?? ''} aria-labelledby="collect-dest">
            {folder ?? t('No folder chosen')}
          </span>
          <button type="button" className="btn btn--outline" onClick={() => void choose()} data-action="choose-folder">
            <FolderOpen size={14} /> {folder ? t('Change…') : t('Choose folder…')}
          </button>
        </div>
        <span className="collect-field__hint">{t('Media is copied to a “Media” folder next to the project file.')}</span>
      </div>

      {summary.proxies > 0 && (
        <label className="check-row">
          <input type="checkbox" checked={includeProxies} onChange={(e) => setIncludeProxies(e.target.checked)} />
          <span>{t('Include proxy files ({count, number})', { count: summary.proxies })}</span>
        </label>
      )}
      <label className="check-row">
        <input type="checkbox" checked={switchTo} onChange={(e) => setSwitchTo(e.target.checked)} data-option="switch" />
        <span>{t('Continue working in the collected copy')}</span>
      </label>

      {info && info.missing.length > 0 && (
        <div className="collect-warn" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{t('{count, plural, one {# file is missing and will be skipped.} other {# files are missing and will be skipped.}}', { count: info.missing.length })}</span>
        </div>
      )}
      {lowSpace && info && (
        <div className="collect-warn" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{t('Not enough free space: {needed} needed, {free} available.', { needed: formatSize(info.totalBytes), free: formatSize(info.freeBytes ?? 0) })}</span>
        </div>
      )}
      {info?.projectExists && (
        <div className="collect-warn" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{t('This folder already has a project with this name. It will be replaced; media already there is reused.')}</span>
        </div>
      )}
    </Modal>
  );
}
