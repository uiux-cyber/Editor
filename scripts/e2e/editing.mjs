/**
 * Timeline editing depth, driven through the real UI with mouse and keyboard:
 * magnetic main track, ripple / roll / slip / slide trims (with the live readout and the two-up
 * trim monitor), moving onto and off the main track, library drops onto it, groups, linked
 * video + audio, resizable track heights, the History panel, and save → reopen.
 *
 *   npm run build && node scripts/e2e.mjs editing
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
const PPS = 60;

export default async function editing(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const mouse = win.mouse;
  const kb = win.keyboard;

  const state = () =>
    run(() => {
      const k = window.__kinora;
      const s = k.useProjectStore.getState();
      const p = s.project;
      return {
        clips: Object.values(p.clips).map((c) => ({ id: c.id, type: c.type, start: c.start, duration: c.duration, trimIn: c.trimIn, trackId: c.trackId, groupId: c.groupId ?? null, linkId: c.linkId ?? null })),
        tracks: p.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, height: t.height ?? null })),
        magneticMain: !!p.magneticMain,
        selection: k.useUI.getState().selection,
        tool: k.useUI.getState().tool,
        labels: s.pastMeta.map((m) => m.label),
        past: s.past.length,
        future: s.future.length,
      };
    });
  const clip = (s, id) => s.clips.find((c) => c.id === id);
  const mainTrack = (s) => [...s.tracks].reverse().find((t) => t.kind === 'visual');
  const onTrack = (s, trackId) => s.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  const box = async (selector) => {
    const b = await win.locator(selector).first().boundingBox();
    if (!b) throw new Error(`not visible: ${selector}`);
    return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2, right: b.x + b.width, bottom: b.y + b.height };
  };
  const clipBox = (id) => box(`.clip[data-clip="${id}"]`);
  /** Press, move in steps, optionally run `mid` while still holding, release. */
  const drag = async (from, to, { mods = [], mid, steps = 16 } = {}) => {
    for (const m of mods) await kb.down(m);
    await mouse.move(from.x, from.y);
    await mouse.down();
    await mouse.move(from.x + Math.sign(to.x - from.x || 1) * 6, from.y + 1, { steps: 2 });
    await mouse.move(to.x, to.y, { steps });
    await sleep(80);
    if (mid) await mid();
    await mouse.up();
    for (const m of mods) await kb.up(m);
    await sleep(250);
  };
  const click = async (selector, opts = {}) => {
    await win.locator(selector).first().click(opts);
    await sleep(150);
  };
  const press = async (key) => {
    await kb.press(key);
    await sleep(200);
  };

  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- Fixture: an 8 s clip with sound and a text that travels across the frame ----------------
  const fixture = path.join(outDir, 'editing-fixture.mp4');
  await run(async (file) => {
    const k = window.__kinora;
    await k.projectIO.newProject({ name: 'Fixture', width: 1280, height: 720, fps: 30 });
    k.actions.addGenerator('aurora', { time: 0 });
    k.useProjectStore.getState().update((p) => {
      for (const c of Object.values(p.clips)) c.duration = 8;
    });
    k.engine.seek(0);
    k.actions.addText('gradient-title', { time: 0 });
    k.actions.editClips(k.useUI.getState().selection, (c) => {
      c.duration = 8;
      c.keyframes = { x: [{ t: 0, v: -520, ease: 'linear' }, { t: 8, v: 520, ease: 'linear' }] };
    });
    await k.actions.addSound('ding', { time: 0.5 });
    const project = k.useProjectStore.getState().project;
    const settings = { container: 'mp4', videoCodec: 'avc', width: 1280, height: 720, fps: 30, quality: 'medium', audio: true, start: 0, end: 8, hardware: 'no-preference', fastStart: false };
    await k.exporter.exportProject(project, settings, file, () => {}, new AbortController().signal);
    k.useProjectStore.getState().markSaved(null);
    k.useUI.getState().set({ screen: 'home' });
  }, fixture);
  expect(existsSync(fixture), 'fixture rendered');
  await win.waitForSelector('.home');

  // ---- New project, three clips on the magnetic main track -----------------------------------
  await win.click('.format-card >> nth=0');
  await win.waitForSelector('.timeline');
  await run(async (file) => {
    const k = window.__kinora;
    await k.assets.importMediaFiles(await window.kinora.fs.stat([file]));
  }, fixture);
  await sleep(600);
  const tile = win.locator('.media-tile', { hasText: 'editing-fixture' });
  for (let i = 0; i < 3; i++) {
    await tile.click();
    await sleep(300);
  }
  // Deterministic geometry for the drags (60 px per second) and no snapping.
  await run((pps) => window.__kinora.useUI.getState().set({ pxPerSec: pps, snapping: false }), PPS);
  await press('Home');
  await sleep(300);
  let s = await state();
  const main = mainTrack(s);
  let seq = onTrack(s, main.id);
  const [A, B, C] = seq.map((c) => c.id);
  expect(s.magneticMain, 'new projects have the magnetic main track on');
  expect(seq.length === 3 && near(seq[0].start, 0) && near(seq[1].start, 8) && near(seq[2].start, 16), 'clicking the tile three times builds a gap-free sequence on Main');
  expect((await win.locator('.tl-header.is-main').innerText()).includes('Main'), 'the bottom track is labelled Main with a magnet');
  await shot('40-edit-main-track');

  // ---- Trim on Main ripples automatically ------------------------------------------------------
  let a = await clipBox(A);
  await drag({ x: a.right - 3, y: a.cy }, { x: a.right - 3 - 2 * PPS, y: a.cy });
  s = await state();
  expect(near(clip(s, A).duration, 6) && near(clip(s, B).start, 6) && near(clip(s, C).start, 14), 'trimming a Main clip pulls the later clips left (no gap)');
  expect(s.labels.at(-1) === 'Ripple trim', `the undo step is labelled "${s.labels.at(-1)}"`);

  // ---- No flicker: the preview follows a dragged edge without flashing black -------------------
  // Trimming C (not on screen yet) moves the preview to C's edge, a picture it has never shown:
  // it keeps the previous frame until C's video has one, instead of drawing black meanwhile.
  await press('Home');
  await sleep(400);
  await run(() => {
    window.__holes = { frames: 0, black: 0 };
    const small = document.createElement('canvas');
    small.width = 16;
    small.height = 9;
    const g = small.getContext('2d', { willReadFrequently: true });
    window.__offHoles = window.__kinora.engine.onRendered((comp) => {
      window.__holes.frames++;
      g.drawImage(comp.canvas, 0, 0, 16, 9);
      const d = g.getImageData(0, 0, 16, 9).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      if (sum / (16 * 9 * 3) < 6) window.__holes.black++;
    });
  });
  const c0 = await clipBox(C);
  await drag({ x: c0.right - 3, y: c0.cy }, { x: c0.right - 3 - PPS, y: c0.cy });
  await sleep(800);
  const holes = await run(() => {
    window.__offHoles();
    return window.__holes;
  });
  expect(holes.frames > 0 && holes.black === 0, `the preview never flashes black while trimming (${JSON.stringify(holes)})`);
  await run(() => window.__kinora.useProjectStore.getState().undo());
  s = await state();
  expect(near(clip(s, C).duration, 8), 'undo restores C');

  // ---- Magnetic toggle, normal trim leaves a gap, Shift-drag ripples ----------------------------
  await click('[data-magnetic-toggle]');
  s = await state();
  expect(!s.magneticMain && !(await win.locator('.tl-header.is-main').count()), 'the toolbar toggle turns the magnetic main track off');
  a = await clipBox(A);
  await drag({ x: a.right - 3, y: a.cy }, { x: a.right - 3 - PPS, y: a.cy });
  s = await state();
  expect(near(clip(s, A).duration, 5) && near(clip(s, B).start, 6), 'without magnetism a trim leaves a gap');
  let b = await clipBox(B);
  await drag({ x: b.right - 3, y: b.cy }, { x: b.right - 3 - PPS, y: b.cy }, { mods: ['Shift'] });
  s = await state();
  expect(near(clip(s, B).duration, 7) && near(clip(s, C).start, 13), 'Shift-dragging an edge ripple-trims: later clips follow');
  await click('[data-magnetic-toggle]');
  s = await state();
  expect(s.magneticMain && near(clip(s, B).start, 5) && near(clip(s, C).start, 12), 'turning magnetism back on closes the gap');

  // ---- Roll (R) with the two-up monitor and readout --------------------------------------------
  await press('r');
  expect((await state()).tool === 'roll' && (await win.locator('[data-tool="roll"].is-active').count()) === 1, 'R selects the Roll tool');
  a = await clipBox(A);
  let monitorSeen = false;
  let readoutText = '';
  await drag(
    { x: a.right - 2, y: a.cy },
    { x: a.right - 2 + PPS, y: a.cy },
    {
      mid: async () => {
        await sleep(900);
        monitorSeen = (await win.locator('.trim-monitor .trim-monitor__frame').count()) === 2;
        readoutText = await win.locator('[data-edit-readout]').innerText();
        await shot('41-edit-roll-monitor');
      },
    },
  );
  s = await state();
  expect(monitorSeen, 'rolling shows the two-up outgoing / incoming monitor over the preview');
  expect(/Roll edit/.test(readoutText) && /\+00:01:00/.test(readoutText) && /\+30 f/.test(readoutText), `the readout shows the roll delta (${readoutText.replace(/\s+/g, ' ')})`);
  expect(near(clip(s, A).duration, 6) && near(clip(s, B).start, 6) && near(clip(s, B).duration, 6) && near(clip(s, B).trimIn, 1) && near(clip(s, C).start, 12), 'roll moves the cut: A grows, B shrinks and starts later in its media');
  expect((await win.locator('.trim-monitor').count()) === 0, 'the monitor closes on release');

  // ---- Slip (Y) ----------------------------------------------------------------------------------
  await press('y');
  b = await clipBox(B);
  monitorSeen = false;
  await drag(
    { x: b.cx, y: b.cy },
    { x: b.cx - PPS, y: b.cy },
    {
      mid: async () => {
        await sleep(900);
        monitorSeen = (await win.locator('[data-trim-monitor="slip"] .trim-monitor__frame').count()) === 2;
        await shot('42-edit-slip-monitor');
      },
    },
  );
  s = await state();
  expect(monitorSeen, 'slipping shows the new in / out frames');
  expect(near(clip(s, B).trimIn, 2) && near(clip(s, B).start, 6) && near(clip(s, B).duration, 6), 'slip moves B’s source in / out while its place and length stay');

  // ---- Slide (U) ---------------------------------------------------------------------------------
  await press('u');
  b = await clipBox(B);
  await drag({ x: b.cx, y: b.cy }, { x: b.cx + PPS, y: b.cy });
  s = await state();
  expect(near(clip(s, B).start, 7) && near(clip(s, A).duration, 7) && near(clip(s, C).start, 13) && near(clip(s, C).duration, 7) && near(clip(s, C).trimIn, 1), 'slide moves B; A lengthens and C shortens to compensate');

  // ---- Ripple tool (E): trim B’s head, B keeps its start, C follows ------------------------------
  await press('e');
  b = await clipBox(B);
  await drag({ x: b.x + 2, y: b.cy }, { x: b.x + 2 + PPS, y: b.cy });
  s = await state();
  expect(near(clip(s, B).start, 7) && near(clip(s, B).duration, 5) && near(clip(s, B).trimIn, 3) && near(clip(s, C).start, 12), 'the Ripple tool trims B’s head and pulls C left');
  await shot('43-edit-after-trims');

  // ---- Moving on / off Main ----------------------------------------------------------------------
  await press('v');
  let cBox = await clipBox(C);
  let insertSeen = false;
  await drag(
    { x: cBox.cx, y: cBox.cy },
    { x: cBox.cx - 12 * PPS - 60, y: cBox.cy },
    {
      mid: async () => {
        insertSeen = (await win.locator('[data-insert-mark]').count()) === 1;
        await shot('44-edit-magnetic-insert');
      },
    },
  );
  s = await state();
  seq = onTrack(s, main.id);
  expect(insertSeen, 'dragging onto Main shows the insertion point');
  expect(seq[0].id === C && near(seq[0].start, 0) && near(seq[1].start, 7) && seq[1].id === A && near(seq[2].start, 14), 'dropping C at the start inserts it there and pushes A and B right');
  await press('Control+z');
  s = await state();
  expect(onTrack(s, main.id).map((c) => c.id).join() === [A, B, C].join(), 'undo restores the order');

  // Library drop onto Main between A and B: inserted at the cut.
  const tileBox = await box('.media-tile');
  a = await clipBox(A);
  await drag({ x: tileBox.cx, y: tileBox.cy }, { x: a.right + 8, y: a.cy }, { steps: 24 });
  s = await state();
  seq = onTrack(s, main.id);
  expect(seq.length === 4 && seq[1].id !== B && near(seq[1].start, 7) && seq[2].id === B && near(seq[2].start, 15), 'dropping media on Main inserts it at the nearest cut');
  await press('Control+z');

  // Drag B up off Main into a new track: Main closes the gap.
  b = await clipBox(B);
  const topZone = await box('.tl-ruler');
  await drag({ x: b.cx, y: b.cy }, { x: b.cx, y: topZone.bottom + 10 });
  s = await state();
  seq = onTrack(s, main.id);
  expect(clip(s, B).trackId !== main.id && seq.map((c) => c.id).join() === [A, C].join() && near(clip(s, C).start, 7), 'moving a clip off Main closes the gap it leaves');
  await press('Control+z');

  // ---- Groups -----------------------------------------------------------------------------------
  await press('Home');
  await win.locator('.rail__btn[data-tab="text"]').click();
  await sleep(500);
  await win.locator('.lib .tile').first().click();
  await sleep(300);
  await win.locator('.lib .tile').nth(1).click();
  await sleep(300);
  s = await state();
  const texts = s.clips.filter((c) => c.type === 'text').map((c) => c.id);
  expect(texts.length === 2 && texts.every((id) => clip(s, id).trackId !== main.id), 'text goes on tracks above Main');
  await click(`.clip[data-clip="${texts[0]}"]`);
  await click(`.clip[data-clip="${texts[1]}"]`, { modifiers: ['Shift'] });
  await press('Control+g');
  s = await state();
  const g = clip(s, texts[0]).groupId;
  expect(!!g && clip(s, texts[1]).groupId === g, 'Ctrl+G groups the selected clips');
  expect((await win.locator('.clip.is-grouped').count()) === 2 && (await win.locator('.clip__badge--group').count()) === 2, 'grouped clips show a shared outline and badge');
  await press('Escape');
  await click(`.clip[data-clip="${texts[0]}"]`);
  expect((await state()).selection.length === 2, 'clicking one grouped clip selects the whole group');
  await click(`.clip[data-clip="${texts[0]}"]`, { modifiers: ['Alt'] });
  expect((await state()).selection.join() === texts[0], 'Alt+click selects a single member');
  await click(`.clip[data-clip="${texts[0]}"]`);
  const t0 = clip(await state(), texts[1]).start;
  let tb = await clipBox(texts[0]);
  await drag({ x: tb.cx, y: tb.cy }, { x: tb.cx + 2 * PPS, y: tb.cy });
  s = await state();
  expect(near(clip(s, texts[1]).start, t0 + 2) && near(clip(s, texts[0]).start, t0 + 2), 'dragging one grouped clip moves the group');
  await press('Alt+ArrowRight');
  s = await state();
  expect(near(clip(s, texts[1]).start, t0 + 2 + 1 / 30, 0.004), 'Alt+→ nudges the whole group by a frame');
  await press('Control+c');
  await press('End');
  await press('Control+v');
  s = await state();
  const copies = s.clips.filter((c) => c.type === 'text' && !texts.includes(c.id));
  expect(copies.length === 2 && copies[0].groupId && copies[0].groupId === copies[1].groupId && copies[0].groupId !== g, 'pasted copies form a group of their own');
  await press('Delete');
  expect((await state()).clips.filter((c) => c.type === 'text').length === 2, 'Delete removes the whole selected group');
  await click(`.clip[data-clip="${texts[0]}"]`);
  await press('Control+Shift+g');
  s = await state();
  expect(!clip(s, texts[0]).groupId && !clip(s, texts[1]).groupId, 'Ctrl+Shift+G ungroups');
  await press('Control+z');
  expect(!!clip(await state(), texts[0]).groupId, 'undo regroups');

  // ---- Linked video + audio -----------------------------------------------------------------------
  await click(`.clip[data-clip="${A}"]`, { modifiers: ['Alt'] });
  await win.locator(`.clip[data-clip="${A}"]`).click({ button: 'right' });
  await sleep(200);
  await win.locator('.menu__item', { hasText: 'Detach audio' }).click();
  await sleep(300);
  s = await state();
  const audio = s.clips.find((c) => c.type === 'audio' && c.linkId);
  expect(!!audio && audio.linkId === clip(s, A).linkId, 'detaching audio creates a linked audio clip');
  expect((await win.locator('.clip__badge--link').count()) === 2, 'linked clips carry a link badge');
  await press('Escape');
  await click(`.clip[data-clip="${audio.id}"]`);
  expect((await state()).selection.sort().join() === [A, audio.id].sort().join(), 'clicking the audio selects its linked video too');
  // Trim A (on Main) — the audio trims in sync.
  a = await clipBox(A);
  await drag({ x: a.right - 3, y: a.cy }, { x: a.right - 3 - PPS, y: a.cy });
  s = await state();
  expect(near(clip(s, A).duration, 6) && near(clip(s, audio.id).duration, 6) && near(clip(s, B).start, 6), 'trimming the video trims its linked audio in sync');
  // Move the audio: the video follows (Main reorders).
  // Split both at 3 s.
  const ruler = await box('.tl-ruler');
  a = await clipBox(A);
  await mouse.click(a.x + 3 * PPS, ruler.cy);
  await sleep(200);
  await click(`.clip[data-clip="${A}"]`);
  await press('s');
  s = await state();
  const rightV = onTrack(s, main.id).find((c) => near(c.start, 3));
  const rightA = s.clips.find((c) => c.type === 'audio' && near(c.start, 3));
  expect(!!rightV && !!rightA && rightV.linkId && rightV.linkId === rightA.linkId && rightV.linkId !== clip(s, A).linkId, 'S splits the video and its audio; the right halves are linked to each other');
  await click(`.clip[data-clip="${rightA.id}"]`);
  await press('Delete');
  s = await state();
  expect(!clip(s, rightV.id) && !clip(s, rightA.id) && near(clip(s, B).start, 3), 'deleting the audio half deletes its video half; Main closes up');
  await click(`.clip[data-clip="${A}"]`);
  await press('Control+Shift+l');
  s = await state();
  expect(!clip(s, A).linkId && !clip(s, audio.id).linkId, 'Ctrl+Shift+L unlinks');
  await press('Control+z');
  expect(!!clip(await state(), A).linkId, 'undo relinks');
  await shot('45-edit-groups-links');

  // ---- Track heights --------------------------------------------------------------------------------
  const before = (await clipBox(B)).height;
  const handle = await box(`[data-track-resize="${main.id}"]`);
  await drag({ x: handle.cx, y: handle.cy }, { x: handle.cx, y: handle.cy + 40 });
  s = await state();
  const h = s.tracks.find((t) => t.id === main.id).height;
  const after = (await clipBox(B)).height;
  expect(h >= 90 && h <= 100 && after > before + 30, `dragging the header edge resizes the track (${before}px → ${after}px clips)`);
  await win.locator(`[data-track-resize="${main.id}"]`).dblclick();
  await sleep(250);
  expect((await state()).tracks.find((t) => t.id === main.id).height === null, 'double-clicking the edge resets the height');
  await win.locator('.titlebar__menu button', { hasText: 'View' }).click();
  await sleep(150);
  await win.locator('.menu__item', { hasText: 'Large' }).click();
  await sleep(300);
  s = await state();
  expect(s.tracks.every((t) => t.height && t.height >= 70), 'View → Track size → Large enlarges every track');
  await shot('46-edit-large-tracks');

  // ---- History panel ------------------------------------------------------------------------------
  await click('[data-history-button]');
  await win.waitForSelector('.history');
  s = await state();
  const rows = win.locator('.history__row');
  expect((await rows.count()) === s.past + s.future + 1, `the History panel lists every step (${s.past} steps)`);
  const labels = await win.locator('.history__label').allInnerTexts();
  for (const want of ['Ripple trim', 'Roll edit', 'Slip', 'Slide', 'Group clips', 'Detach audio', 'Split', 'Resize track', 'Track size: Large']) expect(labels.includes(want), `History shows “${want}”`);
  expect((await win.locator(`.history__row.is-current[data-history-index="${s.past}"]`).count()) === 1, 'the current state is highlighted');
  await shot('47-edit-history');
  const total = s.past;
  const offStep = s.labels.indexOf('Magnetic main track off') + 1;
  await win.locator(`.history__row[data-history-index="${offStep}"]`).click();
  await sleep(300);
  s = await state();
  expect(offStep > 0 && s.past === offStep && s.future === total - offStep && s.magneticMain === false, `clicking an early step jumps back ${total - offStep} steps at once`);
  expect((await win.locator('.history__row.is-undone').count()) === total - offStep, 'later steps are shown as undone');
  await shot('48-edit-history-jumped');
  await win.locator(`.history__row[data-history-index="${total}"]`).click();
  await sleep(300);
  s = await state();
  expect(s.past === total && s.future === 0, 'clicking the last step redoes everything');
  await press('Control+h');
  expect((await win.locator('.history').count()) === 0, 'Ctrl+H closes the panel');

  // ---- Save → reopen keeps groups, links, heights and the magnetic flag ------------------------------
  await run(() => window.__kinora.useProjectStore.getState().update((p) => void (p.name = 'Editing Test'), { label: 'Rename project' }));
  await press('Control+s');
  await sleep(1200);
  const saved = path.join(outDir, 'Editing Test.kinora');
  expect(existsSync(saved), 'Ctrl+S writes the project');
  const snapshot = await state();
  await run(async (file) => {
    const k = window.__kinora;
    k.useUI.getState().set({ screen: 'home' });
    await k.projectIO.openProject(file);
  }, saved);
  await sleep(1500);
  s = await state();
  expect(s.magneticMain && s.clips.length === snapshot.clips.length, 'reopening keeps the clips and the magnetic flag');
  expect(clip(s, texts[0]).groupId && clip(s, texts[0]).groupId === clip(s, texts[1]).groupId, 'groups survive save → reopen');
  expect(clip(s, A).linkId && clip(s, A).linkId === clip(s, audio.id).linkId, 'links survive save → reopen');
  expect(s.tracks.every((t, i) => t.height === snapshot.tracks[i].height), 'track heights survive save → reopen');
  await shot('49-edit-reopened');

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
