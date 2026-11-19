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

export default async function motion({ win, run, root, sleep }) {
  const expect = (ok, msg) => {
    if (!ok) throw new Error(`expectation failed: ${msg}`);
    console.log(`  ✓ ${msg}`);
  };
  const { MOTION_EXAMPLES } = await import(pathToFileURL(path.join(root, 'src/shared/motion.ts')).href);
  await win.waitForSelector('.home', { timeout: 20000 });
  const meta = (duration) => ({ name: 'test', width: 960, height: 540, duration, fps: 30, seed: 7 });
  const test = (code, duration, times) =>
    run(
      async ({ code, meta, times }) => {
        const r = await window.__kinora.motion.testMotion(code, meta, times);
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
      { code, meta: meta(duration), times },
    );

  for (const ex of MOTION_EXAMPLES) {
    const r = await test(ex.code, ex.duration, [ex.duration * 0.5, 0.1, ex.duration * 0.5]);
    if (!r.ok) console.log('   ', r.error, r.logs);
    expect(r.ok && r.frames.length === 3 && r.frames[0].w === 960, `example "${ex.name}" loads and renders (${r.ms.join(' / ')} ms per frame)`);
    expect(r.frames[0].visible > 0.003, `example "${ex.name}" draws something (${(r.frames[0].visible * 100).toFixed(1)}% of pixels)`);
    expect(r.frames[0].sum === r.frames[2].sum, `example "${ex.name}" renders the same frame identically after jumping away and back`);
  }

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
