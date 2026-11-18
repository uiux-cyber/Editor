/**
 * Automatic updates against a local update server (KINORA_UPDATE_FEED, honoured only in tests):
 * an unreachable server, "up to date", a download that fails its checksum, then a good update with
 * the title-bar button, the "What's new" dialog, Settings → Updates, the Help menu entry and
 * "Restart now". In tests the updater never runs an installer and caches in its own folder.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const NEXT = '9.9.0';
const payload = randomBytes(3 * 1024 * 1024);
const sha512 = (buf) => createHash('sha512').update(buf).digest('base64');
const cacheDir = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'kinora-updater-e2e');

let server = null;
let current = '0.0.0';
/** down: drop the connection · same: no newer version · corrupt: bad checksum · good: a real update */
let mode = 'down';
const requests = [];

function latestYml(version, hash) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: Kinora-Setup-${version}.exe`,
    `    sha512: ${hash}`,
    `    size: ${payload.length}`,
    `path: Kinora-Setup-${version}.exe`,
    `sha512: ${hash}`,
    "releaseDate: '2026-11-18T00:00:00.000Z'",
    `releaseNotes: "<h2>What's new</h2><ul><li>Faster exports</li><li>New templates &amp; stickers</li></ul><script>alert(1)</script><img src=x onerror=alert(2)>"`,
    '',
  ].join('\n');
}

function handle(req, res) {
  const url = (req.url ?? '').split('?')[0];
  requests.push(`${mode} ${req.method} ${url}`);
  if (mode === 'down') {
    req.socket.destroy();
    return;
  }
  if (url === '/latest.yml') {
    const version = mode === 'same' ? current : NEXT;
    const hash = mode === 'corrupt' ? sha512(Buffer.from('not the installer')) : sha512(payload);
    res.writeHead(200, { 'content-type': 'text/yaml' });
    res.end(latestYml(version, hash));
    return;
  }
  if (url === `/Kinora-Setup-${NEXT}.exe`) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length });
    res.end(payload);
    return;
  }
  res.writeHead(404);
  res.end();
}

export async function prepare({ root }) {
  current = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  await rm(cacheDir, { recursive: true, force: true });
  server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { KINORA_UPDATE_FEED: `http://127.0.0.1:${server.address().port}/` };
}

export async function cleanup() {
  await new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await rm(cacheDir, { recursive: true, force: true });
}

export default async function updates({ win, run, shot, sleep }) {
  const expect = (ok, msg) => {
    if (!ok) throw new Error(`expectation failed: ${msg}`);
    console.log(`  ✓ ${msg}`);
  };
  const status = () => run(() => window.kinora.call('x:updates:status'));
  const toastTitle = (text, timeout = 20000) => win.locator('.toast__title', { hasText: text }).first().waitFor({ timeout });
  const toastDetail = (text, timeout = 20000) => win.locator('.toast__detail', { hasText: text }).first().waitFor({ timeout });
  const clearToasts = () => run(() => window.__kinora?.useUI?.setState?.({ toasts: [] }));
  const checkNow = async () => {
    await clearToasts();
    await win.click('[data-action="check-updates"]');
  };

  await win.waitForSelector('.home', { timeout: 20000 });
  let s = await status();
  expect(s.state === 'idle', `the updater runs against the test server (state: ${s.state})`);
  expect(!(await win.locator('.update-btn').count()), 'no update button before an update is ready');

  // Help → Check for updates… is in the menu.
  await win.click('[data-menu="Help"]');
  expect(await win.locator('[role="menu"] >> text=Check for updates…').count(), 'Help menu lists "Check for updates…"');
  await win.keyboard.press('Escape');

  // Settings → Updates.
  await win.click('[data-action="settings"]');
  await win.click('[data-section="updates"]');
  await win.waitForSelector('[data-action="check-updates"]', { timeout: 10000 });
  expect(await win.locator(`text=Kinora ${current}`).count(), `Settings → Updates shows the running version (${current})`);
  await shot('updates-01-settings');

  // 1. Server unreachable.
  mode = 'down';
  await checkNow();
  await toastTitle('Couldn’t check for updates');
  await toastDetail('couldn’t reach the update server');
  s = await status();
  expect(s.state === 'error' && s.code === 'offline', `an unreachable server is reported as offline (${s.state}/${s.code}: ${s.detail})`);

  // 2. Already the latest version.
  mode = 'same';
  await checkNow();
  await toastTitle('Kinora is up to date');
  s = await status();
  expect(s.state === 'none', 'the same version is reported as up to date');
  await win.locator('text=You have the latest version.').first().waitFor({ timeout: 5000 });
  expect(true, 'Settings shows "You have the latest version"');

  // 3. A download that doesn't match its checksum is thrown away.
  mode = 'corrupt';
  await checkNow();
  await toastDetail('integrity check', 30000);
  s = await status();
  expect(s.state === 'error' && s.code === 'integrity', `a corrupt download is refused (${s.state}/${s.code}: ${s.detail})`);
  expect(!(await win.locator('.update-btn.is-ready').count()), 'no update is offered after a corrupt download');

  // 4. A good update downloads, verifies and is offered.
  mode = 'good';
  await checkNow();
  await toastTitle(`Kinora ${NEXT} is ready to install`, 30000);
  await win.waitForSelector('.update-btn.is-ready', { timeout: 5000 });
  expect(!(await win.locator('.toast__title', { hasText: 'Downloading Kinora' }).count()), 'the "Downloading…" notice is gone once the update is ready');
  s = await status();
  expect(s.state === 'ready' && s.version === NEXT, `version ${NEXT} is downloaded and ready`);
  expect(s.notes.includes('• Faster exports') && s.notes.includes('New templates & stickers'), 'release notes arrive as plain text');
  expect(!/<|alert|onerror/.test(s.notes), 'no markup or script survives in the release notes');
  expect(requests.some((r) => r === `good GET /Kinora-Setup-${NEXT}.exe`), 'the installer was downloaded from the update server');
  const pending = path.join(cacheDir, 'pending');
  const files = existsSync(pending) ? readdirSync(pending).filter((f) => f.endsWith('.exe')) : [];
  expect(files.length === 1 && statSync(path.join(pending, files[0])).size === payload.length, `the verified download sits in the test cache (${files.join(', ') || 'none'})`);
  expect(await win.locator('button', { hasText: 'Restart to update' }).count(), 'Settings offers "Restart to update"');
  await shot('updates-02-ready-settings');

  // 5. The title-bar button opens "What's new".
  await win.keyboard.press('Escape');
  await win.waitForSelector('.settings', { state: 'detached', timeout: 5000 }).catch(() => undefined);
  await win.click('.update-btn.is-ready');
  await win.waitForSelector('.update-modal__notes', { timeout: 5000 });
  const notes = await win.locator('.update-modal__notes').innerText();
  expect(notes.includes('Faster exports'), 'the dialog shows what\'s new');
  expect(await win.locator(`text=Kinora ${NEXT} is ready`).count(), 'the dialog names the new version');
  await shot('updates-03-whats-new');

  // 6. Restart now: nothing unsaved on the start screen, so it goes straight to the installer
  //    (which tests never run).
  await clearToasts();
  await win.click('[data-action="restart-to-update"]');
  await win.waitForSelector('.update-modal__notes', { state: 'detached', timeout: 5000 });
  await sleep(600);
  expect(!(await win.locator('.toast__title', { hasText: 'Couldn’t install the update' }).count()), 'Restart now hands over to the installer without errors');

  // 7. Later checks keep the ready update.
  await run(() => window.kinora.call('x:updates:check'));
  s = await status();
  expect(s.state === 'ready', 'a later check keeps the downloaded update');
}
