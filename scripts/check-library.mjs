#!/usr/bin/env node
/**
 * Validates Kinora's content packs in a real Chromium (WebGL2 + Web Audio):
 *   node scripts/check-library.mjs                 # every pack
 *   node scripts/check-library.mjs transitions     # one or more packs
 * Packs: transitions effects generators filters animations textAnimations textPresets stickers
 *        sounds templates packs (bundled resources/packs/*.kinorapack)
 * Exit code 1 when any error is reported. Add --quiet-warnings to hide warnings.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const packs = args.filter((a) => !a.startsWith('--'));
const quietWarnings = args.includes('--quiet-warnings');
const outDir = path.join(os.tmpdir(), `kinora-check-${process.pid}`);

try {
  await build({
    configFile: false,
    root: path.join(root, 'scripts/checker'),
    base: './',
    logLevel: 'error',
    resolve: {
      alias: {
        '@': path.join(root, 'src/renderer/src'),
        '@shared': path.join(root, 'src/shared'),
      },
    },
    build: { outDir, emptyOutDir: true, minify: false, target: 'chrome140', reportCompressedSize: false },
  });
} catch (err) {
  console.error('\n✖ The library failed to compile (TypeScript/bundling error):\n');
  console.error(err?.message ?? err);
  process.exit(1);
}

const child = spawn(electronPath, [path.join(root, 'scripts/checker/main.cjs'), path.join(outDir, 'index.html'), packs.join(',')], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
});

const issues = [];
let summary = null;
let fatal = null;
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line.startsWith('__CHECK__')) issues.push(JSON.parse(line.slice(9)));
    else if (line.startsWith('__DONE__')) summary = JSON.parse(line.slice(8));
    else if (line.startsWith('__FATAL__')) fatal = line.slice(9);
    else if (line.startsWith('__LOG__')) console.log('  [page] ' + line.slice(7));
  }
});
child.stderr.on('data', () => {});

child.on('exit', async () => {
  await rm(outDir, { recursive: true, force: true }).catch(() => {});
  if (fatal || !summary) {
    console.error(`\n✖ Checker did not complete: ${fatal ?? 'no result received'}`);
    process.exit(2);
  }
  const byPack = new Map();
  for (const issue of issues) {
    if (issue.level === 'warn' && quietWarnings) continue;
    if (!byPack.has(issue.pack)) byPack.set(issue.pack, []);
    byPack.get(issue.pack).push(issue);
  }
  for (const [pack, list] of byPack) {
    console.log(`\n${pack}`);
    for (const i of list) console.log(`  ${i.level === 'error' ? '✖' : '⚠'} ${i.id}: ${i.msg}`);
  }
  const countLine = Object.entries(summary.counts)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ');
  console.log(`\nChecked: ${countLine || '(nothing)'}`);
  console.log(`${summary.errors === 0 ? '✔' : '✖'} ${summary.errors} error(s), ${summary.warnings} warning(s)`);
  process.exit(summary.errors === 0 ? 0 : 1);
});
