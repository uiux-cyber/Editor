/**
 * Motion clips: the sandboxed runtime loads each built-in example and every bundled library,
 * renders frames in any order with identical results, reports errors with line numbers, keeps
 * clips away from the network and Kinora, and stops a clip that loops forever without hanging
 * the editor.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LIBS_CLIP = `import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import * as PIXI from 'pixi.js';
import { animate } from 'animejs';
import * as d3 from 'd3';
import Matter from 'matter-js';
import p5 from 'p5';
import lottie from 'lottie-web';
import { createNoise2D } from 'simplex-noise';
import rough from 'roughjs';

export default async function setup(k) {
  const found = [typeof THREE.WebGLRenderer, typeof EffectComposer, typeof RoundedBoxGeometry, typeof gsap.to, typeof SplitText, MorphSVGPlugin ? 'function' : 'missing', typeof PIXI.Application, typeof animate, typeof d3.scaleLinear, typeof Matter.Engine.create, typeof p5, typeof lottie.loadAnimation, typeof createNoise2D, typeof rough.canvas];
  if (found.some((f) => f !== 'function')) throw new Error('missing: ' + found.join(','));
  const noise = createNoise2D(k.random);
  const ctx = k.ctx2d();
  const rc = rough.canvas(k.canvas);
  const engine = Matter.Engine.create();
  const ball = Matter.Bodies.circle(100, 0, 30);
  Matter.Composite.add(engine.world, [ball, Matter.Bodies.rectangle(480, 520, 960, 40, { isStatic: true })]);
  const sim = k.bake(() => {
    Matter.Engine.update(engine, 1000 / 30);
    return { x: ball.position.x, y: ball.position.y };
  });
  const box = { x: 0 };
  gsap.to(box, { x: 800, duration: 2, ease: 'none' });
  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    rc.rectangle(box.x, 100 + noise(t, 0) * 20, 100, 80, { fill: '#5ce3df', seed: 3 });
    const s = sim.at(t);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 30, 0, Math.PI * 2);
    ctx.fill();
  };
}
`;

const SANDBOX_CLIP = `export default async function setup(k) {
  const reached = [];
  try { await fetch('https://example.com'); reached.push('network'); } catch {}
  try { await fetch('kinora://media/file?path=C%3A%5CWindows%5Cwin.ini'); reached.push('media'); } catch {}
  try { if (parent.kinora) reached.push('bridge'); } catch {}
  try { localStorage.length; reached.push('storage'); } catch {}
  if (reached.length) throw new Error('reached: ' + reached.join(','));
  return () => {};
}
`;

export default async function motion({ win, run, root, sleep, shot }) {
  const expect = (ok, msg) => {
    if (!ok) throw new Error(`expectation failed: ${msg}`);
    console.log(`  ✓ ${msg}`);
  };
  const { MOTION_EXAMPLES } = await import(pathToFileURL(path.join(root, 'src/shared/motion.ts')).href);
  await win.waitForSelector('.home', { timeout: 20000 });
  const meta = (duration, params, size = [960, 540]) => ({ name: 'test', width: size[0], height: size[1], duration, fps: 30, seed: 7, ...(params ? { params } : {}) });
  const test = (code, duration, times, params, values, size) =>
    run(
      async ({ code, meta, times, values }) => {
        const r = await window.__kinora.motion.testMotion(code, meta, times, values);
        // Summarise each picture: size, share of visible pixels, and a checksum.
        const frames = r.frames.map((b) => {
          const c = new OffscreenCanvas(b.width, b.height);
          const g = c.getContext('2d');
          g.drawImage(b, 0, 0);
          const px = g.getImageData(0, 0, b.width, b.height).data;
          let visible = 0;
          let sum = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] > 8) visible++;
          for (let i = 0; i < px.length; i += 97) sum = (sum * 31 + px[i]) >>> 0;
          return { w: b.width, h: b.height, visible: visible / (b.width * b.height), sum };
        });
        return { ok: r.ok, error: r.error, logs: r.logs, ms: r.ms, frames };
      },
      { code, meta: meta(duration, params, size), times, values },
    );

  for (const ex of MOTION_EXAMPLES) {
    const r = await test(ex.code, ex.duration, [ex.duration * 0.5, 0.1, ex.duration * 0.5], ex.params);
    if (!r.ok) console.log('   ', r.error, r.logs);
    expect(r.ok && r.frames.length === 3 && r.frames[0].w === 960, `example "${ex.name}" loads and renders (${r.ms.join(' / ')} ms per frame)`);
    expect(r.frames[0].visible > 0.003, `example "${ex.name}" draws something (${(r.frames[0].visible * 100).toFixed(1)}% of pixels)`);
    expect(r.frames[0].sum === r.frames[2].sum, `example "${ex.name}" renders the same frame identically after jumping away and back`);
  }

  // Every ready-made clip of the Motion library renders, landscape and portrait, frame-exactly.
  const presets = await run(() => window.__kinora.motion.presets.map((p) => ({ id: p.id, name: p.name, duration: p.duration, params: p.params, code: p.code })));
  expect(presets.length >= 12, `the Motion library has ${presets.length} ready-made clips`);
  for (const p of presets) {
    const at = p.duration * 0.55;
    const r = await test(p.code, p.duration, [at, 0.2, at], p.params);
    if (!r.ok) console.log('   ', r.error, r.logs);
    expect(r.ok && r.frames[0].visible > 0.002 && r.frames[0].sum === r.frames[2].sum, `"${p.name}" renders, draws (${((r.frames[0]?.visible ?? 0) * 100).toFixed(1)}%) and is frame-exact (${r.ms?.join(' / ')} ms)`);
    const tall = await test(p.code, p.duration, [at], p.params, undefined, [540, 960]);
    if (!tall.ok) console.log('   ', tall.error, tall.logs);
    expect(tall.ok && tall.frames[0].visible > 0.002, `"${p.name}" also works in a portrait frame`);
  }
  // Settings change what is drawn.
  const kinetic = presets.find((p) => p.id === 'kinetic-title');
  const plain = await test(kinetic.code, kinetic.duration, [2], kinetic.params);
  const changed = await test(kinetic.code, kinetic.duration, [2], kinetic.params, { title: 'SETTINGS WORK', color: '#ff2020' });
  expect(plain.frames[0].sum !== changed.frames[0].sum, 'a clip draws differently with other setting values');

  const libs = await test(LIBS_CLIP, 2, [1, 0.5, 1]);
  if (!libs.ok) console.log('   ', libs.error, libs.logs);
  expect(libs.ok, 'all 10 libraries import and run (three + addons, GSAP + plugins, Pixi, anime, D3, Matter, p5, Lottie, noise, Rough)');
  expect(libs.frames[0].sum === libs.frames[2].sum, 'GSAP tweens, baked physics and noise are frame-accurate when scrubbing back');

  const bad = await test('export default function setup(k) {\n  const ctx = k.ctx2d();\n  return (t) => {\n    ctx.fillRect(0, 0, nope.width, 10);\n  };\n}\n', 1, [0.5]);
  expect(!bad.ok && /nope is not defined/.test(bad.error) && /line 4/.test(bad.error), `render errors name the problem and the line ("${bad.error}")`);
  const syntax = await test('export default function setup(k) { return (t) => { ctx.fill( }; }', 1, [0]);
  expect(!syntax.ok && /SyntaxError|Unexpected/.test(syntax.error), `syntax errors are reported ("${syntax.error}")`);
  const shape = await test('export default function setup(k) { return 42; }', 1, [0]);
  expect(!shape.ok && /render function/.test(shape.error), 'a setup that returns no render function is explained');

  const sandbox = await test(SANDBOX_CLIP, 1, [0]);
  expect(sandbox.ok, `the sandbox has no network, no Kinora media, no bridge and no storage${sandbox.ok ? '' : ` (${sandbox.error})`}`);

  // A clip that breaks partway stops the export with its name and reason (never a silent gap).
  const exportError = await run(
    async ({ text, out }) => {
      const k = window.__kinora;
      await k.projectIO.newProject({ name: 'Broken motion', width: 640, height: 360, fps: 30 });
      const file = await window.kinora.call('x:motion:save', 'Breaks later', text);
      const res = await k.assets.importMediaFiles([file]);
      k.actions.addAsset(res.assets[0], { time: 0 });
      const project = k.useProjectStore.getState().project;
      const settings = { container: 'png', videoCodec: 'avc', width: 640, height: 360, fps: 30, quality: 'medium', audio: false, start: 1.5, end: 1.5, hardware: 'no-preference', fastStart: false };
      try {
        await k.exporter.exportProject(project, settings, out, () => {}, new AbortController().signal);
        return 'exported';
      } catch (err) {
        return String(err?.message ?? err);
      } finally {
        k.useProjectStore.getState().markSaved(null);
      }
    },
    {
      text: '/* kinora-motion\n{"name":"Breaks later","width":640,"height":360,"duration":2,"fps":30,"seed":1}\n*/\nexport default function setup(k) {\n  const ctx = k.ctx2d();\n  return (t) => {\n    if (t > 1) throw new Error("ran out of road");\n    ctx.fillRect(0, 0, 10, 10);\n  };\n}\n',
      out: path.join(root, '.e2e', 'motion-broken.png'),
    },
  );
  expect(/Motion clip “Breaks later”/.test(exportError) && /ran out of road/.test(exportError), `an export with a failing Motion clip stops with the reason ("${exportError}")`);

  // Library ▸ Motion: add a ready-made clip, change its settings in the inspector, export them.
  await run(async () => {
    const k = window.__kinora;
    await k.projectIO.newProject({ name: 'Motion library', width: 640, height: 360, fps: 30 });
  });
  await win.click('[data-tab="motion"]');
  await win.waitForSelector('[data-motion-preset="count-up"]', { timeout: 10000 });
  const tiles = await win.locator('[data-motion-preset]').count();
  expect(tiles >= presets.length, `the Motion tab shows every ready-made clip on its first page (${tiles} tiles)`);
  // Posters render for the tiles on screen (the rest render as they scroll into view).
  const onScreen = () =>
    run(() => {
      // Visible inside the library panel (which scrolls and ends above the timeline).
      const box = document.querySelector('.lib__scroll').getBoundingClientRect();
      const list = [...document.querySelectorAll('.motion-tile')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > box.top && r.top < box.bottom && r.width > 0;
      });
      return {
        total: list.length,
        loading: list.filter((el) => el.querySelector('.motion-tile__loading')).length,
        failed: list.filter((el) => el.querySelector('.motion-tile__error')).map((el) => el.dataset.motionPreset),
      };
    });
  const t0 = Date.now();
  let seen = await onScreen();
  while (seen.loading > 0 && Date.now() - t0 < 60000) {
    await sleep(300);
    seen = await onScreen();
  }
  expect(seen.total > 0 && seen.loading === 0 && seen.failed.length === 0, `every tile on screen shows a preview (${JSON.stringify(seen)})`);
  await shot('motion-01-library');
  // Endless: scrolling to the end adds restyled versions; search narrows the designs.
  await run(() => {
    const el = document.querySelector('.lib__scroll');
    el.scrollTop = el.scrollHeight;
  });
  await sleep(1200);
  const more = await run(() => ({ tiles: document.querySelectorAll('[data-motion-preset]').length, restyled: [...document.querySelectorAll('[data-motion-version]')].filter((el) => !/:own:/.test(el.dataset.motionVersion)).length }));
  expect(more.tiles > tiles && more.restyled > 0, `scrolling adds restyled versions (${more.tiles} tiles, ${more.restyled} restyled)`);
  await win.fill('.lib__search input', 'kinetic');
  await sleep(500);
  const found = await run(() => [...new Set([...document.querySelectorAll('[data-motion-preset]')].map((el) => el.dataset.motionPreset))]);
  expect(found.includes('reel-kinetic') && found.includes('kinetic-title') && !found.includes('count-up'), `search finds the kinetic designs (${found.join(', ')})`);
  await win.fill('.lib__search input', '');
  await sleep(500);
  await run(() => {
    document.querySelector('.lib__scroll').scrollTop = 0;
  });
  await sleep(300);
  await win.click('[data-motion-preset="count-up"]');
  await win.waitForSelector('[data-section="motion"] [data-motion-param="label"]', { timeout: 15000 });
  const added = await run(() => {
    const p = window.__kinora.useProjectStore.getState().project;
    const clip = Object.values(p.clips).find((c) => c.type === 'image' && p.assets[c.assetId]?.format === 'motion');
    return clip ? { clip: clip.id, asset: clip.assetId, duration: clip.duration, label: window.__kinora.useProjectStore.getState().pastMeta.slice(-1)[0]?.label } : null;
  });
  expect(added && Math.abs(added.duration - 4) < 1e-6, `clicking a tile adds the clip, one loop long (${added?.label})`);
  await win.fill('[data-motion-param="label"]', 'tests passed');
  await win.fill('[data-motion-param="suffix"]', '%');
  const values = await run((id) => window.__kinora.useProjectStore.getState().project.assets[id].motionValues, added.asset);
  expect(values?.label === 'tests passed' && values?.suffix === '%', `typing in the inspector changes the clip's settings (${JSON.stringify(values)})`);
  await sleep(1500);
  await shot('motion-02-inspector');
  await run(() => window.__kinora.actions.undo?.() ?? window.__kinora.useProjectStore.getState().undo());
  const afterUndo = await run((id) => window.__kinora.useProjectStore.getState().project.assets[id].motionValues, added.asset);
  expect(afterUndo?.suffix === undefined, 'undo reverts a settings change');

  // No flicker: while the clip plays in a hovered media bin tile, the paused preview is not
  // redrawn (the tile renders in the background) and keeps its frames.
  await run(() => window.__kinora.engine.seek(1));
  await win.click('[data-tab="media"]');
  await win.locator('.media-tile').first().hover();
  await sleep(1200);
  const still = await run(async () => {
    const k = window.__kinora;
    const before = k.engine.framesRendered;
    await new Promise((r) => setTimeout(r, 2000));
    const d = k.motion.motionDebug().find((m) => m.channels?.thumb);
    return { redraws: k.engine.framesRendered - before, hoverPlays: !!d, previewAt: d?.channels.preview?.latest };
  });
  expect(still.hoverPlays && still.redraws <= 2 && still.previewAt === 30, `a hovered Motion tile does not repaint the preview (${JSON.stringify(still)})`);
  await win.mouse.move(5, 5);

  // The export uses the chosen values: a red accent, then a green one.
  const colourShare = async (colour, test) => {
    await run(({ id, colour }) => {
      const m = window.__kinora.motion;
      const a = window.__kinora.useProjectStore.getState().project.assets[id];
      return m.readMotionFile(a.source.path).then((f) => m.setMotionValues(id, f.meta.params, { color: colour, accent: colour }));
    }, { id: added.asset, colour });
    const out = path.join(root, '.e2e', `motion-values-${colour.slice(1)}.png`);
    const err = await run(
      async ({ out }) => {
        const k = window.__kinora;
        const project = k.useProjectStore.getState().project;
        const settings = { container: 'png', videoCodec: 'avc', width: 640, height: 360, fps: 30, quality: 'medium', audio: false, start: 3, end: 3, hardware: 'no-preference', fastStart: false };
        try {
          await k.exporter.exportProject(project, settings, out, () => {}, new AbortController().signal);
          return null;
        } catch (e) {
          return String(e?.message ?? e);
        }
      },
      { out },
    );
    if (err) return { err };
    return run(
      async ({ out, test }) => {
        const res = await fetch(window.kinora.media.toUrl(out));
        const bmp = await createImageBitmap(await res.blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
          const [r, gr, b] = [px[i], px[i + 1], px[i + 2]];
          if (test === 'red' ? r > 180 && gr < 80 && b < 80 : gr > 180 && r < 80 && b < 80) n++;
        }
        return { share: n / (bmp.width * bmp.height) };
      },
      { out, test },
    );
  };
  const dump = async () => {
    console.log('  motion state:', JSON.stringify(await run(() => ({ now: Math.round(performance.now()), live: window.__kinora.motion.motionDebug().map((d) => ({ ...d, cached: d.cached.length })), closed: window.__kinora.motion.motionDebug().closed })), null, 0));
    const fresh = await test('export default function setup(k) { const c = k.ctx2d(); return () => c.fillRect(0, 0, 50, 50); }', 1, [0.5]);
    console.log('  a brand-new clip afterwards:', JSON.stringify({ ok: fresh.ok, error: fresh.error, ms: fresh.ms }));
  };
  const red = await colourShare('#ff0000', 'red');
  if (!(red.share > 0.005)) await dump();
  expect(red.share > 0.005, `the export draws the clip with its chosen colour (${red.err ?? `${(red.share * 100).toFixed(1)}% red`})`);
  const green = await colourShare('#00ff00', 'green');
  if (!(green.share > 0.005)) await dump();
  expect(green.share > 0.005, `changing the colour changes the export (${green.err ?? `${(green.share * 100).toFixed(1)}% green`})`);

  // Two clips sharing the clip: "Make unique" gives the selected one its own copy.
  await run((id) => {
    const k = window.__kinora;
    const asset = k.useProjectStore.getState().project.assets[id];
    k.actions.addAsset(asset, { time: 5 });
  }, added.asset);
  await win.waitForSelector('[data-motion-unique]', { timeout: 10000 });
  await win.click('[data-motion-unique]');
  const unique = await run((id) => {
    const p = window.__kinora.useProjectStore.getState().project;
    const ids = Object.values(p.clips).filter((c) => c.type === 'image' && p.assets[c.assetId]?.format === 'motion').map((c) => c.assetId);
    return { distinct: new Set(ids).size, copy: ids.find((x) => x !== id) && p.assets[ids.find((x) => x !== id)].motionValues };
  }, added.asset);
  expect(unique.distinct === 2 && unique.copy?.accent === '#00ff00', 'Make unique gives one clip its own copy, keeping its settings');
  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));

  // A clip that never returns is stopped, and the editor stays responsive meanwhile.
  const hang = run(({ meta }) => window.__kinora.motion.testMotion('export default function setup(k) { return () => { for (;;) {} }; }', meta, [0]).then((r) => r.error), { meta: meta(1) });
  await sleep(1500);
  const started = Date.now();
  await run(() => document.title);
  const lag = Date.now() - started;
  expect(lag < 1000, `the editor stays responsive while a clip loops forever (${lag} ms)`);
  const hangError = await hang;
  expect(/took longer/.test(hangError ?? ''), `the endless clip is stopped with a clear message ("${hangError}")`);
}
