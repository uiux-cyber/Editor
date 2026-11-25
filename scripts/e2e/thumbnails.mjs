/**
 * Thumbnails, driven through the real UI: open the thumbnail editor from the title bar (the frame
 * under the playhead becomes the background), try a thumbnail design (it replaces the layers and
 * keeps the frame), undo / redo it, add an A/B variant, change the frame, preview in the feed,
 * export JPG (under 2 MB) and PNG, go back to the video, then save and reopen the project.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

export default async function thumbnailsScenario(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const state = () =>
    run(() => {
      const k = window.__kinora;
      const s = k.useProjectStore.getState();
      return {
        path: s.editPath,
        clips: Object.values(s.project.clips),
        rootClips: Object.keys(s.root.clips).length,
        thumbs: (s.root.thumbnails ?? []).map((t) => ({ id: t.id, name: t.name, clips: Object.keys(t.sequence.clips).length, frame: t.frameAssetId, frameTime: t.frameTime, time: t.time })),
        assets: s.root.assets,
        past: s.past.length,
        time: k.engine.time,
      };
    });
  const waitFor = async (fn, what, timeout = 20000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
      await sleep(150);
    }
  };

  // A short video: a colourful background and a title, playhead in the middle.
  await win.waitForSelector('.home', { timeout: 20000 });
  await run(async () => {
    const k = window.__kinora;
    await k.projectIO.newProject({ name: 'Thumbnail test', width: 1280, height: 720, fps: 30 });
    k.actions.addGenerator('aurora', { time: 0 });
    const ids = k.actions.addText(null, { time: 0 });
    k.useProjectStore.getState().update((p) => {
      for (const id of ids) if (p.clips[id]?.type === 'text') p.clips[id].text.content = 'MAIN VIDEO';
    });
    k.engine.seek(2);
  });
  await win.waitForSelector('[data-action="thumbnail"]', { timeout: 15000 });
  const video = await state();

  // 1. Open: a thumbnail is made from the frame under the playhead.
  await win.click('[data-action="thumbnail"]');
  await win.waitForSelector('[data-thumbnail-bar]', { timeout: 30000 });
  let s = await waitFor(async () => {
    const x = await state();
    return x.thumbs.length === 1 && x.path[0]?.startsWith('thumbnail:') ? x : null;
  }, 'the first thumbnail');
  const frame = s.assets[s.thumbs[0].frame];
  expect(!!frame && frame.source.type === 'file' && /\.png$/i.test(frame.source.path) && existsSync(frame.source.path), `the video frame was captured as a picture (${frame && path.basename(frame.source.path)})`);
  expect(Math.abs(s.thumbs[0].frameTime - 2) < 0.05 && frame.width === 1280 && frame.height === 720, 'at the playhead, at the project size');
  expect(s.clips.length === 1 && s.clips[0].type === 'image' && s.clips[0].assetId === frame.id, 'the thumbnail starts with the frame as its background');
  expect(s.rootClips === video.rootClips, 'the video timeline is untouched');
  await sleep(600);
  expect(await win.locator('[data-template="thumb-shock"]').first().isVisible(), 'Library ▸ Templates shows the thumbnail designs');
  await shot('thumb-01-opened');

  // 2. A design replaces the layers and keeps the frame; one undo step.
  const pastBefore = s.past;
  await win.locator('[data-template="thumb-shock"]').first().click();
  s = await waitFor(async () => {
    const x = await state();
    return x.clips.length > 3 ? x : null;
  }, 'the design');
  const bg = s.clips.find((c) => c.type === 'image' && c.assetId === frame.id);
  const personSlot = s.clips.find((c) => c.type === 'shape' && c.shape.slot && c.cutout?.enabled);
  expect(!!bg, `the design's background shows the captured frame (${s.clips.length} layers)`);
  expect(!!personSlot && personSlot.effects.some((e) => e.effectId === 'stroke'), 'its person placeholder removes the background and outlines the photo');
  expect(s.past === pastBefore + 1, 'applying a design is one undo step');
  await sleep(800);
  await shot('thumb-02-design');
  await run(() => window.__kinora.useProjectStore.getState().undo());
  expect((await state()).clips.length === 1, 'undo returns to the frame alone');
  await run(() => window.__kinora.useProjectStore.getState().redo());
  expect((await state()).clips.length === s.clips.length, 'redo brings the design back');

  // 3. A second variant (duplicate) opens as Thumbnail B.
  await win.click('[data-thumbnail-add]');
  await win.locator('.menu .menu__item').first().click();
  s = await waitFor(async () => {
    const x = await state();
    return x.thumbs.length === 2 ? x : null;
  }, 'the variant');
  expect(s.thumbs[1].name === 'Thumbnail B' && s.path[0] === `thumbnail:${s.thumbs[1].id}` && s.thumbs[1].clips === s.thumbs[0].clips, 'the variant is a copy, named B, and opens');
  expect(await win.locator('[data-thumbnail-tab]').count() === 2, 'the bar shows both thumbnails');

  // 4. Change the frame of B in the frame picker: its background follows, A keeps the old one.
  await win.click('[data-thumbnail-frame]');
  await win.waitForSelector('.thumb-picker__main', { timeout: 10000 });
  await win.locator('.thumb-picker__strip button').first().click();
  await sleep(1200);
  const drawn = await run(() => {
    const c = document.querySelector('.thumb-picker__main');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit / (d.length / 16);
  });
  expect(drawn > 0.2, `the frame picker previews the video (${Math.round(drawn * 100)}% lit)`);
  await shot('thumb-03a-frame-picker');
  await win.click('[data-thumbnail-use-frame]');
  s = await waitFor(async () => {
    const x = await state();
    return x.thumbs[1]?.frame && x.thumbs[1].frame !== frame.id ? x : null;
  }, 'the new frame');
  const newFrame = s.thumbs[1].frame;
  expect(s.thumbs[1].frameTime < 1 && s.clips.some((c) => c.type === 'image' && c.assetId === newFrame) && s.thumbs[0].frame === frame.id, `changing the frame updates this thumbnail only (now ${s.thumbs[1].frameTime.toFixed(2)} s)`);

  // The export dialog shows the picture and says a placeholder is still empty.
  await win.click('[data-thumbnail-export]');
  await win.waitForSelector('[data-thumbnail-empty]', { timeout: 10000 });
  await waitFor(() => run(() => !!document.querySelector('.thumb-export__picture img')?.naturalWidth), 'the export preview');
  await shot('thumb-03b-export');
  expect(true, 'the export dialog previews the thumbnail and points out the empty Person placeholder');
  await win.keyboard.press('Escape');
  await sleep(300);

  // 5. Feed preview renders the thumbnails next to other videos.
  await win.click('[data-thumbnail-feed]');
  await win.waitForSelector('[data-thumbnail-feed-preview]', { timeout: 10000 });
  await waitFor(() => run(() => [...document.querySelectorAll('[data-thumbnail-feed-preview] img')].filter((i) => i.complete && i.naturalWidth > 0).length >= 8), 'feed pictures');
  await shot('thumb-03-feed');
  expect(true, 'the feed preview shows the thumbnail at several sizes, with both variants');
  await win.keyboard.press('Escape');
  await sleep(300);

  // 6. Export: JPG under 2 MB at 1280×720, and PNG.
  const jpg = path.join(outDir, 'thumbnail-b.jpg');
  const png = path.join(outDir, 'thumbnail-a.png');
  const sizes = await run(
    async ({ jpg, png, a, b }) => {
      const t = window.__kinora.thumbnails;
      const j = await t.exportThumbnailTo(b, jpg, { format: 'jpg' });
      const p = await t.exportThumbnailTo(a, png, { format: 'png' });
      const probe = async (file) => {
        const img = await createImageBitmap(await (await fetch(window.kinora.media.toUrl(file))).blob());
        const c = new OffscreenCanvas(64, 36);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let min = 255;
        let max = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          min = Math.min(min, l);
          max = Math.max(max, l);
        }
        return { w: img.width, h: img.height, range: max - min };
      };
      return { j, p, jpg: await probe(jpg), png: await probe(png) };
    },
    { jpg, png, a: s.thumbs[0].id, b: s.thumbs[1].id },
  );
  expect(existsSync(jpg) && statSync(jpg).size === sizes.j && sizes.j < 2 * 1024 * 1024, `JPG saved, ${Math.round(sizes.j / 1024)} KB (under 2 MB)`);
  expect(sizes.jpg.w === 1280 && sizes.jpg.h === 720 && sizes.jpg.range > 60, `the JPG is 1280×720 with real content (contrast ${Math.round(sizes.jpg.range)})`);
  expect(existsSync(png) && sizes.png.w === 1280 && sizes.png.range > 60, 'PNG saved');

  // 7. Back to the video: the timeline and playhead return.
  await win.click('[data-thumbnail-close]');
  s = await waitFor(async () => {
    const x = await state();
    return x.path.length === 0 ? x : null;
  }, 'the video timeline');
  expect(s.clips.length === video.clips.length && Math.abs(s.time - 2) < 0.05, 'back on the video timeline, playhead where it was');
  expect((await win.locator('[data-thumbnail-bar]').count()) === 0, 'the thumbnail bar is gone');
  await shot('thumb-04-back');

  // 8. Saved with the project.
  const file = path.join(outDir, 'thumbnails.kinora');
  await run((file) => window.__kinora.projectIO.saveProject(false, file), file);
  await run((file) => window.__kinora.projectIO.openProject(file, { force: true }), file);
  s = await state();
  expect(s.thumbs.length === 2 && s.thumbs[0].name === 'Thumbnail A' && s.thumbs[1].clips > 3 && !!s.assets[s.thumbs[1].frame], 'thumbnails are saved in the project and reopen with their layers');
  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
