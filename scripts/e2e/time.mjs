/**
 * Time remapping & compound clips, end to end through the real UI:
 *
 *  1. Render a fixture with the app: a white bar that moves linearly with time (so any frame
 *     tells which source time it shows) and a music bed whose level rises over the clip.
 *  2. Import it three times and, with mouse and keyboard only: freeze a frame (Shift+F), reverse
 *     a clip (Speed tab toggle), give a clip a speed ramp (preset + dragging a curve point,
 *     undo), turn on Keep pitch, combine clips into a compound clip (Alt+G), open it
 *     (double-click), edit inside it with undo / redo, go back with the breadcrumb, grade it,
 *     split / trim it (undo).
 *  3. Check the preview shows the exact frames (freeze, reverse while playing, ramp), save and
 *     reopen, export through the dialog, re-import the export and check its duration, frames
 *     (bar position → source time) and audio (silence in the freeze, reversed level in the
 *     reversed clip, sound inside the compound and the ramp).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const FIX_SECONDS = 8;
/** Bar position (design px from centre) at fixture time t: -600 + 150 t. */
const sourceFromFrac = (frac) => (frac === null ? null : ((frac - 0.5) * 1920 + 600) / 150);
const ROW = 0.95;

export default async function time(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const mouse = win.mouse;
  const kb = win.keyboard;

  const state = () =>
    run(() => {
      const k = window.__kinora;
      const s = k.useProjectStore.getState();
      const p = s.project;
      const clips = Object.values(p.clips).map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        start: c.start,
        duration: c.duration,
        trackId: c.trackId,
        trimIn: c.trimIn,
        speed: c.speed,
        ramp: c.speedRamp ?? null,
        reverse: !!c.reverse,
        freeze: !!c.freeze,
        preservePitch: !!c.preservePitch,
        nested: c.type === 'compound' ? Object.keys(c.sequence.clips).length : 0,
        filter: c.filter?.id ?? null,
        opacity: c.transform?.opacity,
      }));
      return { clips, editPath: s.editPath, past: s.past.length, selection: k.useUI.getState().selection, time: k.engine.time, playing: k.engine.playing, rootClips: Object.keys(s.root.clips).length };
    });
  const center = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error('element not visible');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
  };
  const drag = async (from, to, steps = 12) => {
    await mouse.move(from.x, from.y);
    await mouse.down();
    await mouse.move(from.x + 3, from.y + 2, { steps: 2 });
    await mouse.move(to.x, to.y, { steps });
    await sleep(60);
    await mouse.up();
    await sleep(250);
  };
  const tab = async (name) => {
    await win.click(`.rail__btn[data-tab="${name}"]`);
    await sleep(400);
  };
  const inspectorTab = async (label) => {
    await win.locator('.inspector .tabs__tab', { hasText: label }).first().click();
    await sleep(300);
  };
  /** Click the ruler at a timeline time (fits the view first so every time is on screen). */
  const seekByRuler = async (t) => {
    const view = await run(() => ({ pps: window.__kinora.useUI.getState().pxPerSec, scroll: document.querySelector('.tl-scroll').scrollLeft }));
    const ruler = await win.locator('.tl-ruler').boundingBox();
    await mouse.click(ruler.x + 14 + t * view.pps - view.scroll, ruler.y + ruler.height / 2);
    await sleep(150);
  };
  const clickClip = async (id, opts = {}) => {
    const el = win.locator(`.clip[data-clip="${id}"]`);
    const b = await el.boundingBox();
    if (!b) throw new Error(`clip ${id} not visible`);
    // mouse.click has no modifiers option: hold the keys around the click.
    for (const m of opts.modifiers ?? []) await kb.down(m);
    await mouse.click(b.x + Math.min(b.width / 2, 40), b.y + b.height - 8);
    for (const m of opts.modifiers ?? []) await kb.up(m);
    await sleep(200);
  };
  const fit = async () => {
    await win.locator('.stage__overlay').click({ position: { x: 5, y: 5 } });
    await kb.press('Shift+Z');
    await sleep(300);
  };
  /** Preview source time at the playhead (waits for reversed frames to decode). */
  const previewSource = async (expected, tries = 20) => {
    let src = null;
    for (let i = 0; i < tries; i++) {
      src = sourceFromFrac(await run((row) => window.__kinora.time.measurePreview(row), ROW));
      if (src !== null && (expected === undefined || Math.abs(src - expected) < 0.07)) return src;
      await sleep(150);
    }
    return src;
  };

  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- Fixture: moving bar + rising music ----------------------------------------------------
  const fixture = path.join(outDir, 'fixture-time.mp4');
  await run(
    async ({ file, seconds }) => {
      const k = window.__kinora;
      await k.projectIO.newProject({ name: 'Time fixture', width: 1280, height: 720, fps: 30 });
      const a = k.actions;
      a.addShape('rect', { time: 0 });
      const bar = k.useUI.getState().selection[0];
      a.editClips([bar], (c) => {
        c.duration = seconds;
        c.shape.width = 36;
        c.shape.height = 1080;
        c.shape.radius = 0;
        c.shape.fill = { type: 'solid', color: '#ffffff' };
        c.keyframes = { x: [{ t: 0, v: -600, ease: 'linear' }, { t: seconds, v: -600 + 150 * seconds, ease: 'linear' }] };
      });
      await a.addSound('music-lofi-chill', { time: 0 });
      const music = k.useUI.getState().selection[0];
      a.editClips([music], (c) => {
        c.duration = seconds;
        c.keyframes = { volume: [{ t: 0, v: 0, ease: 'linear' }, { t: seconds, v: 1, ease: 'linear' }] };
      });
      const project = k.useProjectStore.getState().project;
      const settings = { container: 'mp4', videoCodec: 'avc', width: 1280, height: 720, fps: 30, quality: 'high', audio: true, start: 0, end: seconds, hardware: 'no-preference', fastStart: false };
      await k.exporter.exportProject(project, settings, file, () => {}, new AbortController().signal);
      k.useProjectStore.getState().markSaved(null);
      k.useUI.getState().set({ screen: 'home' });
    },
    { file: fixture, seconds: FIX_SECONDS },
  );
  expect(existsSync(fixture), 'fixture rendered (moving bar + rising music)');
  await win.waitForSelector('.home');

  // ---- New project, three copies of the fixture ----------------------------------------------
  await win.click('.format-card >> nth=0');
  await win.waitForSelector('.timeline');
  await run(async (file) => {
    const k = window.__kinora;
    k.useProjectStore.getState().update((p) => {
      p.name = 'Time Test';
      p.settings.width = 1280;
      p.settings.height = 720;
      p.settings.fps = 30;
    });
    await k.assets.importMediaFiles(await window.kinora.fs.stat([file]));
  }, fixture);
  await sleep(500);
  const tile = win.locator('.media-tile', { hasText: 'fixture-time' });
  for (let i = 0; i < 3; i++) {
    await tile.click();
    await sleep(250);
  }
  let s = await state();
  const [A, B, C] = s.clips.filter((c) => c.type === 'video').sort((a, b) => a.start - b.start);
  expect(!!A && !!B && !!C && Math.abs(B.start - FIX_SECONDS) < 1e-3 && Math.abs(C.start - 2 * FIX_SECONDS) < 1e-3, 'three copies of the fixture side by side');
  await fit();

  // ---- Speed ramp on C: preset, drag a point, undo -------------------------------------------
  await clickClip(C.id);
  await inspectorTab('Speed');
  await win.locator('[data-section="speed"] .segmented button', { hasText: 'Curve' }).click();
  await sleep(250);
  await win.locator('[data-ramp="hero"]').click();
  await sleep(300);
  s = await state();
  let c = s.clips.find((x) => x.id === C.id);
  expect(c.ramp && c.ramp.length === 6, `Hero time preset gives a 6-point speed ramp (duration ${C.duration.toFixed(2)}s → ${c.duration.toFixed(2)}s)`);
  const span = await run((id) => window.__kinora.time.clipSourceSpan(id), C.id);
  expect(Math.abs(span - FIX_SECONDS) < 0.05 && Math.abs(c.duration - FIX_SECONDS) > 0.2, `the clip keeps its ${span.toFixed(2)}s of content, so its length follows the curve`);
  await shot('40-time-ramp-preset');

  const point = win.locator('[data-speed-curve] [data-point="2"] .speed-curve__dot');
  const before = c.ramp[2].v;
  const p0 = await center(point);
  const pastBefore = s.past;
  await drag({ x: p0.x, y: p0.y }, { x: p0.x, y: p0.y - 34 }, 10);
  s = await state();
  c = s.clips.find((x) => x.id === C.id);
  expect(c.ramp[2].v > before * 1.5, `dragging a curve point raises its speed (${before}× → ${c.ramp[2].v}×)`);
  expect(s.past === pastBefore + 1, 'the drag is one undo step');
  await shot('41-time-ramp-drag');
  await kb.press('Control+z');
  await sleep(300);
  c = (await state()).clips.find((x) => x.id === C.id);
  expect(Math.abs(c.ramp[2].v - before) < 1e-6, 'Ctrl+Z restores the preset curve');

  // Keep pitch on the ramped clip.
  await win.locator('[data-section="playback"] .field', { hasText: 'Keep pitch' }).locator('.toggle').click();
  await sleep(200);
  expect((await state()).clips.find((x) => x.id === C.id).preservePitch, 'Keep pitch toggles preserve-pitch on');

  // ---- Reverse B -----------------------------------------------------------------------------
  await clickClip(B.id);
  await inspectorTab('Speed');
  await win.locator('[data-section="playback"] .field', { hasText: 'Reverse' }).locator('.toggle').click();
  await sleep(250);
  expect((await state()).clips.find((x) => x.id === B.id).reverse, 'the Reverse toggle reverses the clip');

  // ---- Freeze frame in A at 3 s (Shift+F) ------------------------------------------------------
  await clickClip(A.id);
  await seekByRuler(3);
  s = await state();
  expect(Math.abs(s.time - 3) < 0.05, `the ruler moves the playhead to 3 s (${s.time.toFixed(2)})`);
  await kb.press('Shift+F');
  await sleep(400);
  s = await state();
  const fr = s.clips.find((x) => x.freeze);
  const bMoved = s.clips.find((x) => x.id === B.id);
  expect(!!fr && Math.abs(fr.start - 3) < 0.02 && Math.abs(fr.duration - 2) < 0.02, 'Shift+F inserts a 2 s freeze frame at the playhead');
  expect(Math.abs(fr.trimIn - 3) < 0.04, `the freeze holds the frame under the playhead (source ${fr.trimIn.toFixed(3)}s)`);
  expect(Math.abs(bMoved.start - (B.start + 2)) < 0.02, 'later clips on the track moved right by 2 s');
  const aLeft = s.clips.find((x) => x.id === A.id);
  const aRight = s.clips.find((x) => x.type === 'video' && !x.freeze && Math.abs(x.start - 5) < 0.02);
  expect(Math.abs(aLeft.duration - 3) < 0.02 && !!aRight, 'the clip was split around the freeze frame');
  await fit();
  await shot('42-time-freeze');

  // ---- Compound clip: text + A-left + freeze (Alt+G) -------------------------------------------
  await seekByRuler(1);
  await tab('text');
  await win.locator('.lib .tile').first().click();
  await sleep(400);
  s = await state();
  const text = s.clips.find((x) => x.type === 'text');
  expect(!!text, 'a title was added over the clip');
  await clickClip(A.id);
  await clickClip(fr.id, { modifiers: ['Shift'] });
  await clickClip(text.id, { modifiers: ['Shift'] });
  s = await state();
  expect(s.selection.length === 3, 'shift-clicking selects the three clips');
  await kb.press('Alt+g');
  await sleep(400);
  s = await state();
  const comp = s.clips.find((x) => x.type === 'compound');
  expect(!!comp && comp.nested === 3 && Math.abs(comp.start) < 1e-6, `Alt+G replaces them with one compound clip (${comp?.nested} clips inside, ${comp?.duration.toFixed(2)}s)`);
  expect(!s.clips.some((x) => x.id === A.id || x.id === text.id), 'the original clips moved inside it');
  expect((await win.locator(`.clip[data-clip="${comp.id}"] .clip__mini i`).count()) >= 3, 'the timeline shows the compound with a mini map of its clips');
  await fit();
  await shot('43-time-compound-created');

  // Open it with a double-click, edit inside with undo / redo, go back with the breadcrumb.
  const compEl = win.locator(`.clip[data-clip="${comp.id}"]`);
  const cb = await compEl.boundingBox();
  await mouse.dblclick(cb.x + 30, cb.y + cb.height / 2);
  await sleep(500);
  s = await state();
  expect(s.editPath.length === 1 && s.editPath[0] === comp.id && (await win.locator('[data-compound-bar]').isVisible()), 'double-click opens the compound clip with a breadcrumb bar');
  expect(s.clips.length === 3 && s.rootClips >= 4, 'the timeline now shows the 3 nested clips');
  await shot('44-time-compound-open');
  const innerText = s.clips.find((x) => x.type === 'text');
  await clickClip(innerText.id);
  await inspectorTab('Text');
  const opacity = win.locator('[data-section="transform"] .field', { hasText: 'Opacity' }).locator('input.slider');
  await opacity.scrollIntoViewIfNeeded();
  const ob = await opacity.boundingBox();
  await mouse.click(ob.x + ob.width * 0.5, ob.y + ob.height / 2);
  await sleep(250);
  const nestedOpacity = () =>
    run(
      ({ cid, tid }) => window.__kinora.useProjectStore.getState().root.clips[cid].sequence.clips[tid].transform.opacity,
      { cid: comp.id, tid: innerText.id },
    );
  const op = await nestedOpacity();
  expect(op > 0.35 && op < 0.65, `editing inside writes into the compound clip (opacity ${op.toFixed(2)})`);
  await win.locator('.stage__overlay').click({ position: { x: 5, y: 5 } });
  await kb.press('Control+z');
  await sleep(250);
  expect((await nestedOpacity()) === 1, 'Ctrl+Z inside the compound undoes the edit');
  await kb.press('Control+Shift+z');
  await sleep(250);
  expect(Math.abs((await nestedOpacity()) - op) < 1e-6, 'Ctrl+Shift+Z redoes it');
  await win.locator('.compound-bar__crumb').first().click();
  await sleep(400);
  s = await state();
  expect(s.editPath.length === 0 && s.selection[0] === comp.id, 'the breadcrumb returns to the project timeline with the compound selected');

  // Grade it like any visual clip.
  await tab('filters');
  await win.locator('.lib .tile').nth(4).click();
  await sleep(300);
  expect(!!(await state()).clips.find((x) => x.id === comp.id).filter, 'a filter applies to the compound clip');

  // Split (S) and trim (drag), then undo both.
  await seekByRuler(2);
  await clickClip(comp.id);
  const nBefore = (await state()).clips.length;
  await kb.press('s');
  await sleep(300);
  s = await state();
  const halves = s.clips.filter((x) => x.type === 'compound').sort((a, b) => a.start - b.start);
  expect(halves.length === 2 && Math.abs(halves[1].trimIn - 2) < 0.02 && s.clips.length === nBefore + 1, 'S splits the compound clip (the right half starts 2 s into it)');
  await kb.press('Control+z');
  await sleep(300);
  await fit();
  const handle = await center(win.locator(`.clip[data-clip="${comp.id}"] .clip__handle--r`));
  await drag(handle, { x: handle.x - 25, y: handle.y });
  s = await state();
  const trimmed = s.clips.find((x) => x.id === comp.id);
  expect(trimmed.duration < comp.duration - 0.1, `dragging its edge trims the compound clip (${comp.duration.toFixed(2)}s → ${trimmed.duration.toFixed(2)}s)`);
  await kb.press('Control+z');
  await sleep(300);
  expect(Math.abs((await state()).clips.find((x) => x.id === comp.id).duration - comp.duration) < 1e-6, 'Ctrl+Z restores it');
  await shot('45-time-timeline');

  // ---- Preview -------------------------------------------------------------------------------
  const expected = (t) => run((t) => window.__kinora.time.expectedSourceAt(t), t);
  await seekByRuler(4);
  let src = await previewSource(3);
  expect(src !== null && Math.abs(src - 3) < 0.07, `preview holds the frozen frame (source ${src?.toFixed(3)}s at 4 s)`);
  await shot('46-time-preview-freeze');
  const bStart = (await state()).clips.find((x) => x.id === B.id).start;
  await seekByRuler(bStart + 1);
  const e1 = await expected(bStart + 1);
  src = await previewSource(e1.source);
  expect(src !== null && Math.abs(src - e1.source) < 0.07, `preview shows the reversed clip's frame (source ${src?.toFixed(3)}s, expected ${e1.source.toFixed(3)}s)`);
  await shot('47-time-preview-reverse');
  // Play through the reversed clip: the bar must move backwards.
  await seekByRuler(bStart + 0.5);
  await sleep(300);
  await kb.press(' ');
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await sleep(320);
    samples.push(sourceFromFrac(await run((row) => window.__kinora.time.measurePreview(row), ROW)));
  }
  await shot('48-time-preview-reverse-playing');
  await kb.press(' ');
  const valid = samples.filter((v) => v !== null);
  const decreasing = valid.length >= 4 && valid.every((v, i) => i === 0 || v < valid[i - 1] + 0.02) && valid[0] - valid[valid.length - 1] > 0.6;
  expect(decreasing, `reversed playback runs backwards smoothly (${valid.map((v) => v.toFixed(2)).join(' → ')})`);
  const cNow = (await state()).clips.find((x) => x.id === C.id);
  const tRamp = cNow.start + cNow.duration * 0.5;
  await seekByRuler(tRamp);
  const tRampNow = (await state()).time;
  const e2 = await expected(tRampNow);
  src = await previewSource(e2.source);
  expect(src !== null && Math.abs(src - e2.source) < 0.07, `preview follows the speed ramp (source ${src?.toFixed(3)}s, expected ${e2.source.toFixed(3)}s at ${e2.speed.toFixed(2)}×)`);
  await shot('49-time-preview-ramp');
  // Play across the ramp.
  await kb.press(' ');
  await sleep(1200);
  const playing = await state();
  await kb.press(' ');
  expect(playing.playing && playing.time > tRampNow + 0.8, 'playback runs through the ramp');

  // ---- Save & reopen -------------------------------------------------------------------------
  await kb.press('Control+s');
  await sleep(1200);
  const saved = path.join(outDir, 'Time Test.kinora');
  expect(existsSync(saved), 'Ctrl+S writes the project');
  const snapshot = await state();
  await run(async (file) => {
    const k = window.__kinora;
    k.useUI.getState().set({ screen: 'home' });
    await k.projectIO.openProject(file);
  }, saved);
  await sleep(1200);
  s = await state();
  const same = (a, b) => a.type === b.type && Math.abs(a.start - b.start) < 1e-6 && Math.abs(a.duration - b.duration) < 1e-6 && a.reverse === b.reverse && a.freeze === b.freeze && a.preservePitch === b.preservePitch && JSON.stringify(a.ramp) === JSON.stringify(b.ramp) && a.nested === b.nested;
  expect(s.clips.length === snapshot.clips.length && snapshot.clips.every((a) => s.clips.some((b) => b.id === a.id && same(a, b))), 'ramps, reverse, keep pitch, freeze and the compound clip survive save → reopen');

  // ---- Export through the dialog and verify the file --------------------------------------------
  const duration = await run(() => window.__kinora.engine.duration);
  // Open the compound clip first: exporting always renders the whole project.
  const cb2 = await win.locator(`.clip[data-clip="${comp.id}"]`).boundingBox();
  await mouse.dblclick(cb2.x + 30, cb2.y + cb2.height / 2);
  await sleep(400);
  expect((await state()).editPath.length === 1, 'the compound clip is open again');
  await kb.press('Control+e');
  await win.waitForSelector('.modal');
  await sleep(300);
  expect((await state()).editPath.length === 0, 'opening the export dialog returns to the project timeline');
  await win.locator('.modal .btn--primary', { hasText: 'Export' }).click();
  await win.waitForSelector('.export-done', { timeout: 300000 });
  await shot('50-time-export-done');
  await win.locator('.modal .btn--primary', { hasText: 'Done' }).click();
  const exported = path.join(outDir, 'Time Test.mp4');
  expect(existsSync(exported), 'the export dialog wrote the video');

  const assetId = await run(async (file) => {
    const k = window.__kinora;
    const res = await k.assets.importMediaFiles(await window.kinora.fs.stat([file]));
    return res.assets[0]?.id ?? null;
  }, exported);
  expect(!!assetId, 'the export imports back');
  s = await state();
  const cExp = s.clips.find((x) => x.id === C.id);
  const bExp = s.clips.find((x) => x.id === B.id);
  const times = [1.5, 4, 4.9, 7, bExp.start + 1, bExp.start + 5, cExp.start + 0.4, cExp.start + cExp.duration * 0.45, cExp.start + cExp.duration - 0.4];
  const exp = [];
  for (const t of times) exp.push(await expected(t));
  const windows = [
    [1, 2.8],
    [3.2, 4.8],
    [bExp.start + 0.2, bExp.start + 2.2],
    [bExp.start + 5.8, bExp.start + 7.8],
    [cExp.start + 0.3, cExp.start + cExp.duration - 0.3],
  ];
  const probe = await run(({ id, times, row, windows }) => window.__kinora.time.probeAsset(id, times, row, windows), { id: assetId, times, row: ROW, windows });
  expect(Math.abs(probe.duration - duration) < 0.15, `exported duration matches the timeline (${probe.duration.toFixed(2)}s vs ${duration.toFixed(2)}s)`);
  const labels = ['compound: clip inside', 'compound: freeze frame', 'compound: freeze frame (end)', 'after the freeze', 'reversed', 'reversed (later)', 'ramp start', 'ramp middle', 'ramp end'];
  times.forEach((t, i) => {
    const got = sourceFromFrac(probe.bars[i] === null ? null : probe.bars[i] / probe.width);
    const want = exp[i].source;
    expect(got !== null && Math.abs(got - want) < 0.075, `export frame at ${t.toFixed(2)}s (${labels[i]}) shows source ${got?.toFixed(3)}s (expected ${want.toFixed(3)}s)`);
  });
  const [rCompound, rFreeze, rRevEarly, rRevLate, rRamp] = probe.rms;
  console.log(`  audio RMS: compound ${rCompound.toFixed(4)}, freeze ${rFreeze.toFixed(4)}, reverse ${rRevEarly.toFixed(4)} → ${rRevLate.toFixed(4)}, ramp ${rRamp.toFixed(4)}`);
  expect(rCompound > 0.004, 'the compound clip plays the sound of the clip inside it');
  expect(rFreeze < 0.0015, 'the freeze frame is silent');
  expect(rRevEarly > rRevLate * 2, 'the reversed clip plays its rising music backwards (loud → quiet)');
  expect(rRamp > 0.01, 'the ramped clip (keep pitch on) has sound');

  // ---- Break apart (Alt+Shift+G) and undo ------------------------------------------------------
  await fit();
  await clickClip(comp.id);
  await kb.press('Alt+Shift+g');
  await sleep(400);
  s = await state();
  const back = (id) => s.clips.find((x) => x.id === id);
  expect(!s.clips.some((x) => x.type === 'compound'), 'Alt+Shift+G breaks the compound clip apart');
  expect(back(A.id) && Math.abs(back(A.id).start) < 1e-6 && back(fr.id) && Math.abs(back(fr.id).start - 3) < 1e-6 && back(fr.id).freeze && back(text.id) && Math.abs(back(text.id).start - 1) < 1e-6, 'its clips are back at their timeline positions');
  const trackIndex = (id) => run((tid) => window.__kinora.useProjectStore.getState().project.tracks.findIndex((t) => t.id === tid), back(id).trackId);
  expect((await trackIndex(text.id)) < (await trackIndex(A.id)), 'and keep their layering (title above the video)');
  await shot('51-time-broken-apart');
  await kb.press('Control+z');
  await sleep(300);
  expect((await state()).clips.some((x) => x.id === comp.id && x.type === 'compound'), 'Ctrl+Z brings the compound clip back');

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
