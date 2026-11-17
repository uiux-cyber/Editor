/**
 * Text & graphics test: drives animated GIF / Lottie import, the pen tool (draw + edit points)
 * and count-up text through the real UI, plays the result, exports it and verifies sampled
 * frames of the exported MP4:
 *   - the GIF animates (its background colour follows the GIF frame timing),
 *   - the Lottie renders and its box moves at the right speed,
 *   - the pen path renders filled,
 *   - the counter shows the right value at given times (compared with reference renders).
 *
 *   npm run build && node scripts/e2e.mjs graphics
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import gifenc from 'gifenc';

const { GIFEncoder } = gifenc;

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** Background colour of each GIF frame (distinct hues so frames are easy to tell apart). */
const GIF_COLORS = [
  [230, 40, 40],
  [40, 200, 60],
  [40, 80, 230],
  [240, 220, 40],
  [220, 40, 220],
  [30, 220, 230],
];
const GIF_DELAY = 150; // ms per frame → 0.9 s loop
const GIF_W = 240;
const GIF_H = 160;

function makeAnimatedGif(file) {
  const gif = GIFEncoder();
  GIF_COLORS.forEach((color, i) => {
    // Indexed pixels: 0 = background colour, 1 = white square that moves along the middle.
    const index = new Uint8Array(GIF_W * GIF_H);
    const sx = 20 + i * 32;
    for (let y = 60; y < 100; y++) for (let x = sx; x < sx + 40; x++) index[y * GIF_W + x] = 1;
    gif.writeFrame(index, GIF_W, GIF_H, { palette: [color, [255, 255, 255]], delay: GIF_DELAY });
  });
  gif.finish();
  writeFileSync(file, gif.bytes());
}

function makeStillGif(file) {
  const gif = GIFEncoder();
  gif.writeFrame(new Uint8Array(64 * 64), 64, 64, { palette: [[200, 120, 30], [0, 0, 0]] });
  gif.finish();
  writeFileSync(file, gif.bytes());
}

/** A 300×300, 30 fps, 2 s Lottie: an orange 80×80 box moving from x = 60 to x = 240 (linear). */
function lottieDoc() {
  const tr = { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } };
  return {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op: 60,
    w: 300,
    h: 300,
    nm: 'E2E box',
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: 'Box',
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: {
            a: 1,
            k: [
              { t: 0, s: [60, 150, 0], e: [240, 150, 0], i: { x: 1, y: 1 }, o: { x: 0, y: 0 } },
              { t: 60, s: [240, 150, 0] },
            ],
          },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        ao: 0,
        shapes: [
          {
            ty: 'gr',
            nm: 'Group',
            it: [
              { ty: 'rc', nm: 'Rect', d: 1, s: { a: 0, k: [80, 80] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } },
              { ty: 'fl', nm: 'Fill', c: { a: 0, k: [1, 0.5, 0, 1] }, o: { a: 0, k: 100 }, r: 1 },
              tr,
            ],
          },
        ],
        ip: 0,
        op: 60,
        st: 0,
        bm: 0,
      },
    ],
  };
}

/** Minimal ZIP writer (deflate) for the .lottie fixture. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const deflated = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Counter settings applied through the inspector, and the expected value at a time.
const COUNTER = { to: 5000, duration: 2 };
const counterAt = (t) => Math.round(COUNTER.to * Math.min(1, t / COUNTER.duration));
const fmt = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default async function graphics(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const mouse = win.mouse;
  const project = () => run(() => window.__kinora.useProjectStore.getState().project);
  const center = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error('element not visible');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
  };
  const tab = async (name) => {
    await win.click(`.rail__btn[data-tab="${name}"]`);
    await sleep(500);
  };

  const files = {
    gif: path.join(outDir, 'graphics-anim.gif'),
    still: path.join(outDir, 'graphics-still.gif'),
    lottie: path.join(outDir, 'graphics-lottie.json'),
    dotlottie: path.join(outDir, 'graphics-anim.lottie'),
    notLottie: path.join(outDir, 'graphics-settings.json'),
  };
  makeAnimatedGif(files.gif);
  makeStillGif(files.still);
  const doc = JSON.stringify(lottieDoc());
  writeFileSync(files.lottie, doc);
  writeFileSync(files.notLottie, JSON.stringify({ apiKey: 'secret', layers: 'not really' }));
  writeFileSync(
    files.dotlottie,
    zip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify({ version: '1', generator: 'kinora-e2e', animations: [{ id: 'box' }] })) },
      { name: 'animations/box.json', data: Buffer.from(doc) },
    ]),
  );

  await win.waitForSelector('.home', { timeout: 20000 });
  await run(() => window.__kinora.projectIO.newProject({ name: 'Graphics', width: 1280, height: 720, fps: 30 }));
  await win.waitForSelector('.timeline');
  await sleep(400);

  // ---- The protocol only serves JSON that is a Lottie ------------------------------------------
  // (Requested from the main process so the expected 403 does not show up as a renderer error.)
  const served = await ctx.app.evaluate(
    async ({ net }, { lottie, notLottie }) => {
      const url = (p) => `kinora://media/file?path=${encodeURIComponent(p)}`;
      return { lottie: (await net.fetch(url(lottie))).status, other: (await net.fetch(url(notLottie))).status };
    },
    { lottie: files.lottie, notLottie: files.notLottie },
  );
  expect(served.lottie === 200 && served.other === 403, `JSON is only served for Lottie files (lottie ${served.lottie}, other JSON ${served.other})`);

  // ---- Import ----------------------------------------------------------------------------------
  const imported = await run(async (list) => {
    const k = window.__kinora;
    const res = await k.assets.importMediaFiles(await window.kinora.fs.stat(list));
    return { assets: res.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, format: a.format, duration: a.duration, width: a.width, height: a.height, fps: a.fps })), failures: res.failures };
  }, Object.values(files));
  const byName = Object.fromEntries(imported.assets.map((a) => [a.name, a]));
  const gifAsset = byName['graphics-anim.gif'];
  const lottieAsset = byName['graphics-lottie.json'];
  const dotAsset = byName['graphics-anim.lottie'];
  expect(gifAsset?.kind === 'animation' && gifAsset.format === 'gif' && Math.abs(gifAsset.duration - 0.9) < 0.01 && gifAsset.width === GIF_W, `animated GIF → animation asset (${JSON.stringify(gifAsset)})`);
  expect(byName['graphics-still.gif']?.kind === 'image', 'a single-frame GIF stays a plain image');
  expect(lottieAsset?.kind === 'animation' && lottieAsset.format === 'lottie' && Math.abs(lottieAsset.duration - 2) < 1e-6 && lottieAsset.width === 300, `Lottie JSON → animation asset (${JSON.stringify(lottieAsset)})`);
  expect(dotAsset?.kind === 'animation' && dotAsset.format === 'lottie' && Math.abs(dotAsset.duration - 2) < 1e-6, 'dotLottie archive → animation asset');
  expect(imported.failures.length === 1 && /not a Lottie/i.test(imported.failures[0].reason), `a JSON that is not a Lottie is rejected (${JSON.stringify(imported.failures)})`);

  await tab('media');
  await sleep(500);
  const badges = await win.locator('.media-tile__badge').allTextContents();
  expect(badges.sort().join(',') === 'GIF,LOTTIE,LOTTIE', `media tiles show format badges (${badges.join(', ')})`);
  // Hovering an animated tile plays it.
  await win.locator('.media-tile', { hasText: 'graphics-anim.gif' }).hover();
  await sleep(500);
  expect(await win.locator('.media-tile', { hasText: 'graphics-anim.gif' }).locator('.media-tile__anim.is-on').count(), 'hovering an animated tile plays it');
  await shot('40-graphics-media');

  // ---- Add the GIF (click) and the Lottie (drag to a new track) --------------------------------
  await win.locator('.media-tile', { hasText: 'graphics-anim.gif' }).click();
  await sleep(400);
  let p = await project();
  const gifClip = Object.values(p.clips).find((c) => c.type === 'image' && c.assetId === gifAsset.id);
  expect(!!gifClip && Math.abs(gifClip.duration - 3) < 1e-6, `clicking the GIF adds an image clip one loop long, at least 3 s (${gifClip?.duration}s)`);

  const ruler = await center(win.locator('.tl-ruler'));
  const lottieTile = await center(win.locator('.media-tile', { hasText: 'graphics-lottie.json' }));
  await mouse.move(lottieTile.x, lottieTile.y);
  await mouse.down();
  await mouse.move(lottieTile.x + 6, lottieTile.y + 2, { steps: 2 });
  await mouse.move(ruler.box.x + 40, ruler.box.y + ruler.box.height + 10, { steps: 20 });
  await sleep(80);
  await mouse.up();
  await sleep(400);
  p = await project();
  const lottieClip = Object.values(p.clips).find((c) => c.type === 'image' && c.assetId === lottieAsset.id);
  expect(!!lottieClip && lottieClip.trackId !== gifClip.trackId && Math.abs(lottieClip.duration - 3) < 1e-6, 'dragging the Lottie to the timeline adds it on its own track');

  // Lay the layers out (design px of a 1920×1080 frame) and give every clip the same length.
  await run(
    ({ gifId, lottieId }) => {
      const k = window.__kinora;
      k.useProjectStore.getState().update((p) => {
        Object.assign(p.clips[gifId], { start: 0, duration: 5 });
        Object.assign(p.clips[gifId].transform, { x: -560, y: -250, scaleX: 0.3, scaleY: 0.3 });
        Object.assign(p.clips[lottieId], { start: 0, duration: 5 });
        Object.assign(p.clips[lottieId].transform, { x: 560, y: -200, scaleX: 0.4, scaleY: 0.4 });
      });
      k.useUI.getState().clearSelection();
      k.engine.seek(0.5);
    },
    { gifId: gifClip.id, lottieId: lottieClip.id },
  );
  await sleep(800);

  // ---- Pen tool: draw a closed path with one curved point --------------------------------------
  const stage = await center(win.locator('.stage__overlay'));
  const kpx = stage.box.width / 1920;
  const toScreen = (x, y) => ({ x: stage.x + x * kpx, y: stage.y + y * kpx });
  await win.locator('.stage__overlay').click({ position: { x: 4, y: stage.box.height - 4 } });
  await win.keyboard.press('p');
  await sleep(200);
  expect(await win.locator('[data-pen-layer]').isVisible(), 'P switches to the pen tool');
  const A = toScreen(-760, 160);
  const B = toScreen(-460, 420);
  const C = toScreen(-180, 170);
  await mouse.click(A.x, A.y);
  await sleep(100);
  // Press at B and drag to pull bezier handles.
  await mouse.move(B.x, B.y);
  await mouse.down();
  await mouse.move(B.x + 50 * kpx, B.y + 6 * kpx, { steps: 4 });
  await mouse.move(B.x + 110 * kpx, B.y + 10 * kpx, { steps: 4 });
  await mouse.up();
  await sleep(100);
  await mouse.click(C.x, C.y);
  await sleep(100);
  await mouse.move(A.x + 40, A.y + 30, { steps: 4 });
  await sleep(150);
  await shot('41-graphics-pen-drawing');
  await mouse.move(A.x + 1, A.y + 1, { steps: 3 });
  await sleep(100);
  await mouse.click(A.x + 1, A.y + 1);
  await sleep(500);
  p = await project();
  const pathClip = Object.values(p.clips).find((c) => c.type === 'shape' && c.shape.kind === 'path');
  expect(!!pathClip && pathClip.shape.path.closed && pathClip.shape.path.points.length === 3, `clicking the first point closes the path (${pathClip?.shape.path.points.length} points)`);
  const smoothIdx = pathClip.shape.path.points.findIndex((q) => q.outX !== undefined);
  expect(smoothIdx === 1, 'dragging while placing a point pulls bezier handles');
  expect(Math.abs(pathClip.transform.x - (-470)) < 25 && pathClip.shape.width > 520 && pathClip.shape.width < 640, `path box fitted to the points (x=${pathClip.transform.x.toFixed(1)}, w=${pathClip.shape.width.toFixed(1)})`);
  expect(await win.locator(`[data-path-edit="${pathClip.id}"] [data-anchor]`).count() === 3, 'the new path is selected with editable points');
  await shot('42-graphics-path-edit');

  // Drag point C to the right (one undo step).
  const before = pathClip;
  const undoDepth = await run(() => window.__kinora.useProjectStore.getState().past.length);
  const anchor2 = await center(win.locator('[data-anchor="2"]'));
  await mouse.move(anchor2.x, anchor2.y);
  await mouse.down();
  await mouse.move(anchor2.x + 30, anchor2.y - 10, { steps: 5 });
  await mouse.move(anchor2.x + 60 * kpx * 1.5, anchor2.y - 40 * kpx, { steps: 5 });
  await mouse.up();
  await sleep(300);
  p = await project();
  let edited = p.clips[pathClip.id];
  expect(edited.shape.width > before.shape.width + 40, `dragging a point reshapes the path (width ${before.shape.width.toFixed(0)} → ${edited.shape.width.toFixed(0)})`);
  const afterDrag = await run(() => window.__kinora.useProjectStore.getState().past.length);
  expect(afterDrag === undoDepth + 1, `a point drag is one undo step (${undoDepth} → ${afterDrag})`);

  // Alt-click toggles smooth / corner.
  const anchor0 = await center(win.locator('[data-anchor="0"]'));
  await win.keyboard.down('Alt');
  await mouse.click(anchor0.x, anchor0.y);
  await win.keyboard.up('Alt');
  await sleep(250);
  p = await project();
  edited = p.clips[pathClip.id];
  expect(edited.shape.path.points[0].outX !== undefined, 'Alt-click makes a corner point smooth');

  // Double-click the middle of segment C → A inserts a point.
  const cA = await run((id) => {
    const k = window.__kinora;
    const c = k.useProjectStore.getState().project.clips[id];
    const box = k.engine.layerBox(id);
    const pts = c.shape.path.points;
    const a = pts[2];
    const b = pts[0];
    // Points sit in a 0..1 box; the layer is unrotated and unscaled.
    const toDesign = (q) => ({ x: box.cx - box.w / 2 + q.x * box.w, y: box.cy - box.h / 2 + q.y * box.h });
    const pa = toDesign(a);
    const pb = toDesign(b);
    // Cubic midpoint with the handles of both ends.
    const c1 = { x: pa.x + (a.outX ?? 0) * box.w, y: pa.y + (a.outY ?? 0) * box.h };
    const c2 = { x: pb.x + (b.inX ?? 0) * box.w, y: pb.y + (b.inY ?? 0) * box.h };
    return { x: 0.125 * pa.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * pb.x, y: 0.125 * pa.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * pb.y };
  }, pathClip.id);
  const mid = toScreen(cA.x, cA.y);
  await mouse.dblclick(mid.x, mid.y);
  await sleep(300);
  p = await project();
  expect(p.clips[pathClip.id].shape.path.points.length === 4, 'double-clicking the outline inserts a point');
  // The inserted point is selected: Delete removes it, undo brings it back.
  await win.keyboard.press('Delete');
  await sleep(250);
  p = await project();
  expect(p.clips[pathClip.id]?.shape.path.points.length === 3, 'Delete removes the selected point (and not the clip)');
  await win.keyboard.press('Control+z');
  await sleep(250);
  p = await project();
  expect(p.clips[pathClip.id].shape.path.points.length === 4, 'Ctrl+Z restores the point');
  await run((id) => {
    const k = window.__kinora;
    k.useProjectStore.getState().update((p) => {
      const c = p.clips[id];
      c.start = 0;
      c.duration = 5;
      c.shape.fill = { type: 'solid', color: '#22d3ee' };
    });
  }, pathClip.id);

  // ---- Count-up: add a counter preset and edit it in the inspector ----------------------------
  await run(() => window.__kinora.engine.seek(0));
  await tab('text');
  await win.locator('.chip', { hasText: 'Counter' }).click();
  await sleep(600);
  await shot('43-graphics-counter-presets');
  await win.locator('.lib .tile', { hasText: 'Big Stat' }).click();
  await sleep(500);
  p = await project();
  const counterClip = Object.values(p.clips).find((c) => c.type === 'text' && c.counter);
  expect(!!counterClip && counterClip.counter.to === 12500, 'clicking the Big Stat preset adds a counting text clip');
  const section = win.locator('[data-section="counter"]');
  await section.scrollIntoViewIfNeeded();
  const field = (label) => section.locator('.field').filter({ has: win.locator('.field__label', { hasText: new RegExp(`^${label}$`) }) });
  const toInput = field('To').locator('input').first();
  await toInput.click();
  await toInput.fill(String(COUNTER.to));
  await toInput.press('Enter');
  await field('Easing').locator('select').selectOption('linear');
  const durInput = field('Duration').locator('input').first();
  await durInput.click();
  await durInput.fill(String(COUNTER.duration));
  await durInput.press('Enter');
  await sleep(300);
  p = await project();
  const counter = p.clips[counterClip.id].counter;
  expect(counter.to === COUNTER.to && counter.ease === 'linear' && counter.duration === COUNTER.duration && p.clips[counterClip.id].text.content === '5,000', `inspector edits the counter (${JSON.stringify(counter)})`);
  await shot('44-graphics-counter-inspector');
  await run((id) => {
    const k = window.__kinora;
    k.useProjectStore.getState().update((p) => {
      Object.assign(p.clips[id], { start: 0, duration: 5 });
      Object.assign(p.clips[id].transform, { x: 420, y: 330, scaleX: 0.7, scaleY: 0.7 });
    });
    k.useUI.getState().clearSelection();
  }, counterClip.id);

  // ---- Inspector sections for the path and the animated GIF -----------------------------------
  await run((id) => window.__kinora.useUI.getState().select([id]), pathClip.id);
  await sleep(300);
  const pathSection = win.locator('[data-section="path"]');
  await pathSection.scrollIntoViewIfNeeded();
  expect((await pathSection.textContent()).includes('Closed'), 'a path shape shows the Path section');
  await shot('48-graphics-path-section');
  await win.locator(`.clip[data-clip="${gifClip.id}"]`).click({ position: { x: 40, y: 30 } });
  await sleep(300);
  const animSection = win.locator('[data-section="animation"]');
  await animSection.scrollIntoViewIfNeeded();
  expect((await animSection.textContent()).includes('Animated GIF'), 'an animated GIF clip shows the Animation section');
  await animSection.locator('.chip', { hasText: '2×' }).click();
  await sleep(200);
  p = await project();
  expect(Math.abs(p.clips[gifClip.id].duration - 1.8) < 1e-6, `Length 2× sets the clip to two loops (${p.clips[gifClip.id].duration}s)`);
  await shot('49-graphics-animation-section');
  await run((id) => window.__kinora.useProjectStore.getState().update((p) => void (p.clips[id].duration = 5)), gifClip.id);

  // ---- Play ------------------------------------------------------------------------------------
  await win.locator('.stage__overlay').click({ position: { x: 4, y: 4 } });
  await win.keyboard.press('Home');
  await win.keyboard.press(' ');
  await sleep(1300);
  const playing = await run(() => ({ t: window.__kinora.engine.time, playing: window.__kinora.engine.playing }));
  expect(playing.playing && playing.t > 0.8, `Space plays (t=${playing.t.toFixed(2)}s)`);
  await shot('45-graphics-playing');
  await win.keyboard.press(' ');
  await run(() => window.__kinora.engine.seek(1.5));
  await sleep(700);
  await shot('46-graphics-paused');

  // ---- Export and verify -----------------------------------------------------------------------
  const mp4 = path.join(outDir, 'graphics.mp4');
  const res = await run(async (file) => {
    const k = window.__kinora;
    const project = k.useProjectStore.getState().project;
    const settings = { container: 'mp4', videoCodec: 'avc', width: 1280, height: 720, fps: 30, quality: 'high', audio: false, start: 0, end: 5, hardware: 'no-preference', fastStart: false };
    k.engine.setSuspended(true);
    try {
      const r = await k.exporter.exportProject(project, settings, file, () => {}, new AbortController().signal);
      return { ok: true, frames: r.frames };
    } catch (err) {
      return { ok: false, error: String(err?.stack ?? err) };
    } finally {
      k.engine.setSuspended(false);
    }
  }, mp4);
  expect(res.ok && res.frames === 150, `exported graphics.mp4 (${res.frames ?? res.error} frames)`);

  // Reference stills of the counter showing a fixed value (exactly what the export must show).
  const refs = await run(
    async ({ id, outDir, values }) => {
      const k = window.__kinora;
      const base = k.useProjectStore.getState().project;
      const out = {};
      for (const [key, { t, value }] of Object.entries(values)) {
        const p = JSON.parse(JSON.stringify(base));
        p.clips[id].counter.from = value;
        p.clips[id].counter.to = value;
        const file = `${outDir}\\graphics-ref-${key}.png`;
        const settings = { container: 'png', videoCodec: 'avc', width: 1280, height: 720, fps: 30, quality: 'high', audio: false, start: t, end: t, hardware: 'no-preference', fastStart: false };
        await k.exporter.exportProject(p, settings, file, () => {}, new AbortController().signal);
        out[key] = file;
      }
      return out;
    },
    {
      id: counterClip.id,
      outDir,
      values: {
        t1: { t: 1, value: counterAt(1) },
        t15: { t: 1.5, value: counterAt(1.5) },
        t4: { t: 4, value: counterAt(4) },
        wrong: { t: 1, value: counterAt(1) + 1111 },
      },
    },
  );

  // Decode frames of the MP4 (and the reference PNGs) in the renderer and sample pixels.
  const samples = await run(
    async ({ mp4, refs, outDir }) => {
      const url = (p) => `kinora://media/file?path=${encodeURIComponent(p)}`;
      const video = document.createElement('video');
      video.muted = true;
      video.crossOrigin = 'anonymous';
      video.src = url(mp4);
      await new Promise((r, j) => {
        video.onloadeddata = r;
        video.onerror = () => j(new Error('video failed to load'));
      });
      const W = 1280;
      const H = 720;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const frameAt = async (t) => {
        await new Promise((r) => {
          video.onseeked = r;
          video.currentTime = t + 0.5 / 30;
        });
        g.drawImage(video, 0, 0, W, H);
        return g.getImageData(0, 0, W, H).data;
      };
      const imageData = async (file) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url(file);
        await img.decode();
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const cg = c.getContext('2d', { willReadFrequently: true });
        cg.drawImage(img, 0, 0);
        return cg.getImageData(0, 0, W, H).data;
      };
      // Design px (1920×1080, centre origin) → output px.
      const px = (x, y) => [Math.round(((x + 960) * W) / 1920), Math.round(((y + 540) * H) / 1080)];
      const avg = (data, cx, cy, r = 3) => {
        const s = [0, 0, 0];
        let n = 0;
        for (let y = cy - r; y <= cy + r; y++)
          for (let x = cx - r; x <= cx + r; x++) {
            const i = (y * W + x) * 4;
            s[0] += data[i];
            s[1] += data[i + 1];
            s[2] += data[i + 2];
            n++;
          }
        return s.map((v) => Math.round(v / n));
      };
      // GIF: top-left area of the layer (always the frame's background colour).
      const gifSpot = px(-560 - 0.3 * 1620 * 0.5 + 40, -250 - 0.3 * 1080 * 0.5 + 30);
      const gif = [];
      for (const t of [0.1, 0.4, 0.7, 1.0, 2.05]) gif.push({ t, rgb: avg(await frameAt(t), gifSpot[0], gifSpot[1]) });
      // Lottie: x-centroid of orange pixels along the row through the box.
      const row = px(0, -200)[1];
      const lottie = [];
      for (const t of [0.5, 1.5]) {
        const d = await frameAt(t);
        let sum = 0;
        let n = 0;
        for (let x = 600; x < W; x++) {
          const i = (row * W + x) * 4;
          if (d[i] > 190 && d[i + 1] > 80 && d[i + 1] < 175 && d[i + 2] < 90) {
            sum += x;
            n++;
          }
        }
        lottie.push({ t, x: n ? sum / n : -1, n });
      }
      // Path: inside the triangle (solid cyan fill).
      const pathRgb = avg(await frameAt(2), ...px(-470, 260));
      // Counter: compare the region around the number with the reference renders.
      const region = { x0: px(420 - 300, 0)[0], x1: px(420 + 300, 0)[0], y0: px(0, 330 - 115)[1], y1: px(0, 330 + 115)[1] };
      const diff = (a, b) => {
        let s = 0;
        let n = 0;
        for (let y = region.y0; y < region.y1; y++)
          for (let x = region.x0; x < region.x1; x++) {
            const i = (y * W + x) * 4;
            s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            n += 3;
          }
        return s / n;
      };
      const f1 = await frameAt(1);
      const counter = {
        t1: diff(f1, await imageData(refs.t1)),
        t15: diff(await frameAt(1.5), await imageData(refs.t15)),
        t4: diff(await frameAt(4), await imageData(refs.t4)),
        wrong: diff(f1, await imageData(refs.wrong)),
      };
      // Contact sheet of exported frames for visual review.
      const sheet = document.createElement('canvas');
      sheet.width = 1280;
      sheet.height = 720;
      const sg = sheet.getContext('2d');
      const times = [0.1, 0.4, 1, 1.5, 2.5, 4];
      for (let i = 0; i < times.length; i++) {
        await frameAt(times[i]);
        sg.drawImage(video, (i % 3) * 426, Math.floor(i / 3) * 240, 426, 240);
        sg.fillStyle = '#fff';
        sg.font = '600 16px sans-serif';
        sg.fillText(`t=${times[i]}s`, (i % 3) * 426 + 8, Math.floor(i / 3) * 240 + 20);
      }
      const blob = await new Promise((r) => sheet.toBlob(r, 'image/png'));
      await window.kinora.fs.writeFile(`${outDir}\\47-graphics-export-frames.png`, new Uint8Array(await blob.arrayBuffer()));
      video.removeAttribute('src');
      video.load();
      return { gif, lottie, pathRgb, counter };
    },
    { mp4, refs, outDir },
  );
  console.log(`  samples: ${JSON.stringify(samples)}`);

  // GIF frame timing: 150 ms per frame, 6 frames, looping.
  const near = (rgb, ref, tol = 70) => Math.hypot(rgb[0] - ref[0], rgb[1] - ref[1], rgb[2] - ref[2]) < tol;
  for (const { t, rgb } of samples.gif) {
    const frame = Math.floor(((t % 0.9) + 1e-6) / 0.15);
    expect(near(rgb, GIF_COLORS[frame]), `GIF shows frame ${frame} at ${t}s (rgb ${rgb.join(',')})`);
  }
  // Lottie: 300 px wide doc drawn 432 design px wide at x ∈ [344, 776] → output px.
  const lottieX = (t) => (((344 + ((60 + 90 * t) / 300) * 432 + 960) * 1280) / 1920);
  for (const s of samples.lottie) expect(s.n > 20 && Math.abs(s.x - lottieX(s.t)) < 8, `Lottie box at ${s.t}s is at x≈${lottieX(s.t).toFixed(0)} (found ${s.x.toFixed(1)})`);
  expect(samples.pathRgb[2] > 170 && samples.pathRgb[1] > 150 && samples.pathRgb[0] < 110, `the pen path renders filled (rgb ${samples.pathRgb.join(',')})`);
  const c = samples.counter;
  expect(c.t1 < 5 && c.t15 < 5 && c.t4 < 5, `counter shows ${fmt(counterAt(1))} at 1s, ${fmt(counterAt(1.5))} at 1.5s and ${fmt(counterAt(4))} at 4s (diffs ${c.t1.toFixed(2)}, ${c.t15.toFixed(2)}, ${c.t4.toFixed(2)})`);
  expect(c.wrong > c.t1 * 2 + 1, `a different value would not match (diff ${c.wrong.toFixed(2)})`);

  // ---- Lottie stays sharp at 4K: the box edge is a hard step, not an upscaled blur -------------
  const still4k = path.join(outDir, 'graphics-4k.png');
  const edge = await run(
    async ({ file }) => {
      const k = window.__kinora;
      const project = k.useProjectStore.getState().project;
      const settings = { container: 'png', videoCodec: 'avc', width: 3840, height: 2160, fps: 30, quality: 'high', audio: false, start: 1, end: 1, hardware: 'no-preference', fastStart: false };
      await k.exporter.exportProject(project, settings, file, () => {}, new AbortController().signal);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `kinora://media/file?path=${encodeURIComponent(file)}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      // Row through the box (design y = -200), from the left of the Lottie layer.
      const y = Math.round(((-200 + 540) * 2160) / 1080);
      const d = g.getImageData(0, y, 3840, 1).data;
      let first = -1;
      let soft = 0;
      for (let x = 2400; x < 3600; x++) {
        const r = d[x * 4];
        if (first < 0 && r > 240) first = x;
        if (r > 25 && r < 230) soft++;
      }
      return { width: img.width, first, soft };
    },
    { file: still4k },
  );
  expect(edge.width === 3840 && edge.first > 0 && edge.soft <= 4, `4K export: the Lottie box has crisp edges (${edge.soft} transition pixels across both edges)`);

  // ---- Save and reopen: everything comes back --------------------------------------------------
  const pathPoints = (await project()).clips[pathClip.id].shape.path.points.length;
  await run(() => window.__kinora.useProjectStore.getState().update((p) => void (p.name = 'Graphics Test')));
  await win.keyboard.press('Control+s');
  await sleep(1200);
  const saved = path.join(outDir, 'Graphics Test.kinora');
  const reopened = await run(async (file) => {
    const k = window.__kinora;
    k.useUI.getState().set({ screen: 'home' });
    await k.projectIO.openProject(file);
    await new Promise((r) => setTimeout(r, 1500));
    const p = k.useProjectStore.getState().project;
    const clips = Object.values(p.clips);
    k.engine.seek(1.5);
    await new Promise((r) => setTimeout(r, 800));
    return {
      animations: Object.values(p.assets).filter((a) => a.kind === 'animation').map((a) => a.format),
      counter: clips.find((c) => c.type === 'text')?.counter ?? null,
      path: clips.find((c) => c.type === 'shape')?.shape.path ?? null,
      thumbs: Object.values(k.assets.useAssetRuntime.getState().items).filter((r) => r.thumb).length,
    };
  }, saved);
  expect(reopened.animations.sort().join(',') === 'gif,lottie,lottie' && reopened.counter?.to === COUNTER.to && reopened.path?.points.length === pathPoints && reopened.path.closed, 'reopening the project restores animations, the counter and the path');
  await win.waitForSelector('.timeline');
  await tab('media');
  await sleep(600);
  await shot('50-graphics-reopened');
  expect(reopened.thumbs >= 4, `media posters are regenerated after reopening (${reopened.thumbs})`);

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
