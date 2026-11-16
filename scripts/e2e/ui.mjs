/**
 * Interaction test: drives the editor with real mouse and keyboard input (clicks, drags,
 * shortcuts) and checks the resulting project state after each step.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

export default async function ui(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const mouse = win.mouse;
  const state = () =>
    run(() => {
      const k = window.__kinora;
      const p = k.useProjectStore.getState().project;
      return {
        clips: Object.values(p.clips).map((c) => ({ id: c.id, type: c.type, start: c.start, duration: c.duration, trackId: c.trackId, effects: c.effects?.length ?? 0, x: c.transform?.x, y: c.transform?.y, opacity: c.transform?.opacity, font: c.text?.fontFamily, content: c.text?.content })),
        transitions: Object.values(p.transitions).length,
        tracks: p.tracks.length,
        selection: k.useUI.getState().selection,
        time: k.engine.time,
        playing: k.engine.playing,
        past: k.useProjectStore.getState().past.length,
      };
    });
  const center = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error('element not visible');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
  };
  const drag = async (from, to, steps = 14) => {
    await mouse.move(from.x, from.y);
    await mouse.down();
    await mouse.move(from.x + 6, from.y + 2, { steps: 2 });
    await mouse.move(to.x, to.y, { steps });
    await sleep(60);
    await mouse.up();
    await sleep(250);
  };
  const tab = async (name) => {
    await win.click(`.rail__btn[data-tab="${name}"]`);
    await sleep(500);
  };

  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- Fixtures: render a short clip and a still with the app itself --------------------------
  const clipFile = path.join(outDir, 'fixture-clip.mp4');
  const stillFile = path.join(outDir, 'fixture-still.png');
  await run(
    async ({ clipFile, stillFile }) => {
      const k = window.__kinora;
      await k.projectIO.newProject({ name: 'Fixture', width: 1280, height: 720, fps: 30 });
      k.actions.addGenerator('aurora', { time: 0 });
      k.engine.seek(0);
      k.actions.addText('gradient-title', { time: 0 });
      await k.actions.addSound('ding', { time: 0.5 });
      const project = k.useProjectStore.getState().project;
      const base = { videoCodec: 'avc', width: 1280, height: 720, fps: 30, quality: 'medium', audio: true, start: 0, end: 5, hardware: 'no-preference', fastStart: false };
      const signal = new AbortController().signal;
      await k.exporter.exportProject(project, { ...base, container: 'mp4' }, clipFile, () => {}, signal);
      await k.exporter.exportProject(project, { ...base, container: 'png', start: 2, end: 2 }, stillFile, () => {}, signal);
      k.useProjectStore.getState().markSaved(null);
      k.useUI.getState().set({ screen: 'home' });
    },
    { clipFile, stillFile },
  );
  expect(existsSync(clipFile) && existsSync(stillFile), 'fixtures rendered');
  await win.waitForSelector('.home');

  // ---- New project by clicking a format card ----------------------------------------------------
  await win.click('.format-card >> nth=0');
  await win.waitForSelector('.timeline');
  await run(async (files) => {
    const k = window.__kinora;
    await k.assets.importMediaFiles(await window.kinora.fs.stat(files));
  }, [clipFile, stillFile]);
  await sleep(600);
  expect((await win.locator('.media-tile').count()) === 2, 'two media tiles in the bin');

  // Click to add (video), click again (appends after it on the base track).
  await win.locator('.media-tile', { hasText: 'fixture-clip' }).click();
  await sleep(300);
  await win.locator('.media-tile', { hasText: 'fixture-clip' }).click();
  await sleep(400);
  let s = await state();
  const videos = s.clips.filter((c) => c.type === 'video').sort((a, b) => a.start - b.start);
  expect(videos.length === 2 && Math.abs(videos[1].start - (videos[0].start + videos[0].duration)) < 1e-3, 'clicking a tile twice builds a sequence of two adjacent clips');

  // Drag the still onto the timeline, above the video track.
  const still = await center(win.locator('.media-tile', { hasText: 'fixture-still' }));
  const ruler = await center(win.locator('.tl-ruler'));
  const zone = { x: ruler.box.x + 220, y: ruler.box.y + ruler.box.height + 10 };
  await drag(still, zone, 20);
  s = await state();
  expect(s.clips.some((c) => c.type === 'image'), 'dragging media to the top zone of the timeline adds an image clip');
  expect(s.tracks >= 3, 'a new track was created for it');
  await shot('20-ui-media');

  // ---- Timeline: move, trim, split, undo ----------------------------------------------------
  const img = s.clips.find((c) => c.type === 'image');
  const imgEl = win.locator(`.clip[data-clip="${img.id}"]`);
  const imgBox = await center(imgEl);
  await drag({ x: imgBox.x, y: imgBox.y }, { x: imgBox.x + 90, y: imgBox.y });
  s = await state();
  const moved = s.clips.find((c) => c.id === img.id);
  expect(moved.start > img.start + 0.3, `dragging a clip moves it later (${img.start.toFixed(2)}s → ${moved.start.toFixed(2)}s)`);

  const handle = await center(imgEl.locator('.clip__handle--r'));
  await drag(handle, { x: handle.x - 60, y: handle.y });
  s = await state();
  const trimmed = s.clips.find((c) => c.id === img.id);
  expect(trimmed.duration < moved.duration - 0.3, `dragging the right edge trims the clip (${moved.duration.toFixed(2)}s → ${trimmed.duration.toFixed(2)}s)`);

  // Click the first video, move the playhead into it with the ruler, press S.
  const v1 = win.locator(`.clip[data-clip="${videos[0].id}"]`);
  await v1.click({ position: { x: 30, y: 30 } });
  const v1Box = await center(v1);
  await mouse.click(v1Box.x, ruler.y);
  await sleep(200);
  const before = (await state()).clips.length;
  await win.keyboard.press('s');
  await sleep(300);
  s = await state();
  expect(s.clips.length === before + 1, 'S splits the selected clip at the playhead');
  await win.keyboard.press('Control+z');
  await sleep(300);
  expect((await state()).clips.length === before, 'Ctrl+Z undoes the split');
  await win.keyboard.press('Control+Shift+z');
  await sleep(300);
  expect((await state()).clips.length === before + 1, 'Ctrl+Shift+Z redoes it');
  await win.keyboard.press('Control+z');
  await sleep(300);

  // Context menu → Duplicate.
  await win.locator(`.clip[data-clip="${img.id}"]`).click({ button: 'right' });
  await sleep(200);
  expect(await win.locator('.menu').isVisible(), 'right-click opens the clip menu');
  await win.locator('.menu__item', { hasText: 'Duplicate' }).click();
  await sleep(300);
  expect((await state()).clips.filter((c) => c.type === 'image').length === 2, 'Duplicate creates a copy');
  await win.keyboard.press('Delete');
  await sleep(300);
  expect((await state()).clips.filter((c) => c.type === 'image').length === 1, 'Delete removes the selected copy');

  // ---- Transition: drag onto the cut between the two videos ------------------------------------
  await tab('transitions');
  await shot('21-ui-transitions-tab');
  const trTile = await center(win.locator('.lib .tile').nth(2));
  const cutX = (await win.locator(`.clip[data-clip="${videos[1].id}"]`).boundingBox()).x;
  const v1Row = await center(win.locator(`.clip[data-clip="${videos[0].id}"]`));
  await drag(trTile, { x: cutX + 4, y: v1Row.y }, 24);
  s = await state();
  expect(s.transitions === 1, 'dropping a transition on a cut adds it');
  await shot('22-ui-transition-added');

  // ---- Text: add a preset, edit it in the inspector, move it on the canvas --------------------
  await mouse.click(ruler.box.x + 120, ruler.y);
  await tab('text');
  await shot('23-ui-text-tab');
  await win.locator('.lib .tile').first().click();
  await sleep(500);
  s = await state();
  const text = s.clips.find((c) => c.type === 'text');
  expect(!!text && s.selection.includes(text.id), 'clicking a text preset adds and selects a text clip');
  await win.locator('.inspector textarea').fill('Hello from Kinora');
  await sleep(200);
  await win.click('.font-picker');
  await win.locator('.font-item', { hasText: 'Bebas Neue' }).click();
  await sleep(500);
  s = await state();
  const edited = s.clips.find((c) => c.id === text.id);
  expect(edited.content === 'Hello from Kinora' && edited.font === 'Bebas Neue', 'inspector edits text content and font');

  const gizmo = await center(win.locator('.gizmo__body'));
  await drag(gizmo, { x: gizmo.x + 120, y: gizmo.y - 60 });
  s = await state();
  const placed = s.clips.find((c) => c.id === text.id);
  expect(placed.x > 60 && placed.y < -30, `dragging on the canvas moves the text (x=${placed.x.toFixed(0)}, y=${placed.y.toFixed(0)})`);

  const opacity = win.locator('[data-section="transform"] .field', { hasText: 'Opacity' }).locator('input.slider');
  await opacity.scrollIntoViewIfNeeded();
  const ob = await opacity.boundingBox();
  await mouse.click(ob.x + ob.width * 0.5, ob.y + ob.height / 2);
  await sleep(200);
  s = await state();
  const op = s.clips.find((c) => c.id === text.id).opacity;
  expect(op > 0.35 && op < 0.65, `opacity slider sets ~50% (${op.toFixed(2)})`);
  await shot('24-ui-text-edited');

  // Animate tab.
  await win.locator('.tabs__tab', { hasText: 'Animate' }).click();
  await sleep(700);
  await shot('25-ui-animate-tab');
  await win.locator('.anim-tile').nth(3).click();
  await sleep(200);
  expect(await run((id) => !!window.__kinora.useProjectStore.getState().project.clips[id].textAnim?.in, text.id), 'picking an animation tile sets the entrance');

  // ---- Effects / filters / stickers / templates / elements / audio tabs ------------------------
  await win.locator(`.clip[data-clip="${videos[0].id}"]`).click({ position: { x: 20, y: 30 } });
  await tab('effects');
  await shot('26-ui-effects-tab');
  await win.locator('.lib .tile').nth(5).click();
  await sleep(300);
  expect((await state()).clips.find((c) => c.id === videos[0].id).effects === 1, 'clicking an effect applies it to the selected clip');

  await tab('filters');
  await shot('27-ui-filters-tab');
  await win.locator('.lib .tile').nth(4).click();
  await sleep(300);
  expect(await run((id) => !!window.__kinora.useProjectStore.getState().project.clips[id].filter, videos[0].id), 'clicking a filter applies it');

  await win.locator('.tabs__tab', { hasText: 'Adjust' }).click();
  await sleep(400);
  await shot('28-ui-adjust-tab');

  await tab('stickers');
  await win.locator('.search input').fill('heart');
  await sleep(500);
  await shot('29-ui-stickers-search');
  await win.locator('.sticker-tile').first().click();
  await sleep(300);
  expect((await state()).clips.some((c) => c.type === 'sticker'), 'searching and clicking a sticker adds it');

  await tab('elements');
  await sleep(600);
  await shot('30-ui-elements-tab');
  await tab('audio');
  await shot('31-ui-audio-tab');
  await tab('templates');
  await sleep(1500);
  await shot('32-ui-templates-tab');
  const beforeTpl = (await state()).clips.length;
  await win.locator('.tile--template').first().click();
  await sleep(500);
  expect((await state()).clips.length > beforeTpl, 'clicking a template adds its layers');

  // ---- Playback with the keyboard ------------------------------------------------------------
  await win.locator('.stage__overlay').click({ position: { x: 5, y: 5 } });
  await win.keyboard.press('Home');
  const f0 = await run(() => window.__kinora.engine.framesRendered);
  await win.keyboard.press(' ');
  await sleep(1500);
  s = await state();
  expect(s.playing && s.time > 0.8, `Space plays (t=${s.time.toFixed(2)}s)`);
  const f1 = await run(() => window.__kinora.engine.framesRendered);
  console.log(`  preview rendered ${Math.round((f1 - f0) / 1.5)} fps while playing ${s.clips.length} clips`);
  await shot('33-ui-playing');
  await win.keyboard.press(' ');
  await sleep(200);
  expect(!(await state()).playing, 'Space pauses');

  // ---- Save & reopen -------------------------------------------------------------------------
  await run(() => window.__kinora.useProjectStore.getState().update((p) => void (p.name = 'UI Test')));
  await win.keyboard.press('Control+s');
  await sleep(1200);
  const saved = path.join(outDir, 'UI Test.kinora');
  expect(existsSync(saved), 'Ctrl+S writes the project file');
  const countBefore = (await state()).clips.length;
  await run(async (file) => {
    const k = window.__kinora;
    k.useUI.getState().set({ screen: 'home' });
    await k.projectIO.openProject(file);
  }, saved);
  await sleep(1500);
  expect((await state()).clips.length === countBefore, 'reopening the saved project restores every clip');
  await shot('34-ui-reopened');

  // ---- Export through the dialog -------------------------------------------------------------
  await win.keyboard.press('Control+e');
  await win.waitForSelector('.modal');
  await sleep(400);
  await shot('35-ui-export-dialog');
  await win.locator('.modal .btn--primary', { hasText: 'Export' }).click();
  await win.waitForSelector('.export-done', { timeout: 120000 });
  await shot('36-ui-export-done');
  expect(existsSync(path.join(outDir, 'UI Test.mp4')), 'the export dialog writes the video file');
  await win.locator('.modal .btn--primary', { hasText: 'Done' }).click();

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
