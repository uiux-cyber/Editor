import { ArrowDownToLine, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '@/platform/api';
import { useUI } from '@/store/ui';
import { Modal } from '../common/overlays';
import { useT } from '../i18n';
import { installUpdate, useUpdates } from './updates';

/**
 * Title-bar notice for automatic updates: "Update" once a new version is downloaded and verified,
 * or the download progress while a check the user started is running. Hidden otherwise.
 */
export function UpdateButton(): ReactNode {
  const t = useT();
  const status = useUpdates((s) => s.status);
  if (status.state === 'ready') {
    return (
      <button
        type="button"
        className="update-btn is-ready"
        onClick={() => useUI.getState().openModal('update')}
        title={t('Kinora {version} is ready to install', { version: status.version })}
        data-action="update"
      >
        <ArrowDownToLine size={14} aria-hidden="true" />
        <span>{t('Update')}</span>
      </button>
    );
  }
  if (status.state === 'downloading' && status.manual) {
    return (
      <span className="update-btn" role="status" title={t('Downloading Kinora {version}…', { version: status.version })}>
        <ArrowDownToLine size={14} aria-hidden="true" />
        <span>{status.percent}%</span>
      </span>
    );
  }
  return null;
}

/** What's new in the downloaded version, with Restart now / Later. */
export function UpdateModal({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const current = useUpdates((s) => s.current);
  if (status.state !== 'ready') return null;
  return (
    <Modal
      title={t('Kinora {version} is ready', { version: status.version })}
      subtitle={current ? t('You have version {current}.', { current }) : undefined}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => void api.app.openExternal(status.url)}>
            <ExternalLink size={14} aria-hidden="true" />
            {t('Release page')}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('Later')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void installUpdate()} data-action="restart-to-update">
            {t('Restart now')}
          </button>
        </>
      }
    >
      <p className="update-modal__lead">{t('The update is downloaded and checked. Restart now, or it installs the next time you close Kinora. Your projects are not affected.')}</p>
      {status.notes ? (
        <>
          <h3 className="update-modal__heading">{t('What’s new')}</h3>
          <div className="update-modal__notes" tabIndex={0}>
            {status.notes}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
