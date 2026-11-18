import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import { AUTO_UPDATE_SETTING, CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, classifyUpdateError, releaseNotesToText, releasePageUrl, type UpdateStatus } from '@shared/updates';
import type { MainContext } from '../context';

/**
 * Automatic updates from the project's GitHub releases (electron-updater).
 *
 * The installed app checks 20 s after start-up and then every 4 hours (Settings → Updates can turn
 * this off), downloads a newer version in the background and verifies its SHA-512 checksum. The
 * renderer then offers "Restart to update"; otherwise the update installs silently when Kinora is
 * closed. Nothing is installed without a finished, verified download.
 *
 *  - `x:updates:status`  → the current UpdateStatus (also pushed as the `x:updates:status` event)
 *  - `x:updates:check`   → check now (manual: the renderer reports the outcome)
 *  - `x:updates:install` → quit, install and relaunch; the renderer has already dealt with unsaved
 *                          work and running exports, because the installer closes Kinora
 *  - `x:updates:setAuto` → turn automatic checks on or off
 *
 * Development builds and automated tests never contact GitHub. Tests can point the updater at a
 * local feed with KINORA_UPDATE_FEED (only honoured together with KINORA_E2E_DIR); in that mode
 * nothing is ever installed and downloads go to a separate cache folder.
 */
export default function register(ctx: MainContext): void {
  const testFeed = ctx.e2eDir ? (process.env.KINORA_UPDATE_FEED ?? null) : null;
  const supported = testFeed !== null || (app.isPackaged && !ctx.e2eDir && process.platform === 'win32');

  let status: UpdateStatus = supported ? { state: 'idle' } : { state: 'unsupported' };
  let updater: AppUpdater | null = null;
  let manual = false;
  let lastPercent = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: UpdateStatus): void => {
    status = next;
    ctx.send('x:updates:status', next);
  };

  const onError = (err: unknown): void => {
    // A finished download stays ready even if a later background check fails.
    if (status.state === 'ready') return;
    const { code, detail } = classifyUpdateError(err);
    if (status.state === 'error' && status.detail === detail) return;
    console.warn('[updates]', detail);
    publish({ state: 'error', manual, code, detail });
  };

  async function getUpdater(): Promise<AppUpdater> {
    if (updater) return updater;
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.logger = {
      info: (m?: unknown) => console.info('[updates]', m),
      warn: (m?: unknown) => console.warn('[updates]', m),
      error: (m?: unknown) => console.error('[updates]', m),
      debug: () => undefined,
    };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = testFeed === null;
    autoUpdater.allowDowngrade = false;
    if (testFeed && ctx.e2eDir) {
      const config = path.join(ctx.e2eDir, 'app-update.yml');
      fs.writeFileSync(config, `provider: generic\nurl: ${JSON.stringify(testFeed)}\nupdaterCacheDirName: kinora-updater-e2e\n`);
      autoUpdater.forceDevUpdateConfig = true;
      autoUpdater.updateConfigPath = config;
      autoUpdater.disableDifferentialDownload = true;
    }

    autoUpdater.on('checking-for-update', () => publish({ state: 'checking', manual }));
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      lastPercent = 0;
      publish({ state: 'downloading', manual, version: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      const percent = Math.max(0, Math.min(100, Math.floor(p.percent)));
      if (status.state !== 'downloading' || percent === lastPercent) return;
      lastPercent = percent;
      publish({ ...status, percent });
    });
    autoUpdater.on('update-not-available', () => publish({ state: 'none', manual, checkedAt: Date.now() }));
    autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
      publish({ state: 'ready', version: info.version, notes: releaseNotesToText(info.releaseNotes), url: releasePageUrl(info.version) }),
    );
    autoUpdater.on('error', onError);
    updater = autoUpdater;
    return autoUpdater;
  }

  async function check(isManual: boolean): Promise<UpdateStatus> {
    if (!supported || status.state === 'ready') return status;
    if (status.state === 'checking' || status.state === 'downloading') {
      // Already busy: a manual check just makes the progress visible.
      if (isManual && !status.manual) {
        manual = true;
        publish({ ...status, manual: true });
      }
      return status;
    }
    manual = isManual;
    try {
      const u = await getUpdater();
      const result = await u.checkForUpdates();
      // Download failures are reported through the 'error' event.
      result?.downloadPromise?.catch(() => undefined);
    } catch (err) {
      onError(err);
    }
    return status;
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    // Tests drive every check themselves.
    if (!supported || testFeed) return;
    if (ctx.settings.get<boolean>(AUTO_UPDATE_SETTING, true) === false) return;
    const next = (delay: number): void => {
      timer = setTimeout(() => {
        void check(false).finally(() => next(CHECK_INTERVAL_MS));
      }, delay);
    };
    next(FIRST_CHECK_DELAY_MS);
  }

  ctx.handle('x:updates:status', (): UpdateStatus => status);
  ctx.handle('x:updates:check', (): Promise<UpdateStatus> => check(true));
  ctx.handle('x:updates:setAuto', (on: boolean) => {
    ctx.settings.set(AUTO_UPDATE_SETTING, on !== false);
    schedule();
  });
  ctx.handle('x:updates:install', (): boolean => {
    if (status.state !== 'ready' || !updater) return false;
    // Automated tests stop here: the test installer is never run.
    if (testFeed) return true;
    const u = updater;
    // Silent install, then start Kinora again.
    setImmediate(() => u.quitAndInstall(true, true));
    return true;
  });

  schedule();
}
