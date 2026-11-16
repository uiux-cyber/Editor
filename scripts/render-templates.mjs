#!/usr/bin/env node
/**
 * Renders template contact sheets (PNG) with the real compositor so designs can be reviewed.
 *
 *   node scripts/render-templates.mjs                          # every template, 16:9
 *   node scripts/render-templates.mjs --ids=a,b --aspects=16:9,9:16 --variants=2
 *   node scripts/render-templates.mjs --category=intro --out=some/dir
 *
 * Each row shows one template at 12%, 35%, its poster time and 92% of its duration.
 * Output defaults to .sheets/ in the project root.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = '') => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split('=').slice(1).join('=');
const outDir = path.resolve(arg('out', path.join(root, '.sheets')));
const query = new URLSearchParams({ ids: arg('ids'), aspects: arg('aspects', '16:9'), variants: arg('variants', '1'), category: arg('category') }).toString();
const buildDir = path.join(os.tmpdir(), `kinora-sheets-${process.pid}`);

try {
  await build({
    configFile: false,
    root: path.join(root, 'scripts/sheets'),
    base: './',
    logLevel: 'error',
    resolve: { alias: { '@': path.join(root, 'src/renderer/src'), '@shared': path.join(root, 'src/shared') } },
    build: { outDir: buildDir, emptyOutDir: true, minify: false, target: 'chrome140', reportCompressedSize: false },
  });
} catch (err) {
  console.error('\n✖ The library failed to compile:\n');
  console.error(err?.message ?? err);
  process.exit(1);
}

const child = spawn(electronPath, [path.join(root, 'scripts/sheets/main.cjs'), path.join(buildDir, 'index.html'), outDir, query], { stdio: ['ignore', 'pipe', 'pipe'] });
let buffer = '';
let summary = null;
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (line.startsWith('__SAVED__')) console.log('  wrote ' + line.slice(9));
    else if (line.startsWith('__DONE__')) summary = JSON.parse(line.slice(8));
    else if (line.startsWith('__FATAL__')) console.error('✖ ' + line.slice(9));
    else if (line.startsWith('__LOG__')) console.log('  [page] ' + line.slice(7));
  }
});
child.stderr.on('data', () => {});
child.on('exit', async (code) => {
  await rm(buildDir, { recursive: true, force: true }).catch(() => {});
  if (!summary) {
    console.error('✖ Renderer did not complete.');
    process.exit(code || 2);
  }
  if (summary.error) {
    console.error('✖ ' + summary.error);
    process.exit(1);
  }
  for (const p of summary.problems ?? []) console.log('  ⚠ ' + p);
  console.log(`\n${summary.templates} template(s), ${summary.sheets} sheet(s) → ${outDir}`);
  process.exit(0);
});
