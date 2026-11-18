/**
 * Settings → Updates: version, update status, "Check now" and automatic updates on / off.
 */

import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '@/platform/api';
import { AUTO_UPDATE_SETTING, RELEASES_URL } from '@shared/updates';
import { Toggle } from '../../common/controls';
import { formatRelative, useT } from '../../i18n';
import { checkForUpdates, installUpdate, setAutoUpdates, updateErrorText, useUpdates } from '../../shell/updates';
import type { SettingsSectionDef } from '../index';
import { SettingRow, SettingsGroup } from '../kit';
import { useSetting } from '../store';

function Updates(): ReactNode {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const current = useUpdates((s) => s.current);
  const [auto] = useSetting<boolean>(AUTO_UPDATE_SETTING, true);
  const unsupported = status.state === 'unsupported';
  const busy = status.state === 'checking' || status.state === 'downloading';

  let line: string;
  switch (status.state) {
    case 'unsupported':
      line = t('Development builds don’t update themselves. Installed copies of Kinora do.');
      break;
    case 'checking':
      line = t('Checking for updates…');
      break;
    case 'downloading':
      line = t('Downloading Kinora {version}… {percent}%', { version: status.version, percent: status.percent });
      break;
    case 'ready':
      line = t('Kinora {version} is ready. Restart to install it.', { version: status.version });
      break;
    case 'none':
      line = t('You have the latest version. Checked {when}.', { when: formatRelative(status.checkedAt) });
      break;
    case 'error':
      line = updateErrorText(status.code, status.detail);
      break;
    default:
      line = auto ? t('Kinora checks for updates a little after it starts, then every few hours.') : t('Automatic updates are off.');
  }

  return (
    <SettingsGroup title={t('Updates')}>
      <SettingRow label={current ? t('Kinora {version}', { version: current }) : 'Kinora'} description={<span role="status">{line}</span>}>
        {status.state === 'ready' ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void installUpdate()}>
            {t('Restart to update')}
          </button>
        ) : (
          <button type="button" className="btn btn--outline btn--sm" disabled={unsupported || busy} onClick={() => void checkForUpdates()} data-action="check-updates">
            {t('Check now')}
          </button>
        )}
      </SettingRow>
      <SettingRow
        label={t('Update automatically')}
        description={t('Download new versions in the background. Nothing installs until you restart or close Kinora.')}
      >
        <Toggle value={auto} disabled={unsupported} onChange={setAutoUpdates} title={t('Update automatically')} />
      </SettingRow>
      <SettingRow label={t('Release notes')} description={t('Every version and what changed, on GitHub.')}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void api.app.openExternal(RELEASES_URL)}>
          {t('Open')}
        </button>
      </SettingRow>
    </SettingsGroup>
  );
}

const sections: SettingsSectionDef[] = [
  {
    id: 'updates',
    title: 'Updates',
    order: 15,
    icon: <RefreshCw size={16} />,
    description: 'New versions and release notes',
    keywords: ['update', 'upgrade', 'version', 'automatic', 'release notes', 'download'],
    Component: Updates,
  },
];

export default sections;
