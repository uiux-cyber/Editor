/**
 * Vision features end to end, through the real UI:
 *   fixtures (rendered by the app itself) → background removal (still + video, preview + export)
 *   → auto-reframe to 9:16 → scene detection + split + undo → colour match → motion tracking.
 * Exports are decoded again and their pixels inspected. Screenshots go to .e2e/vision-*.png.
 *
 * Person footage: no real-person sample ships with the app or its dependencies, so the
 * illustrated character from lottie-web's test footage (an installed package) is used; it is
 * clearly person-shaped but cartoon-like, so the segmentation assertions are deliberately
 * coarse (character region vs. background region), see the report.
 *
 *   npm run build && node scripts/e2e.mjs vision           (VISION_STAGES=cutout,track to subset)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

const STAGES = (process.env.VISION_STAGES ?? 'cutout,reframe,scenes,color,track,cancel').split(',');
const PERSON = path.join(process.cwd(), 'node_modules', 'lottie-web', 'test', 'animations', 'footage', 'images', 'img_1.jpg');

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const perf = {};

export default async function vision(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const mouse = win.mouse;
  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- helpers ------------------------------------------------------------------------------
  const exportTo = async (name, overrides = {}) => {
    const file = path.join(outDir, name);
    const r = await run(
      async ({ file, overrides }) => {
        const k = window.__kinora;
        const project = k.useProjectStore.getState().project;
        const settings = { container: 'mp4', videoCodec: 'avc', width: project.settings.width, height: project.settings.height, fps: project.settings.fps, quality: 'high', audio: false, start: 0, end: k.engine.duration, hardware: 'no-preference', fastStart: false, ...overrides };
        let last = null;
        k.engine.setSuspended(true);
        try {
          const res = await k.exporter.exportProject(project, settings, file, (p) => (last = p), new AbortController().signal);
          return { ok: true, ...res, speed: last?.speed ?? 0 };
        } catch (err) {
          return { ok: false, error: String(err?.stack ?? err) };
        } finally {
          k.engine.setSuspended(false);
        }
      },
      { file, overrides },
    );
    if (!r.ok) throw new Error(`export ${name} failed: ${r.error}`);
    console.log(`  exported ${name}: ${r.frames} frames in ${r.seconds.toFixed(1)}s (${(r.frames / r.seconds).toFixed(1)} fps)`);
    return { file, ...r };
  };

  const newProject = (name, opts = {}) =>
    run(
      async ({ name, opts }) => {
        const k = window.__kinora;
        k.useProjectStore.getState().markSaved(null);
        await k.projectIO.newProject({ name, width: 1280, height: 720, fps: 30, ...opts });
      },
      { name, opts },
    ).then(() => win.waitForSelector('.timeline'));

  const importFiles = (files) =>
    run(async (files) => {
      const k = window.__kinora;
      const res = await k.assets.importMediaFiles(await window.kinora.fs.stat(files));
      return res.assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name, duration: a.duration, width: a.width, height: a.height, fps: a.fps }));
    }, files);

  /** Pixels of an exported file (PNG directly, video through the vision worker's decoder). */
  const samplePixels = (file, kind, time, points) =>
    run(
      async ({ file, kind, time, points }) => {
        const url = window.kinora.media.toUrl(file);
        let bmp;
        if (kind === 'png') bmp = await createImageBitmap(await (await fetch(url)).blob());
        else {
          const [blob] = await window.__kinoraVision.client.visionRequest({ type: 'thumbs', media: { url, kind: 'video' }, times: [time], width: 640 });
          bmp = await createImageBitmap(blob);
        }
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        const px = (x, y, r = 3) => {
          const d = g.getImageData(Math.max(0, Math.round(x * c.width) - r), Math.max(0, Math.round(y * c.height) - r), r * 2 + 1, r * 2 + 1).data;
          const s = [0, 0, 0];
          for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += d[i + k];
          return s.map((v) => Math.round(v / (d.length / 4)));
        };
        return { w: c.width, h: c.height, colors: points.map(([x, y]) => px(x, y)) };
      },
      { file, kind, time, points },
    );

  /** Snapshot of the preview canvas, sampled at normalised points. */
  const samplePreview = (points) =>
    run(async (points) => {
      const blob = await window.__kinora.engine.snapshot();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      return points.map(([x, y]) => Array.from(g.getImageData(Math.round(x * (c.width - 1)), Math.round(y * (c.height - 1)), 1, 1).data.slice(0, 3)));
    }, points);

  const state = () =>
    run(() => {
      const k = window.__kinora;
      const p = k.useProjectStore.getState().project;
      return { clips: Object.values(p.clips), settings: p.settings, past: k.useProjectStore.getState().past.length, selection: k.useUI.getState().selection, name: p.name };
    });

  const openTab = async (name) => {
    await win.click(`.rail__btn[data-tab="${name}"]`);
    await sleep(400);
  };
  const openTool = async (id) => {
    await openTab('tools');
    const card = win.locator(`.tool-card[data-tool="${id}"]`);
    if (!(await card.evaluate((el) => el.classList.contains('is-open')))) await card.locator('.tool-card__head').click();
    await sleep(300);
    return card;
  };
  const openSection = async (id) => {
    const sec = win.locator(`[data-section="${id}"]`);
    await sec.waitFor({ timeout: 5000 });
    if (!(await sec.evaluate((el) => el.classList.contains('is-open')))) await sec.locator('.section__head').click();
    await sleep(250);
    return sec;
  };
  const inspectorTab = async (label) => {
    await win.locator('.tabs__tab', { hasText: label }).click();
    await sleep(300);
  };
  const waitJobs = async (timeout = 120000) => {
    const t0 = Date.now();
    await sleep(150);
    while (Date.now() - t0 < timeout) {
      const n = await run(() => Object.keys(window.__kinoraVision.useVision.getState().jobs).length);
      if (n === 0) return (Date.now() - t0) / 1000;
      await sleep(200);
    }
    throw new Error('vision job did not finish in time');
  };
  const select = (ids) => run((ids) => window.__kinora.useUI.getState().select(ids), ids);
  const seek = (t) => run((t) => window.__kinora.engine.seek(t), t);
  /** Client coordinates of a design point on the preview. */
  const stagePoint = async (x, y) => {
    const b = await win.locator('.stage__overlay').boundingBox();
    const { cw } = await run(() => {
      const s = window.__kinora.useProjectStore.getState().project.settings;
      const ds = Math.min(s.width, s.height) / 1080;
      return { cw: s.width / ds };
    });
    const k = b.width / cw;
    return { x: b.x + b.width / 2 + x * k, y: b.y + b.height / 2 + y * k };
  };
  const brightness = (c) => (c[0] + c[1] + c[2]) / 3;
  const fmt = (arr) => `[${arr.map((v) => v.toFixed(2)).join(', ')}]`;
  /**
   * Share of pixels showing a key colour ('green' #00ff00 / 'yellow' #ffcc00) in each region of
   * the preview, an exported PNG, or a frame of an exported video.
   */
  const keyed = (source, file, time, rects, key) =>
    run(
      async ({ source, file, time, rects, key }) => {
        let bmp;
        if (source === 'preview') bmp = await createImageBitmap(await window.__kinora.engine.snapshot());
        else {
          const url = window.kinora.media.toUrl(file);
          if (source === 'png') bmp = await createImageBitmap(await (await fetch(url)).blob());
          else {
            const [blob] = await window.__kinoraVision.client.visionRequest({ type: 'thumbs', media: { url, kind: 'video' }, times: [time], width: 640 });
            bmp = await createImageBitmap(blob);
          }
        }
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        const isKey = key === 'green' ? (r, gg, b) => gg > 170 && r < 100 && b < 100 : (r, gg, b) => r > 190 && gg > 150 && gg < 235 && b < 90;
        return rects.map(([x0, y0, x1, y1]) => {
          const X0 = Math.floor(x0 * c.width);
          const Y0 = Math.floor(y0 * c.height);
          const w = Math.max(1, Math.floor((x1 - x0) * c.width));
          const h = Math.max(1, Math.floor((y1 - y0) * c.height));
          const d = g.getImageData(X0, Y0, w, h).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (isKey(d[i], d[i + 1], d[i + 2])) n++;
          return n / (d.length / 4);
        });
      },
      { source, file, time, rects, key },
    );
  const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

  // ---- Fixtures --------------------------------------------------------------------------------
  // Disc path used by the tracking test (design px, linear keyframes).
  const DISC_X = [[0, -560], [2, 0], [4, 520]];
  const DISC_Y = [[0, 200], [2, -220], [4, 160]];
  const lin = (kf, t) => {
    if (t <= kf[0][0]) return kf[0][1];
    for (let i = 1; i < kf.length; i++) if (t <= kf[i][0]) return kf[i - 1][1] + ((kf[i][1] - kf[i - 1][1]) * (t - kf[i - 1][0])) / (kf[i][0] - kf[i - 1][0]);
    return kf[kf.length - 1][1];
  };

  const discFile = path.join(outDir, 'vision-disc.mp4');
  const scenesFile = path.join(outDir, 'vision-scenes.mp4');
  const personVideo = path.join(outDir, 'vision-person.mp4');
  expect(existsSync(PERSON), 'person sample (lottie-web test footage) is installed');

  await newProject('Vision fixtures', { background: '#1c2a40' });
  await run(
    async ({ DISC_X, DISC_Y }) => {
      const k = window.__kinora;
      const a = k.actions;
      const edit = (fn) => a.editClips(k.useUI.getState().selection, fn);
      // Static scenery so the background has texture.
      const scenery = [
        ['rect', -620, -300, 260, 160, '#2f6f8f'],
        ['triangle', 600, 280, 240, 220, '#7a8f3a'],
        ['hexagon', 640, -330, 200, 200, '#8f4a7a'],
        ['rect', -700, 330, 300, 120, '#a0743a'],
      ];
      for (const [kind, x, y, w, h, color] of scenery) {
        a.addShape(kind, { time: 0 });
        edit((c) => {
          c.duration = 4;
          c.transform.x = x;
          c.transform.y = y;
          c.shape.width = w;
          c.shape.height = h;
          c.shape.fill = { type: 'solid', color };
        });
      }
      const kfs = (pts) => pts.map(([t, v]) => ({ t, v, ease: 'linear' }));
      a.addShape('ellipse', { time: 0 });
      edit((c) => {
        c.duration = 4;
        c.shape.width = c.shape.height = 170;
        c.shape.fill = { type: 'solid', color: '#ff5a36' };
        c.keyframes = { x: kfs(DISC_X), y: kfs(DISC_Y) };
      });
      a.addShape('star', { time: 0 });
      edit((c) => {
        c.duration = 4;
        c.shape.width = c.shape.height = 110;
        c.shape.fill = { type: 'solid', color: '#ffe066' };
        c.keyframes = { x: kfs(DISC_X), y: kfs(DISC_Y) };
      });
      k.useUI.getState().clearSelection();
      k.engine.seek(1);
    },
    { DISC_X, DISC_Y },
  );
  await sleep(400);
  await exportTo('vision-disc.mp4', { end: 4 });

  await newProject('Vision scenes fixture');
  await run(async () => {
    const k = window.__kinora;
    const a = k.actions;
    const looks = ['aurora', 'checkerboard', 'sunburst'];
    looks.forEach((g, i) => {
      a.addGenerator(g, { time: i * 2 });
      a.editClips(k.useUI.getState().selection, (c) => {
        c.start = i * 2;
        c.duration = 2;
      });
    });
    // Continuous motion across the cuts (makes the within-shot differences realistic).
    a.addShape('star', { time: 0 });
    a.editClips(k.useUI.getState().selection, (c) => {
      c.duration = 6;
      c.keyframes = { x: [{ t: 0, v: -700, ease: 'linear' }, { t: 6, v: 700, ease: 'linear' }] };
    });
  });
  await exportTo('vision-scenes.mp4', { end: 6 });

  await newProject('Vision person fixture', { background: '#123048' });
  const [personAsset] = await importFiles([PERSON]);
  await run(async (assetId) => {
    const k = window.__kinora;
    const asset = k.useProjectStore.getState().project.assets[assetId];
    k.actions.addAsset(asset, { time: 0 });
    k.actions.editClips(k.useUI.getState().selection, (c) => {
      c.duration = 4;
      c.transform.scaleX = c.transform.scaleY = 0.62;
      // The character walks from the left third to the right third.
      c.keyframes = { x: [{ t: 0, v: -520, ease: 'linear' }, { t: 4, v: 520, ease: 'linear' }] };
    });
  }, personAsset.id);
  await exportTo('vision-person.mp4', { end: 4 });
  expect(existsSync(discFile) && existsSync(scenesFile) && existsSync(personVideo), 'fixtures rendered by the app (disc, scenes, person)');

  // =============================================================================================
  // Background removal
  // =============================================================================================
  if (STAGES.includes('cutout')) {
    console.log('\n[cutout]');
    // Pure green background under the still (coverage is measured as "how much green shows"),
    // a yellow layer under the video (the cut-out person must composite over lower layers).
    await newProject('Vision cutout', { background: '#00ff00' });
    const assets = await importFiles([PERSON, personVideo]);
    const still = assets.find((a) => a.kind === 'image');
    const video = assets.find((a) => a.kind === 'video');
    const ids = await run(
      async ({ stillId, videoId }) => {
        const k = window.__kinora;
        const a = k.actions;
        const p = () => k.useProjectStore.getState().project;
        a.addAsset(p().assets[stillId], { time: 0 });
        const img = k.useUI.getState().selection[0];
        a.editClips([img], (c) => void (c.duration = 4));
        a.addGenerator('solid', { time: 4, newTrack: true });
        const bg = k.useUI.getState().selection[0];
        a.editClips([bg], (c) => {
          c.start = 4;
          c.duration = 4;
          c.params = { colorA: '#ffcc00' };
        });
        a.addAsset(p().assets[videoId], { time: 4, newTrack: true });
        const vid = k.useUI.getState().selection[0];
        k.engine.seek(1.5);
        k.useUI.getState().select([img]);
        return { bg, img, vid };
      },
      { stillId: still.id, videoId: video.id },
    );
    await sleep(800);
    // Frame regions (x0, y0, x1, y1). The square photo spans x 0.22–0.78 of the 16:9 frame.
    const STILL = {
      backdrop: [[0.24, 0.0, 0.4, 0.06], [0.6, 0.0, 0.76, 0.06], [0.225, 0.86, 0.32, 0.99], [0.68, 0.86, 0.775, 0.99]],
      person: [[0.44, 0.82, 0.56, 0.98], [0.47, 0.72, 0.53, 0.79]],
    };
    const before = await keyed('preview', null, 0, STILL.backdrop.concat(STILL.person), 'green');

    // Turn it on from the inspector (Edit tab → Background removal).
    await inspectorTab('Image');
    const sec = await openSection('vision-cutout');
    await sec.locator('.toggle').first().click();
    const t0 = Date.now();
    await win.waitForFunction((id) => window.__kinoraVision.useVision.getState().cutout[id]?.state === 'ready', ids.img, { timeout: 60000 });
    perf.stillFirstMask = (Date.now() - t0) / 1000;
    await sleep(500);
    const after = await keyed('preview', null, 0, STILL.backdrop.concat(STILL.person), 'green');
    await shot('vision-01-cutout-still');
    const status = await run((id) => window.__kinoraVision.useVision.getState().cutout[id], ids.img);
    console.log(`  still: green share before=${fmt(before)} after=${fmt(after)} status=${JSON.stringify(status)}`);
    expect(await run((id) => window.__kinora.useProjectStore.getState().project.clips[id].cutout?.enabled === true, ids.img), 'the inspector toggle sets clip.cutout.enabled');
    const back = after.slice(0, 4);
    const body = after.slice(4);
    expect(before.every((v) => v < 0.02), 'without the cutout the photo covers the background');
    expect(back.every((v) => v > 0.9), `the photo backdrop is removed (green shows through: ${fmt(back)})`);
    // The sample is an illustration, which the people model only partly recognises: assert the
    // character keeps clearly more of itself than the backdrop does (coarse on purpose).
    const keptBody = 1 - body.reduce((s, v) => s + v, 0) / body.length;
    expect(keptBody > 0.3 && body.every((v) => v < 0.85), `the person (shirt, neck) is kept where the backdrop is removed (kept ${(keptBody * 100).toFixed(0)}% vs 0%)`);

    // Feather / choke sliders (one undo step each).
    const pastBefore = (await state()).past;
    const feather = sec.locator('.field', { hasText: 'Feather' }).locator('input.slider');
    const fb = await feather.boundingBox();
    await mouse.click(fb.x + fb.width * 0.6, fb.y + fb.height / 2);
    const choke = sec.locator('.field', { hasText: 'Choke' }).locator('input.slider');
    const cb = await choke.boundingBox();
    await mouse.click(cb.x + cb.width * 0.7, cb.y + cb.height / 2);
    await sleep(500);
    const cut = await run((id) => window.__kinora.useProjectStore.getState().project.clips[id].cutout, ids.img);
    expect(Math.abs(cut.feather - 0.6) < 0.06 && cut.choke > 0.3 && cut.choke < 0.5, `feather / choke sliders write the clip (${cut.feather.toFixed(2)}, ${cut.choke.toFixed(2)})`);
    expect((await state()).past === pastBefore + 2, 'each slider change is one undo step');
    const grown = await keyed('preview', null, 0, STILL.person, 'green');
    expect(grown.reduce((s, v) => s + v, 0) <= body.reduce((s, v) => s + v, 0) + 0.02, `positive choke grows the matte (${fmt(body)} → ${fmt(grown)})`);
    await shot('vision-01b-cutout-feather-choke');
    await run(() => document.activeElement?.blur()); // sliders keep keys to themselves
    await win.keyboard.press('Control+z');
    await sleep(200);
    expect(Math.abs(await run((id) => window.__kinora.useProjectStore.getState().project.clips[id].cutout.choke, ids.img)) < 1e-6, 'Ctrl+Z reverts the choke');

    // Still export: same matte in the file. (The paused preview switches to the export-grade
    // segmenter once its GPU warm-up has finished.)
    await win.waitForFunction(() => window.__kinoraVision.client.segmentationDelegate() !== 'warming', null, { timeout: 30000 });
    perf.gpuSegmenter = await run(() => window.__kinoraVision.client.segmentationDelegate());
    await sleep(800);
    const previewNow = await keyed('preview', null, 0, STILL.backdrop.concat(STILL.person), 'green');
    const png = await exportTo('vision-cutout-still.png', { container: 'png', start: 1.5, end: 1.5 });
    const pngK = await keyed('png', png.file, 0, STILL.backdrop.concat(STILL.person), 'green');
    console.log(`  png green share=${fmt(pngK)} preview=${fmt(previewNow)}`);
    expect(pngK.every((v, i) => Math.abs(v - previewNow[i]) < 0.06), 'exported PNG matches the paused preview');

    // Video over the yellow layer.
    const VIDEO = { backdrop: [[0.02, 0.03, 0.14, 0.15], [0.86, 0.03, 0.98, 0.15], [0.86, 0.85, 0.98, 0.97]], person: [[0.4, 0.66, 0.46, 0.76]] };
    await select([ids.vid]);
    await seek(5.5);
    await sleep(500);
    const vBefore = await keyed('preview', null, 0, VIDEO.backdrop, 'yellow');
    await inspectorTab('Video');
    const vsec = await openSection('vision-cutout');
    await vsec.locator('.toggle').first().click();
    await win.waitForFunction((id) => window.__kinoraVision.useVision.getState().cutout[id]?.state === 'ready', ids.vid, { timeout: 60000 });
    await sleep(800);
    const vPaused = await keyed('preview', null, 0, VIDEO.backdrop, 'yellow');
    await shot('vision-02-cutout-video-paused');
    console.log(`  video yellow share: before=${fmt(vBefore)} after=${fmt(vPaused)}`);
    expect(vBefore.every((v) => v < 0.02) && vPaused.every((v) => v > 0.9), 'the video background is removed and the yellow layer below shows (preview)');
    // Playback: measure the preview frame rate and the per-frame inference time.
    await seek(4);
    const f0 = await run(() => window.__kinora.engine.framesRendered);
    await run(() => window.__kinora.engine.play());
    await sleep(1500);
    await shot('vision-03-cutout-video-playing');
    await sleep(500);
    const f1 = await run(() => window.__kinora.engine.framesRendered);
    await run(() => window.__kinora.engine.pause());
    const vstat = await run((id) => window.__kinoraVision.useVision.getState().cutout[id], ids.vid);
    perf.previewFpsWithCutout = Math.round((f1 - f0) / 2);
    perf.segmentMs = +(vstat.ms ?? 0).toFixed(1);
    perf.segmentDelegate = vstat.delegate;
    console.log(`  playing ${perf.previewFpsWithCutout} fps, segmentation ${perf.segmentMs} ms (${vstat.delegate})`);
    expect(perf.previewFpsWithCutout >= 24, 'preview keeps real-time playback with the cutout on');

    const mp4 = await exportTo('vision-cutout-video.mp4', { start: 4, end: 6 });
    perf.exportFpsWithCutout = +(mp4.frames / mp4.seconds).toFixed(1);
    const vK = await keyed('video', mp4.file, 1.5, VIDEO.backdrop.concat(VIDEO.person), 'yellow');
    console.log(`  mp4 frame yellow share: ${fmt(vK)}`);
    expect(vK.slice(0, 3).every((v) => v > 0.9), 'exported video: background removed, the layer below shows');
    // Determinism: exporting the same range again, with every cached mask dropped, recomputes
    // the same mattes.
    await run(() => window.__kinoraVision.cutout.clearMaskCache());
    const mp4b = await exportTo('vision-cutout-video-2.mp4', { start: 4, end: 6 });
    const vK2 = await keyed('video', mp4b.file, 1.5, VIDEO.backdrop.concat(VIDEO.person), 'yellow');
    expect(vK.every((v, i) => Math.abs(v - vK2[i]) < 0.01), 'two exports of the cutout are identical');
    await vsec.locator('.toggle').first().click();
    expect(await run((id) => window.__kinora.useProjectStore.getState().project.clips[id].cutout?.enabled === false, ids.vid), 'the toggle turns the cutout off again');
    const plain = await exportTo('vision-plain-video.mp4', { start: 4, end: 6 });
    perf.exportFpsWithoutCutout = +(plain.frames / plain.seconds).toFixed(1);
    const pK = await keyed('video', plain.file, 1.5, VIDEO.backdrop, 'yellow');
    expect(pK.every((v) => v < 0.02), 'without the cutout the video background is back in the export');
  }

  // =============================================================================================
  // Auto-reframe
  // =============================================================================================
  if (STAGES.includes('reframe')) {
    console.log('\n[reframe]');
    await newProject('Walk');
    const [asset] = await importFiles([personVideo]);
    await run((id) => {
      const k = window.__kinora;
      k.actions.addAsset(k.useProjectStore.getState().project.assets[id], { time: 0 });
      k.useUI.getState().clearSelection();
      k.useProjectStore.getState().markSaved(null);
    }, asset.id);
    const card = await openTool('vision.reframe');
    await card.locator('.format-tile[data-aspect="9:16"]').click();
    await shot('vision-04-reframe-tool');
    const t0 = Date.now();
    await card.locator('[data-action="auto-reframe"]').click();
    await win.waitForFunction(() => window.__kinora.useProjectStore.getState().project.settings.height === 1280, null, { timeout: 120000 });
    perf.reframeSeconds = (Date.now() - t0) / 1000;
    await sleep(800);
    const s = await state();
    const v = s.clips.find((c) => c.type === 'video');
    console.log(`  reframed "${s.name}" ${s.settings.width}×${s.settings.height}; x keys: ${JSON.stringify(v.keyframes?.x?.map((k) => [k.t.toFixed(2), Math.round(k.v), k.ease]))}`);
    expect(s.settings.width === 720 && s.settings.height === 1280 && s.name === 'Walk (9:16)', 'a new 9:16 project opened');
    expect(await run(() => window.__kinora.useProjectStore.getState().filePath === null && window.__kinora.useProjectStore.getState().savedRef === null), 'the reframed copy is unsaved');
    const xs = v.keyframes?.x ?? [];
    const xAt = (t) => {
      if (!xs.length) return v.transform.x;
      if (t <= xs[0].t) return xs[0].v;
      for (let i = 1; i < xs.length; i++) if (t <= xs[i].t) return xs[i - 1].v + ((xs[i].v - xs[i - 1].v) * (t - xs[i - 1].t)) / (xs[i].t - xs[i - 1].t);
      return xs[xs.length - 1].v;
    };
    expect(xs.length >= 2 && xAt(0.5) - xAt(3.5) > 250, `the virtual camera follows the subject (layer x ${Math.round(xAt(0.5))} → ${Math.round(xAt(3.5))})`);
    const analysis = await run((id) => {
      const vis = window.__kinoraVision;
      const a = window.__kinora.useProjectStore.getState().project.assets[id];
      const tr = vis.reframe.focusTrack(a);
      return { sources: tr.sources, keys: tr.keys.length, ms: tr.ms, samples: tr.samples.length };
    }, asset.id);
    perf.reframeAnalysis = analysis;
    console.log(`  analysis: ${JSON.stringify(analysis)}`);
    expect((analysis.sources.face ?? 0) + (analysis.sources.object ?? 0) > 0.5, 'the subject was found by the face / object detectors in most samples');
    // Jitter: per-frame motion of the camera stays small.
    let maxStep = 0;
    for (let t = 1 / 30; t <= 4; t += 1 / 30) maxStep = Math.max(maxStep, Math.abs(xAt(t) - xAt(t - 1 / 30)));
    expect(maxStep < 40, `camera moves smoothly (max ${maxStep.toFixed(1)} design px per frame)`);
    await seek(2);
    await sleep(800);
    await shot('vision-05-reframed-9x16');
    // The subject is in frame in the export: the middle of the frame shows the character's photo.
    const png = await exportTo('vision-reframed.png', { container: 'png', start: 3.2, end: 3.2 });
    const px = await samplePixels(png.file, 'png', 0, [[0.5, 0.5]]);
    expect(brightness(px.colors[0]) > 120, `the subject is centred in the reframed export (${px.colors[0]})`);
  }

  // =============================================================================================
  // Scene detection
  // =============================================================================================
  if (STAGES.includes('scenes')) {
    console.log('\n[scenes]');
    await newProject('Vision scenes');
    const [asset] = await importFiles([scenesFile]);
    const clipId = await run((id) => {
      const k = window.__kinora;
      k.actions.addAsset(k.useProjectStore.getState().project.assets[id], { time: 0 });
      return k.useUI.getState().selection[0];
    }, asset.id);
    const card = await openTool('vision.scenes');
    const t0 = Date.now();
    await card.locator('[data-action="detect-scenes"]').click();
    await card.locator('.scene-list').waitFor({ timeout: 60000 });
    perf.scenesSeconds = (Date.now() - t0) / 1000;
    await sleep(900);
    const sc = await run((id) => {
      const st = window.__kinoraVision.useVision.getState().scenes[id];
      return { cuts: st.cuts.map((c) => +c.t.toFixed(3)), frames: st.stats.length, ms: st.ms, thumbs: Object.keys(st.thumbs).length };
    }, clipId);
    perf.scenes = { ...sc, fps: Math.round(sc.frames / (sc.ms / 1000)) };
    console.log(`  scenes: ${JSON.stringify(sc)}`);
    await shot('vision-06-scenes-list');
    expect(sc.cuts.length === 2 && Math.abs(sc.cuts[0] - 2) <= 1 / 30 + 1e-3 && Math.abs(sc.cuts[1] - 4) <= 1 / 30 + 1e-3, `cuts found at 2 s and 4 s (${sc.cuts})`);
    expect((await card.locator('.scene-row').count()) === 3 && sc.thumbs >= 3, 'the list shows 3 shots with thumbnails');
    const before = (await state()).past;
    await card.locator('[data-action="split-scenes"]').click();
    await sleep(400);
    let st = await state();
    const vids = st.clips.filter((c) => c.type === 'video').sort((a, b) => a.start - b.start);
    expect(vids.length === 3 && Math.abs(vids[1].start - 2) < 0.04 && Math.abs(vids[2].start - 4) < 0.04, `split into 3 clips at the cuts (${vids.map((c) => c.start.toFixed(2))})`);
    expect(st.past === before + 1, 'the split is a single undo step');
    await win.locator('.stage__overlay').click({ position: { x: 4, y: 4 } });
    await win.keyboard.press('Control+z');
    await sleep(300);
    st = await state();
    expect(st.clips.filter((c) => c.type === 'video').length === 1, 'Ctrl+Z restores the single clip');
    await win.keyboard.press('Control+Shift+z');
    await sleep(300);
    expect((await state()).clips.filter((c) => c.type === 'video').length === 3, 'Ctrl+Shift+Z redoes the split');
    await shot('vision-07-scenes-split');
  }

  // =============================================================================================
  // Colour match
  // =============================================================================================
  if (STAGES.includes('color')) {
    console.log('\n[color]');
    await newProject('Vision colour');
    const [asset] = await importFiles([PERSON]);
    const ids = await run((id) => {
      const k = window.__kinora;
      const a = k.actions;
      const asset = k.useProjectStore.getState().project.assets[id];
      a.addAsset(asset, { time: 0 });
      const ref = k.useUI.getState().selection[0];
      a.editClips([ref], (c) => {
        c.duration = 3;
        c.name = 'Reference look';
        c.adjust = { exposure: 0.35, temperature: 0.55, saturation: -0.35, contrast: 0.1 };
      });
      a.addAsset(asset);
      const target = k.useUI.getState().selection[0];
      a.editClips([target], (c) => {
        c.duration = 3;
        c.name = 'To correct';
      });
      k.engine.seek(4.5);
      return { ref, target };
    }, asset.id);
    await select([ids.target]);
    await sleep(300);
    await inspectorTab('Adjust');
    const sec = await openSection('vision-color');
    await sec.locator('select').selectOption(ids.ref);
    const pastBefore = (await state()).past;
    const t0 = Date.now();
    await sec.locator('[data-action="match-color"]').click();
    await sec.locator('[data-color-result]').waitFor({ timeout: 60000 });
    perf.colorMatchSeconds = (Date.now() - t0) / 1000;
    await sec.locator('[data-color-result]').scrollIntoViewIfNeeded();
    await sleep(500);
    await shot('vision-08-color-match');
    const res = await run((id) => {
      const k = window.__kinora;
      const st = window.__kinoraVision.useVision.getState().color[id];
      return { adjust: k.useProjectStore.getState().project.clips[id].adjust, before: st.distanceBefore, after: st.distanceAfter, ms: st.ms };
    }, ids.target);
    console.log(`  match: ${JSON.stringify(res)}`);
    expect(res.after < res.before * 0.35 && res.after < 0.6, `statistics now match the reference (distance ${res.before.toFixed(2)} → ${res.after.toFixed(2)})`);
    expect(res.adjust.temperature > 0.2 && res.adjust.saturation < -0.1, 'the result is warm and desaturated like the reference, written as editable Adjust values');
    expect((await state()).past === pastBefore + 1, 'applying the match is one undo step');
    // Rendered output: both clips now look alike.
    const pts = [[0.42, 0.22], [0.5, 0.62], [0.56, 0.48], [0.38, 0.7], [0.5, 0.9], [0.62, 0.3]];
    const a = await samplePixels((await exportTo('vision-color-ref.png', { container: 'png', start: 1.5, end: 1.5 })).file, 'png', 0, pts);
    const b = await samplePixels((await exportTo('vision-color-matched.png', { container: 'png', start: 4.5, end: 4.5 })).file, 'png', 0, pts);
    const meanDiff = a.colors.reduce((s, c, i) => s + Math.abs(c[0] - b.colors[i][0]) + Math.abs(c[1] - b.colors[i][1]) + Math.abs(c[2] - b.colors[i][2]), 0) / (pts.length * 3);
    console.log(`  rendered ref=${JSON.stringify(a.colors)} matched=${JSON.stringify(b.colors)} mean |Δ|=${meanDiff.toFixed(1)}`);
    expect(meanDiff < 18, `exported frames of the two clips match (mean channel difference ${meanDiff.toFixed(1)})`);
    // The Adjust tab shows the values (editable).
    expect(await win.locator('.inspector').getByText('Temperature').count() > 0, 'Adjust tab shows the matched values');
    await win.keyboard.press('Control+z');
    await sleep(300);
    expect(!(await run((id) => window.__kinora.useProjectStore.getState().project.clips[id].adjust?.temperature, ids.target)), 'Ctrl+Z removes the match');
  }

  // =============================================================================================
  // Motion tracking
  // =============================================================================================
  if (STAGES.includes('track')) {
    console.log('\n[track]');
    await newProject('Vision tracking');
    const [asset] = await importFiles([discFile]);
    const ids = await run((id) => {
      const k = window.__kinora;
      const a = k.actions;
      a.addAsset(k.useProjectStore.getState().project.assets[id], { time: 0 });
      const video = k.useUI.getState().selection[0];
      a.addShape('rect', { time: 0 });
      const follower = k.useUI.getState().selection[0];
      a.editClips([follower], (c) => {
        c.duration = 4;
        c.shape.width = 120;
        c.shape.height = 60;
        c.shape.radius = 8;
        c.shape.fill = { type: 'solid', color: '#ff00ff' };
        c.transform.x = 0;
        c.transform.y = -220;
      });
      k.engine.seek(1);
      return { video, follower };
    }, asset.id);
    await sleep(500);
    // The follower sits 180 px above the disc at t = 1 (disc at the design position below).
    const T0 = 1;
    const discAt = (t) => ({ x: lin(DISC_X, t), y: lin(DISC_Y, t) });
    await run(({ id, x, y }) => window.__kinora.actions.editClips([id], (c) => {
      c.transform.x = x;
      c.transform.y = y - 180;
    }), { id: ids.follower, ...discAt(T0) });
    await inspectorTab('Shape');
    const sec = await openSection('vision-track');
    await shot('vision-09-track-panel');
    await sec.locator('[data-action="draw-box"]').click();
    await win.locator('[data-vision-draw]').waitFor();
    const d0 = discAt(T0);
    const p0 = await stagePoint(d0.x - 95, d0.y - 95);
    const p1 = await stagePoint(d0.x + 95, d0.y + 95);
    await mouse.move(p0.x, p0.y);
    await mouse.down();
    await mouse.move((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, { steps: 4 });
    await mouse.move(p1.x, p1.y, { steps: 6 });
    await mouse.up();
    await sleep(300);
    const box = await run(() => window.__kinoraVision.useVision.getState().draw?.box);
    expect(box && Math.abs(box.cx - d0.x) < 6 && Math.abs(box.cy - d0.y) < 6 && Math.abs(box.w - 190) < 8, `the drawn box is around the disc (${JSON.stringify(box && Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])))})`);
    await shot('vision-10-track-box');
    const pastBefore = (await state()).past;
    const t0 = Date.now();
    await sec.locator('[data-action="track-motion"]').click();
    await sec.locator('[data-track-result]').waitFor({ timeout: 120000 });
    perf.trackSeconds = (Date.now() - t0) / 1000;
    await sleep(400);
    await shot('vision-11-track-path');
    const tr = await run((id) => {
      const k = window.__kinora;
      const c = k.useProjectStore.getState().project.clips[id];
      const st = window.__kinoraVision.useVision.getState().tracks[id];
      return { kx: c.keyframes?.x, ky: c.keyframes?.y, frames: st.frames, ms: st.ms, keys: st.keyframes, minConf: Math.min(...st.points.map((p) => p.conf)) };
    }, ids.follower);
    perf.track = { frames: tr.frames, seconds: +(tr.ms / 1000).toFixed(2), fps: Math.round(tr.frames / (tr.ms / 1000)), keyframes: tr.keys, minConf: +tr.minConf.toFixed(2) };
    console.log(`  track: ${JSON.stringify(perf.track)}`);
    expect((await state()).past === pastBefore + 1, 'writing the keyframes is one undo step');
    expect(tr.kx?.length >= 2 && tr.kx.length < tr.frames / 2, `sparse keyframes written (${tr.kx?.length} for ${tr.frames} frames)`);
    const evalKf = (kf, t) => {
      if (t <= kf[0].t) return kf[0].v;
      for (let i = 1; i < kf.length; i++) if (t <= kf[i].t) return kf[i - 1].v + ((kf[i].v - kf[i - 1].v) * (t - kf[i - 1].t)) / (kf[i].t - kf[i - 1].t);
      return kf[kf.length - 1].v;
    };
    let maxErr = 0;
    for (let t = 0.05; t <= 3.95; t += 0.1) {
      const d = discAt(t);
      const ex = evalKf(tr.kx, t) - d.x;
      const ey = evalKf(tr.ky, t) - (d.y - 180);
      maxErr = Math.max(maxErr, Math.hypot(ex, ey));
    }
    perf.track.maxErrorDesignPx = +maxErr.toFixed(1);
    expect(maxErr < 12, `the follower stays on the disc forward and backward from the playhead (max error ${maxErr.toFixed(1)} design px of 1920)`);
    expect(await win.locator('[data-vision-path]').count() === 1, 'the track path is drawn on the preview');
    // Export: the magenta follower sits above the disc at 3 s.
    const png = await exportTo('vision-track.png', { container: 'png', start: 3, end: 3 });
    const d3 = discAt(3);
    const at = [(d3.x + 960) / 1920, (d3.y - 180 + 540) / 1080];
    const px = await samplePixels(png.file, 'png', 0, [at]);
    expect(px.colors[0][0] > 180 && px.colors[0][1] < 90 && px.colors[0][2] > 180, `exported frame shows the follower above the disc at 3 s (${px.colors[0]})`);
    await win.keyboard.press('Control+z');
    await sleep(300);
    expect(!(await run((id) => window.__kinora.useProjectStore.getState().project.clips[id].keyframes?.x?.length, ids.follower)), 'Ctrl+Z removes the tracking keyframes');
  }

  // =============================================================================================
  // Cancel
  // =============================================================================================
  if (STAGES.includes('cancel')) {
    console.log('\n[cancel]');
    await newProject('Vision cancel');
    const [asset] = await importFiles([scenesFile]);
    const clipId = await run((id) => {
      const k = window.__kinora;
      k.actions.addAsset(k.useProjectStore.getState().project.assets[id], { time: 0 });
      // A fresh range so nothing is cached.
      k.actions.editClips(k.useUI.getState().selection, (c) => {
        c.trimIn = 0.5;
        c.duration = 5.4;
      });
      return k.useUI.getState().selection[0];
    }, asset.id);
    const card = await openTool('vision.scenes');
    await card.locator('[data-action="detect-scenes"]').click();
    await win.locator('[data-vision-hud] button').first().click({ timeout: 5000 });
    await sleep(500);
    const after = await run((id) => ({ jobs: Object.keys(window.__kinoraVision.useVision.getState().jobs).length, scenes: !!window.__kinoraVision.useVision.getState().scenes[id], toasts: window.__kinora.useUI.getState().toasts.filter((t) => t.kind === 'error').length }), clipId);
    expect(after.jobs === 0 && !after.scenes && after.toasts === 0, 'cancelling from the progress panel stops the job without an error');
  }

  console.log(`\nVision performance: ${JSON.stringify(perf, null, 1)}`);
  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
