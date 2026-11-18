/**
 * Automatic updates, renderer side: mirrors the main process's UpdateStatus (handlers/updates.ts),
 * tells the user what happened, and runs "Restart to update" safely (running exports and unsaved
 * changes are dealt with first, because the installer closes Kinora).
 */

import { create } from 'zustand';
import { cancelAll, useExportQueue } from '@/engine/export/queue';
import { isBusy } from '@/engine/export/queueState';
import { api, hasBridge } from '@/platform/api';
import { useUI } from '@/store/ui';
import { AUTO_UPDATE_SETTING, type UpdateErrorCode, type UpdateStatus } from '@shared/updates';
import { t } from '../i18n';
import { confirmDiscard } from '../projectIO';
import { setSetting } from '../settings/store';

interface UpdatesState {
  status: UpdateStatus;
  /** Version of the running app. */
  current: string;
}

export const useUpdates = create<UpdatesState>()(() => ({ status: { state: 'idle' }, current: '' }));

export const isUpdateReady = (): boolean => useUpdates.getState().status.state === 'ready';

/** Explanation of a failed check, in the interface language. */
export function updateErrorText(code: UpdateErrorCode, detail: string): string {
  switch (code) {
    case 'offline':
      return t('Kinora couldn’t reach the update server. Check your internet connection.');
    case 'unpublished':
      return t('No update information has been published yet.');
    case 'integrity':
      return t('The download didn’t pass its integrity check, so it was discarded.');
    case 'busy':
      return t('The update server is busy. Try again later.');
    default:
      return detail || t('Something went wrong.');
  }
}

/** The "Downloading…" notice, removed once the download finishes or fails. */
let downloadToast: number | null = null;

function announce(prev: UpdateStatus, next: UpdateStatus): void {
  const { toast, dismissToast } = useUI.getState();
  if (downloadToast !== null && next.state !== 'downloading') {
    dismissToast(downloadToast);
    downloadToast = null;
  }
  if (next.state === 'ready') {
    if (prev.state === 'ready' && prev.version === next.version) return;
    toast({
      kind: 'success',
      message: t('Kinora {version} is ready to install', { version: next.version }),
      detail: t('Restart now, or it installs the next time you close Kinora.'),
      action: { label: t('Restart now'), run: () => void installUpdate() },
      timeout: 15000,
    });
    return;
  }
  if (next.state === 'downloading' && next.manual && (prev.state !== 'downloading' || !prev.manual)) {
    downloadToast = toast({ kind: 'info', message: t('Downloading Kinora {version}…', { version: next.version }), detail: t('Keep working; you’ll be told when it’s ready.'), timeout: 0 });
    return;
  }
  if (next.state === 'none' && next.manual && prev.state === 'checking') {
    toast({ kind: 'success', message: t('Kinora is up to date'), detail: t('You have the latest version ({version}).', { version: useUpdates.getState().current }) });
    return;
  }
  if (next.state === 'error' && next.manual && prev.state !== 'error') {
    toast({ kind: 'error', message: t('Couldn’t check for updates'), detail: updateErrorText(next.code, next.detail), timeout: 9000 });
  }
}

function apply(next: UpdateStatus): void {
  const prev = useUpdates.getState().status;
  useUpdates.setState({ status: next });
  announce(prev, next);
}

let started = false;

/** Start following the main process's update status. Call once at startup. */
export function initUpdates(): () => void {
  if (started || !hasBridge) return () => undefined;
  started = true;
  void api.app.info().then((info) => useUpdates.setState({ current: info.version }));
  const off = api.on('x:updates:status', (s: UpdateStatus) => apply(s));
  void api
    .call<UpdateStatus>('x:updates:status')
    .then((s) => useUpdates.setState({ status: s }))
    .catch(() => useUpdates.setState({ status: { state: 'unsupported' } }));
  return () => {
    off();
    started = false;
  };
}

/** Help → Check for updates. When an update is already waiting, show it instead. */
export async function checkForUpdates(): Promise<void> {
  const { status } = useUpdates.getState();
  if (status.state === 'unsupported') {
    useUI.getState().toast({ kind: 'info', message: t('Updates are turned off in this build'), detail: t('Development builds don’t update themselves. Installed copies of Kinora do.') });
    return;
  }
  if (status.state === 'ready') {
    useUI.getState().openModal('update');
    return;
  }
  await api.call('x:updates:check');
}

/** Settings → Updates → "Update automatically". */
export function setAutoUpdates(on: boolean): void {
  setSetting(AUTO_UPDATE_SETTING, on);
  void api.call('x:updates:setAuto', on);
}

/**
 * Quit, install the downloaded update and start Kinora again. The installer closes Kinora, so
 * running exports and unsaved changes are settled first; the user can back out of either.
 */
export async function installUpdate(): Promise<void> {
  if (!isUpdateReady()) return;
  if (isBusy(useExportQueue.getState())) {
    const choice = await api.dialog.message({
      type: 'warning',
      title: t('Exports in progress'),
      message: t('Exports are still running.'),
      detail: t('Restarting now cancels them and removes the unfinished files.'),
      buttons: [t('Keep exporting'), t('Restart anyway')],
    });
    if (choice !== 1) return;
    cancelAll();
  }
  if (!(await confirmDiscard())) return;
  useUI.getState().openModal(null);
  // The user has saved or chosen to discard: closing must not ask again.
  await api.app.setDirty(false);
  const ok = await api.call<boolean>('x:updates:install');
  if (!ok) useUI.getState().toast({ kind: 'error', message: t('Couldn’t install the update'), detail: t('Close Kinora and the update installs on its own.') });
}
