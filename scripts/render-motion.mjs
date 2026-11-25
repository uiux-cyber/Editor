#!/usr/bin/env node
/**
 * Contact sheets of ready-made Motion clips (src/renderer/src/library/motion/), rendered by the real
 * Motion runtime (out/motion, built by `npm run build` or `node scripts/build-motion.mjs`). Does
 * not need the app build, and each run uses its own temp folders, so several can run at once.
 *
 *   node scripts/render-motion.mjs                               # every design, 16:9 + 9:16
 *   node scripts/render-motion.mjs --files=titles,callouts-a     # designs from these files only
 *   node scripts/render-motion.mjs --ids=confetti,count-up --aspects=16:9,9:16,1:1 --variants=3
 *   node scripts/render-motion.mjs --category=social --out=some/dir
 *   node scripts/render-motion.mjs --ids=reel-kinetic --times=0.05,0.2,0.3,0.45,0.6,0.95   # frames at these fractions
 *
 * Each row is one version of a design (version 0 = as designed, then palette / font / look /
 * words / seed variations) at 15%, 40%, the poster time and 90% of its loop, over the backdrop the
 * library shows. Problems (errors, blank or off-frame pictures, slow frames, frames that differ
 * when rendered twice) are listed at the end; the exit code is 1 when there are any.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = '') => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split('=').slice(1).join('=');
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

const motionDir = path.join(root, 'src/renderer/src/library/motion');
const runtimeDir = path.join(root, 'out/motion');
if (!fs.existsSync(path.join(runtimeDir, 'frame.html'))) {
  console.error('✖ out/motion is missing: run `node scripts/build-motion.mjs` (or `npm run build`) first.');
  process.exit(1);
}

const wanted = list(arg('files')).map((f) => f.replace(/\.ts$/, ''));
const files = fs
  .readdirSync(motionDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''))
  .filter((f) => !wanted.length || wanted.includes(f))
  .sort();
const missing = wanted.filter((f) => !files.includes(f));
if (missing.length) {
  console.error(`✖ No such file in library/motion: ${missing.join(', ')}`);
  process.exit(1);
}

const outDir = path.resolve(arg('out', path.join(root, '.motion-sheets')));
const query = new URLSearchParams({
  ids: arg('ids'),
  category: arg('category'),
  aspects: arg('aspects', '16:9,9:16'),
  variants: arg('variants', '2'),
  times: arg('times'),
}).toString();
const buildDir = path.join(os.tmpdir(), `kinora-motion-sheets-${process.pid}`);
const timeoutS = Number(arg('timeout', '900')) || 900;

const dirFiles = (dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => path.join(root, dir, f).replace(/\\/g, '/'));

/** `virtual:motion-presets`: the chosen preset files, palettes and font pairs. */
function presetsPlugin() {
  const id = 'virtual:motion-presets';
  return {
    name: 'kinora-motion-presets',
    resolveId: (s) => (s === id ? '\0' + id : null),
    load(s) {
      if (s !== '\0' + id) return null;
      const presetFiles = files.map((f) => path.join(motionDir, f + '.ts').replace(/\\/g, '/'));
      const palettes = dirFiles('src/renderer/src/library/palettes');
      const fonts = dirFiles('src/renderer/src/library/fontPairs');
      const imp = (prefix, arr) => arr.map((f, i) => `import ${prefix}${i} from ${JSON.stringify(f)};`).join('\n');
      const spread = (prefix, arr) => `[${arr.map((_, i) => `...${prefix}${i}.map((x) => ({ ...x }))`).join(', ')}]`;
      return [
        imp('p', presetFiles),
        imp('c', palettes),
        imp('f', fonts),
        `export const presets = ${spread('p', presetFiles)};`,
        `export const sources = ${JSON.stringify(files)};`,
        `export const counts = [${presetFiles.map((_, i) => `p${i}.length`).join(', ')}];`,
        `export const palettes = ${spread('c', palettes)};`,
        `export const fontPairs = ${spread('f', fonts)};`,
      ].join('\n');
    },
  };
}

try {
  await build({
    configFile: false,
    root: path.join(root, 'scripts/motion-sheets'),
    base: './',
    logLevel: 'error',
    plugins: [presetsPlugin()],
    resolve: { alias: { '@': path.join(root, 'src/renderer/src'), '@shared': path.join(root, 'src/shared') } },
    build: { outDir: buildDir, emptyOutDir: true, minify: false, target: 'chrome140', reportCompressedSize: false },
  });
} catch (err) {
  console.error('\n✖ The Motion library failed to compile:\n');
  console.error(err?.message ?? err);
  process.exit(1);
}

const child = spawn(electronPath, [path.join(root, 'scripts/motion-sheets/main.cjs'), path.join(buildDir, 'index.html'), outDir, query, runtimeDir, String(timeoutS)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
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
    else if (line.startsWith('__LOG__')) console.log('  ' + line.slice(7));
  }
});
child.stderr.on('data', () => {});
child.on('exit', async (code) => {
  fs.rmSync(buildDir, { recursive: true, force: true });
  if (!summary) {
    console.error('✖ The renderer did not complete.');
    process.exit(code || 2);
  }
  if (summary.error) {
    console.error('✖ ' + summary.error);
    process.exit(1);
  }
  for (const p of summary.problems ?? []) console.log('  ⚠ ' + p);
  console.log(`\n${summary.presets} design(s), ${summary.rows} row(s), ${summary.sheets} sheet(s) → ${outDir}`);
  if (summary.problems?.length) console.log(`${summary.problems.length} problem(s).`);
  else console.log('No problems found.');
  process.exit(summary.problems?.length ? 1 : 0);
});
