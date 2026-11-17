#!/usr/bin/env node
/**
 * End-to-end driver: launches the built app in Electron with an isolated profile and runs the
 * scenario in scripts/e2e/<name>.mjs (default: smoke). Screenshots and exports go to .e2e/.
 *
 *   npm run build && node scripts/e2e.mjs [scenario] [--packaged]
 */
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const scenario = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'smoke';
const outDir = path.join(root, '.e2e');
const userData = path.join(os.tmpdir(), `kinora-e2e-${process.pid}`);
await mkdir(outDir, { recursive: true });

// --packaged runs the installed-layout build in release/win-unpacked instead of the dev build.
const app = await electron.launch({
  executablePath: packaged ? path.join(root, 'release', 'win-unpacked', 'Kinora.exe') : electronPath,
  args: packaged ? [] : [root],
  cwd: root,
  // Off-screen and without focus unless KINORA_E2E_SHOW=1 (watch the run).
  env: { ...process.env, KINORA_USER_DATA: userData, KINORA_E2E_DIR: outDir, KINORA_E2E_HIDDEN: process.env.KINORA_E2E_SHOW === '1' ? '0' : '1' },
});

const problems = [];
let failed = false;
try {
  const win = await app.firstWindow();
  win.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') problems.push(`[${type}] ${msg.text()}`);
  });
  win.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
  await win.waitForLoadState('domcontentloaded');

  const ctx = {
    app,
    win,
    root,
    outDir,
    shot: async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await win.screenshot({ path: file });
      console.log(`  screenshot ${path.relative(root, file)}`);
      return file;
    },
    /** Run code in the renderer with access to the debug handle. */
    run: (fn, arg) => win.evaluate(fn, arg),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  const mod = await import(pathToFileURL(path.join(root, 'scripts/e2e', `${scenario}.mjs`)).href);
  await mod.default(ctx);
  console.log(`\n✔ scenario "${scenario}" finished`);
} catch (err) {
  failed = true;
  console.error(`\n✖ scenario "${scenario}" failed:`, err?.stack ?? err);
} finally {
  if (problems.length) {
    console.log(`\nRenderer console problems (${problems.length}):`);
    for (const p of problems.slice(0, 40)) console.log('  ' + p.slice(0, 600));
  } else {
    console.log('No renderer console errors or warnings.');
  }
  // Never leave an "unsaved changes" prompt blocking the exit.
  try {
    const w = app.windows()[0];
    if (w) await w.evaluate(() => window.kinora.app.setDirty(false));
  } catch {
    /* window already gone */
  }
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  try {
    app.process().kill();
  } catch {
    /* already exited */
  }
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
