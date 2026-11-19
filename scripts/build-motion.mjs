#!/usr/bin/env node
/**
 * Builds the Motion clip runtime into out/motion/ (served as kinora://motion/ by the main process):
 *
 *   frame.html                 sandboxed page: import map + fonts + runtime
 *   runtime.js                 src/motion/runtime.ts
 *   lib/<name>.js              one self-contained ES module per animation library
 *   fonts/fonts.css, files/    Kinora's typefaces (Latin subsets)
 *   THIRD-PARTY-LICENSES.txt   the libraries' licences and notices
 *
 *   node scripts/build-motion.mjs        (part of `npm run build`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out', 'motion');
const libDir = path.join(out, 'lib');
const src = (p) => path.join(root, 'src', 'motion', p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(libDir, { recursive: true });

const config = (entries, external, outDir) => ({
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome140',
    minify: true,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4000,
    lib: { entry: entries, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    rollupOptions: {
      external,
      // Lottie's expression engine uses eval by design.
      checks: { eval: false },
      output: { chunkFileNames: 'chunks/[name]-[hash].js', minify: true },
    },
  },
});

// three.js core on its own, so the addons (and clips) share one instance through the import map.
await build(config({ three: src('lib/three.ts') }, [], libDir));
await build(
  config(
    {
      'three-addons': src('lib/three-addons.ts'),
      gsap: src('lib/gsap.ts'),
      anime: src('lib/anime.ts'),
      pixi: src('lib/pixi.ts'),
      d3: src('lib/d3.ts'),
      matter: src('lib/matter.ts'),
      p5: src('lib/p5.ts'),
      lottie: src('lib/lottie.ts'),
      noise: src('lib/noise.ts'),
      rough: src('lib/rough.ts'),
    },
    [/^three$/],
    libDir,
  ),
);
await build(config({ runtime: src('runtime.ts') }, [], out));

// GSAP's terms forbid removing its notices, and the minifier drops comments: put its notice back.
const gsapNotice = /\/\*![\s\S]*?standard-license[\s\S]*?\*\//.exec(fs.readFileSync(path.join(root, 'node_modules/gsap/gsap-core.js'), 'utf8'))?.[0];
if (!gsapNotice) throw new Error('GSAP licence notice not found');
const gsapOut = path.join(libDir, 'gsap.js');
fs.writeFileSync(gsapOut, `${gsapNotice}
${fs.readFileSync(gsapOut, 'utf8')}`);

// p5.js reads its error messages from ./en-US.json next to the page (else it tries a CDN).
// The runtime reports the language as en-US, so this one file is all p5 needs.
fs.copyFileSync(path.join(root, 'node_modules/p5/translations/en/extracted.json'), path.join(out, 'en-US.json'));

// ---- Import map: clips import libraries by their usual names --------------------------------
const imports = {
  three: './lib/three.js',
  gsap: './lib/gsap.js',
  'gsap/all': './lib/gsap.js',
  'pixi.js': './lib/pixi.js',
  animejs: './lib/anime.js',
  d3: './lib/d3.js',
  'matter-js': './lib/matter.js',
  p5: './lib/p5.js',
  'lottie-web': './lib/lottie.js',
  'simplex-noise': './lib/noise.js',
  roughjs: './lib/rough.js',
};
const gsapPlugins = fs.readFileSync(src('lib/gsap.ts'), 'utf8').matchAll(/from 'gsap\/(\w+)'/g);
for (const [, p] of gsapPlugins) imports[`gsap/${p}`] = imports[`gsap/${p}.js`] = './lib/gsap.js';
const addons = fs.readFileSync(src('lib/three-addons.ts'), 'utf8').matchAll(/from 'three\/addons\/([\w/.-]+)'/g);
for (const [, p] of addons) imports[`three/addons/${p}`] = imports[`three/examples/jsm/${p}`] = './lib/three-addons.js';

fs.writeFileSync(
  path.join(out, 'frame.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Kinora Motion</title>
<script type="importmap">${JSON.stringify({ imports })}</script>
<link rel="stylesheet" href="./fonts/fonts.css">
<style>html,body{margin:0;background:transparent;overflow:hidden}</style>
<script type="module" src="./runtime.js"></script>
</head>
<body></body>
</html>
`,
);

// ---- Fonts: the typefaces Kinora bundles (src/renderer/src/styles/fonts.ts), Latin subsets ----
const fontsOut = path.join(out, 'fonts');
fs.mkdirSync(path.join(fontsOut, 'files'), { recursive: true });
const fontImports = [...fs.readFileSync(path.join(root, 'src/renderer/src/styles/fonts.ts'), 'utf8').matchAll(/^import '(@fontsource[^']+)';/gm)].map((m) => m[1]);
let css = '';
const copied = new Set();
for (const spec of fontImports) {
  const cssPath = path.join(root, 'node_modules', spec.endsWith('.css') ? spec : `${spec}/index.css`);
  const dir = path.dirname(cssPath);
  const text = fs.readFileSync(cssPath, 'utf8');
  for (const block of text.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const url = /url\(\.\/files\/([^)]+)\)/.exec(block)?.[1];
    if (!url || !/-latin-/.test(url)) continue;
    if (!copied.has(url)) {
      fs.copyFileSync(path.join(dir, 'files', url), path.join(fontsOut, 'files', url));
      copied.add(url);
    }
    css += `${block.replace(/url\(\.\/files\//, 'url(./files/').replace(/font-display:\s*swap;/, 'font-display: block;')}\n`;
  }
}
fs.writeFileSync(path.join(fontsOut, 'fonts.css'), css);

// ---- Licences -------------------------------------------------------------------------------
const licence = (pkg, file) => {
  const p = path.join(root, 'node_modules', pkg, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
};
const packages = [
  ['three', 'LICENSE'],
  ['pixi.js', 'LICENSE'],
  ['animejs', 'LICENSE.md'],
  ['d3', 'LICENSE'],
  ['matter-js', 'LICENSE'],
  ['p5', 'license.txt'],
  ['lottie-web', 'LICENSE.md'],
  ['simplex-noise', 'LICENSE'],
  ['roughjs', 'LICENSE'],
];
const version = (pkg) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
let notices = `Third-party libraries bundled with Kinora's Motion clips (out/motion/lib).\n\n`;
notices += `==== gsap ${version('gsap')} ====\nGSAP ${version('gsap')}, Copyright 2008-2026, GreenSock. All rights reserved.\nSubject to the terms at https://gsap.com/standard-license (GSAP Standard "no charge" License).\n\n`;
for (const [pkg, file] of packages) notices += `==== ${pkg} ${version(pkg)} ====\n${licence(pkg, file)}\n\n`;
notices += `==== Fonts ====\nThe typefaces in fonts/ are distributed under the SIL Open Font License 1.1 or the Apache License 2.0 (via @fontsource).\n`;
fs.writeFileSync(path.join(out, 'THIRD-PARTY-LICENSES.txt'), notices);

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`motion runtime: ${Object.keys(imports).length} import names, ${copied.size} font files, ${(size(out) / 1048576).toFixed(1)} MB → out/motion`);
