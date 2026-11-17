/**
 * Colour grading & audio mixing, driven through the real UI:
 *  - colour wheels (drag pucks / luma bars, Shift fine, undo as one step),
 *  - curves (add + drag points per channel, drag-out removal),
 *  - LUTs (import .cube files written here through the main-process dialog, built-ins, rename,
 *    intensity, delete → graceful "missing" state),
 *  - scopes (toggle from the transport, every scope draws, throttled while playing),
 *  - EQ (preset, node drag, wheel for Q, add / remove) and compressor (preset, sliders, live GR),
 *  - per-track meters while playing (and track mute),
 * then exports and checks that the export matches the preview: pixel statistics of exported
 * frames (PNG + decoded MP4) against the preview frame, and audio levels changed by EQ /
 * compressor in the exported WAV (plus no gaps at the exporter's mix-window boundaries).
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

/** A 17³ 3D LUT: warm, slightly crushed look with a domain of 0..1. */
function warmCube(n = 17) {
  const rows = ['# Kinora e2e LUT', 'TITLE "E2E Warm"', `LUT_3D_SIZE ${n}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1', ''];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const R = r / (n - 1);
        const G = g / (n - 1);
        const B = b / (n - 1);
        rows.push(`${Math.min(1, R * 0.92 + 0.08).toFixed(6)} ${(G * 0.97).toFixed(6)} ${(B * 0.72).toFixed(6)}`);
      }
  return rows.join('\r\n') + '\r\n';
}

/** A 1D LUT that inverts the image. */
function invertCube(n = 1024) {
  const rows = ['LUT_1D_SIZE ' + n];
  for (let i = 0; i < n; i++) {
    const v = (1 - i / (n - 1)).toFixed(6);
    rows.push(`${v} ${v} ${v}`);
  }
  return rows.join('\n');
}

export default async function colorAudio(ctx) {
  const { app, win, shot, run, sleep, outDir } = ctx;
  const mouse = win.mouse;
  const center = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error('element not visible');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
  };
  const drag = async (from, to, { steps = 14, shift = false } = {}) => {
    await mouse.move(from.x, from.y);
    await mouse.down();
    if (shift) await win.keyboard.down('Shift');
    await mouse.move(from.x + (to.x > from.x ? 3 : -3), from.y + 1, { steps: 2 });
    await mouse.move(to.x, to.y, { steps });
    await sleep(60);
    await mouse.up();
    if (shift) await win.keyboard.up('Shift');
    await sleep(200);
  };
  const clipState = (id) => run((id) => JSON.parse(JSON.stringify(window.__kinora.useProjectStore.getState().project.clips[id])), id);
  const undoDepth = () => run(() => window.__kinora.useProjectStore.getState().past.length);
  const inspectorTab = async (name) => {
    await win.locator('.inspector .tabs__tab', { hasText: name }).click();
    await sleep(400);
  };
  const section = (id) => win.locator(`[data-section="${id}"]`);

  await win.waitForSelector('.home', { timeout: 20000 });

  // Helpers living in the page.
  await run(() => {
    window.__e2e = {
      /** Pixels of a canvas, copied through a read-optimised canvas (no readback warnings). */
      pixels(canvas) {
        const c = new OffscreenCanvas(canvas.width, canvas.height);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(canvas, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      },
      async imageStats(source) {
        const bmp = source instanceof Blob ? await createImageBitmap(source) : source;
        const w = bmp.width || bmp.videoWidth;
        const h = bmp.height || bmp.videoHeight;
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        const sum = [0, 0, 0];
        const hist = new Uint32Array(256);
        for (let i = 0; i < d.length; i += 4) {
          sum[0] += d[i];
          sum[1] += d[i + 1];
          sum[2] += d[i + 2];
          hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
        }
        const n = d.length / 4;
        const pct = (p) => {
          let acc = 0;
          for (let i = 0; i < 256; i++) {
            acc += hist[i];
            if (acc >= n * p) return i;
          }
          return 255;
        };
        return { w, h, mean: sum.map((s) => s / n), p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) };
      },
      async fileStats(file) {
        const r = await fetch(window.kinora.media.toUrl(file));
        return window.__e2e.imageStats(await r.blob());
      },
      async previewStats() {
        const blob = await window.__kinora.engine.snapshot();
        return window.__e2e.imageStats(blob);
      },
      async videoFrameStats(file, time) {
        const v = document.createElement('video');
        v.muted = true;
        v.crossOrigin = 'anonymous';
        v.src = window.kinora.media.toUrl(file);
        await new Promise((res, rej) => {
          v.onloadeddata = res;
          v.onerror = () => rej(new Error('video failed to load'));
        });
        v.currentTime = time;
        await new Promise((res) => (v.onseeked = res));
        await new Promise((res) => setTimeout(res, 100));
        return window.__e2e.imageStats(v);
      },
      async wavStats(file, windows) {
        const r = await fetch(window.kinora.media.toUrl(file));
        const ac = new OfflineAudioContext(2, 48000, 48000);
        const buf = await ac.decodeAudioData(await r.arrayBuffer());
        const ch = [buf.getChannelData(0), buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0)];
        const sr = buf.sampleRate;
        const band = (x, lo, hi) => {
          // Energy of a band via a pair of one-pole filters (cheap and good enough for ratios).
          const a1 = Math.exp((-2 * Math.PI * hi) / sr);
          const a2 = Math.exp((-2 * Math.PI * lo) / sr);
          let lp1 = 0;
          let lp2 = 0;
          let e = 0;
          for (let i = 0; i < x.length; i++) {
            lp1 = (1 - a1) * x[i] + a1 * lp1;
            lp2 = (1 - a2) * x[i] + a2 * lp2;
            const v = lp1 - lp2;
            e += v * v;
          }
          return 10 * Math.log10(e / x.length + 1e-20);
        };
        const stats = (from, to) => {
          const a = Math.floor(from * sr);
          const b = Math.min(ch[0].length, Math.floor(to * sr));
          let peak = 0;
          let e = 0;
          for (let c = 0; c < 2; c++)
            for (let i = a; i < b; i++) {
              const v = Math.abs(ch[c][i]);
              if (v > peak) peak = v;
              e += v * v;
            }
          const rms = Math.sqrt(e / Math.max(1, 2 * (b - a)));
          const mono = ch[0].subarray(a, b);
          return { peakDb: 20 * Math.log10(peak + 1e-12), rmsDb: 20 * Math.log10(rms + 1e-12), lowDb: band(mono, 30, 160), highDb: band(mono, 3000, 12000) };
        };
        // Short-window RMS around given times (to look for gaps).
        const gaps = (windows ?? []).map((t) => {
          const frame = Math.round(0.004 * sr);
          let min = Infinity;
          let avg = 0;
          let count = 0;
          for (let s = Math.floor((t - 0.05) * sr); s < (t + 0.05) * sr; s += frame) {
            let e = 0;
            for (let i = s; i < s + frame; i++) e += ch[0][i] * ch[0][i] + ch[1][i] * ch[1][i];
            const rms = Math.sqrt(e / (2 * frame));
            min = Math.min(min, rms);
            avg += rms;
            count++;
          }
          return { t, minDb: 20 * Math.log10(min + 1e-12), avgDb: 20 * Math.log10(avg / count + 1e-12) };
        });
        return { duration: buf.duration, all: stats(0.2, buf.duration - 0.2), gaps };
      },
      async exportTo(file, overrides) {
        const k = window.__kinora;
        const project = k.useProjectStore.getState().project;
        const settings = {
          container: 'mp4',
          videoCodec: 'avc',
          width: project.settings.width,
          height: project.settings.height,
          fps: project.settings.fps,
          quality: 'high',
          audio: true,
          start: 0,
          end: k.engine.duration,
          hardware: 'no-preference',
          fastStart: false,
          ...overrides,
        };
        k.engine.setSuspended(true);
        try {
          await k.exporter.exportProject(project, settings, file, () => {}, new AbortController().signal);
        } finally {
          k.engine.setSuspended(false);
        }
        await window.kinora.fs.stat([file]);
        return file;
      },
    };
  });

  // ---- Fixtures: a colour chart image and a music bed --------------------------------------
  const chartFile = path.join(outDir, 'ca-chart.png');
  await run(async (file) => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const g = c.getContext('2d');
    const ramp = g.createLinearGradient(0, 0, 1280, 0);
    ramp.addColorStop(0, '#000');
    ramp.addColorStop(1, '#fff');
    g.fillStyle = ramp;
    g.fillRect(0, 0, 1280, 200);
    const hue = g.createLinearGradient(0, 0, 1280, 0);
    for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, `hsl(${i * 60}, 75%, 50%)`);
    g.fillStyle = hue;
    g.fillRect(0, 200, 1280, 180);
    const patches = ['#2b2b2b', '#5a5a5a', '#8a8a8a', '#bdbdbd', '#c58c6c', '#e2b49a', '#4f7d3a', '#5d8fc9'];
    patches.forEach((p, i) => {
      g.fillStyle = p;
      g.fillRect(i * 160, 380, 160, 200);
    });
    const sky = g.createLinearGradient(0, 580, 0, 720);
    sky.addColorStop(0, '#87b5e6');
    sky.addColorStop(1, '#f0c49a');
    g.fillStyle = sky;
    g.fillRect(0, 580, 1280, 140);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await window.kinora.fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));
  }, chartFile);
  expect(existsSync(chartFile), 'chart fixture written');

  const ids = await run(async (file) => {
    const k = window.__kinora;
    await k.projectIO.newProject({ name: 'Color Audio', width: 1280, height: 720, fps: 30 });
    const res = await k.assets.importMediaFiles(await window.kinora.fs.stat([file]));
    const asset = res.assets[0];
    k.actions.addAsset(asset, { time: 0 });
    const image = k.useUI.getState().selection[0];
    const [music] = await k.actions.addSound('music-upbeat-pop', { time: 0 });
    k.useProjectStore.getState().update((p) => {
      p.clips[image].duration = 6;
      p.clips[music].duration = 6;
    });
    k.useProjectStore.getState().markSaved(null);
    k.engine.seek(1);
    return { image, music };
  }, chartFile);
  await win.waitForSelector('.timeline');
  await sleep(600);
  const ungraded = await run(() => window.__e2e.previewStats());

  // ---- Colour wheels ---------------------------------------------------------------------
  await win.locator(`.clip[data-clip="${ids.image}"]`).click({ position: { x: 30, y: 20 } });
  await inspectorTab('Adjust');
  const wheelsSec = section('color-wheels');
  await wheelsSec.scrollIntoViewIfNeeded();
  const gainDisc = await center(wheelsSec.locator('[data-wheel="gain"] .wheel__disc'));
  const r = gainDisc.box.width / 2;
  const before = await undoDepth();
  // Push the gain puck towards orange (up-left on the vectorscope layout), ~35 % of the radius.
  await drag({ x: gainDisc.x, y: gainDisc.y }, { x: gainDisc.x - r * 0.12, y: gainDisc.y - r * 0.33 });
  let clip = await clipState(ids.image);
  const gain = clip.adjust?.wheels?.gain;
  expect(gain && gain.amount > 0.25 && gain.amount < 0.45, `dragging the gain wheel pushes its puck (amount ${gain?.amount.toFixed(2)}, hue ${gain?.hue.toFixed(0)}°)`);
  expect(gain.hue < 60 || gain.hue > 330, 'the puck direction maps to a warm hue');
  expect((await undoDepth()) === before + 1, 'a wheel drag is one undo step');
  // Shift = fine: the same pointer distance moves the puck 5× less.
  const liftDisc = await center(wheelsSec.locator('[data-wheel="lift"] .wheel__disc'));
  await drag({ x: liftDisc.x, y: liftDisc.y }, { x: liftDisc.x + r * 0.5, y: liftDisc.y }, { shift: true });
  clip = await clipState(ids.image);
  expect(clip.adjust.wheels.lift.amount > 0.05 && clip.adjust.wheels.lift.amount < 0.15, `Shift-drag fine-adjusts the lift wheel (${clip.adjust.wheels.lift.amount.toFixed(3)})`);
  // Luma bar of the gamma wheel.
  const gammaBar = await center(wheelsSec.locator('[data-wheel="gamma"] .wheel__luma'));
  await drag({ x: gammaBar.x, y: gammaBar.y }, { x: gammaBar.x + gammaBar.box.width * 0.15, y: gammaBar.y });
  clip = await clipState(ids.image);
  expect(clip.adjust.wheels.gamma.luma > 0.15, `dragging the gamma luma bar brightens the mids (${clip.adjust.wheels.gamma.luma.toFixed(2)})`);
  // Double-click resets the lift wheel's colour.
  await wheelsSec.locator('[data-wheel="lift"] .wheel__disc').dblclick();
  await sleep(200);
  clip = await clipState(ids.image);
  expect(clip.adjust.wheels.lift.amount === 0, 'double-clicking a wheel re-centres it');
  await win.keyboard.press('Control+z');
  await sleep(200);
  expect((await clipState(ids.image)).adjust.wheels.lift.amount > 0.05, 'Ctrl+Z restores it');
  await win.keyboard.press('Control+Shift+z');
  await sleep(200);
  await shot('ca-01-wheels');

  // ---- Curves ----------------------------------------------------------------------------
  const curvesSec = section('color-curves');
  const svg = curvesSec.locator('[data-curve-editor]');
  await svg.scrollIntoViewIfNeeded();
  await sleep(200);
  let g = (await center(svg)).box;
  const at = (x, y) => ({ x: g.x + x * g.width, y: g.y + (1 - y) * g.height });
  // Master: lift the quarter-tones.
  await drag(at(0.25, 0.25), at(0.25, 0.36));
  clip = await clipState(ids.image);
  let master = clip.adjust?.curves?.master;
  expect(master && master.length === 3 && master[1][1] > master[1][0] + 0.07, `clicking + dragging the master curve adds a raised point (${JSON.stringify(master?.[1].map((v) => +v.toFixed(3)))})`);
  // Drag that point again (hit test on the existing point, not a new one).
  await drag(at(master[1][0], master[1][1]), at(0.3, 0.4));
  master = (await clipState(ids.image)).adjust.curves.master;
  expect(master.length === 3 && Math.abs(master[1][0] - 0.3) < 0.03, 'dragging an existing point moves it');
  // Red channel: pull the highlights down a little.
  await curvesSec.locator('[data-channel="r"]').click();
  await sleep(150);
  g = (await center(svg)).box;
  await drag(at(0.75, 0.75), at(0.75, 0.68));
  clip = await clipState(ids.image);
  expect(clip.adjust.curves.r.length === 3 && clip.adjust.curves.r[1][1] < 0.72, 'the red curve takes its own point');
  // Add a temporary point on blue and drag it out of the graph to delete it.
  await curvesSec.locator('[data-channel="b"]').click();
  await sleep(150);
  await drag(at(0.5, 0.5), at(0.5, 0.55));
  expect((await clipState(ids.image)).adjust.curves.b.length === 3, 'a blue point was added');
  await drag(at(0.5, 0.55), { x: g.x + g.width * 0.5, y: g.y + g.height * 1.4 });
  expect((await clipState(ids.image)).adjust.curves?.b?.length !== 3, 'dragging a point out of the graph removes it');
  await curvesSec.locator('[data-channel="r"]').click();
  await sleep(500);
  await shot('ca-02-curves');
  const histDrawn = await run(() => {
    const c = document.querySelector('.curves__hist');
    const d = window.__e2e.pixels(c);
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(histDrawn > 100, 'the curves editor draws the frame histogram behind the curve');

  // ---- LUTs ------------------------------------------------------------------------------
  const lutWarm = path.join(outDir, 'ca-warm.cube');
  const lutInvert = path.join(outDir, 'ca-invert.cube');
  const lutBad = path.join(outDir, 'ca-broken.cube');
  writeFileSync(lutWarm, warmCube());
  writeFileSync(lutInvert, invertCube());
  writeFileSync(lutBad, 'TITLE "Broken"\nLUT_3D_SIZE 4\n0 0 0\n1 1 1\n');
  // Answer the main process' open dialog with our files.
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, [lutWarm, lutInvert, lutBad]);
  const lutSec = section('color-lut');
  await lutSec.scrollIntoViewIfNeeded();
  const noLut = await run(() => window.__e2e.previewStats());
  await lutSec.locator('[data-action="import-lut"]').click();
  await win.waitForSelector('.lut-tile[data-lut^="u_"]', { timeout: 10000 });
  await sleep(800);
  const lib = await run(() => window.kinora.call('x:luts:list'));
  expect(lib.length === 2, `two valid LUTs imported (${lib.map((l) => `${l.name} ${l.kind} ${l.size}`).join(', ')})`);
  expect(lib.some((l) => l.name === 'E2E Warm' && l.kind === '3d' && l.size === 17) && lib.some((l) => l.kind === '1d' && l.size === 1024), 'TITLE, kind and size are read from the files');
  const errorToast = await win.locator('.toast', { hasText: 'ca-broken.cube' }).count();
  expect(errorToast === 1, 'the malformed file is reported in an error toast');
  clip = await clipState(ids.image);
  const warmId = lib.find((l) => l.name === 'E2E Warm').id;
  const invertId = lib.find((l) => l.kind === '1d').id;
  expect(clip.lut?.id === warmId, 'the first imported LUT is applied to the selected clip');
  // 3D LUT (trilinear): R' = 0.92 R + 0.08, G' = 0.97 G, B' = 0.72 B — linear, so the means follow.
  await sleep(500);
  const warm = await run(() => window.__e2e.previewStats());
  const warmErr = Math.max(Math.abs(warm.mean[0] - (noLut.mean[0] * 0.92 + 20.4)), Math.abs(warm.mean[1] - noLut.mean[1] * 0.97), Math.abs(warm.mean[2] - noLut.mean[2] * 0.72));
  expect(warmErr < 2.5, `the 3D LUT is applied with its exact values (max mean error ${warmErr.toFixed(2)} levels)`);
  // 1D LUT: inverts the picture.
  await lutSec.locator(`.lut-tile[data-lut="${invertId}"]`).click();
  await sleep(700);
  const inverted = await run(() => window.__e2e.previewStats());
  const invErr = Math.max(...[0, 1, 2].map((c) => Math.abs(inverted.mean[c] - (255 - noLut.mean[c]))));
  expect(invErr < 2.5, `the 1D LUT inverts the image (G mean ${noLut.mean[1].toFixed(1)} → ${inverted.mean[1].toFixed(1)}, error ${invErr.toFixed(2)})`);
  // Built-in look.
  await lutSec.locator('.lut-tile[data-lut="builtin:teal-orange"]').click();
  await sleep(600);
  expect((await clipState(ids.image)).lut.id === 'builtin:teal-orange', 'clicking a built-in look applies it');
  await shot('ca-03-lut-builtin');
  // Rename the warm LUT through its context menu.
  await lutSec.locator(`.lut-tile[data-lut="${warmId}"]`).click({ button: 'right' });
  await win.locator('.menu__item', { hasText: 'Rename' }).click();
  await win.locator('.lut-tile__rename').fill('Warm Print');
  await win.keyboard.press('Enter');
  await sleep(500);
  expect((await run(() => window.kinora.call('x:luts:list'))).some((l) => l.id === warmId && l.name === 'Warm Print'), 'renaming a LUT updates the library');
  await lutSec.locator(`.lut-tile[data-lut="${warmId}"]`).click();
  await sleep(300);
  // Intensity slider at ~80 %.
  const intensity = lutSec.locator('.field', { hasText: 'Intensity' }).locator('input.slider');
  await intensity.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const ib = await intensity.boundingBox();
  await mouse.click(ib.x + ib.width * 0.8, ib.y + ib.height / 2);
  await sleep(300);
  clip = await clipState(ids.image);
  expect(clip.lut.id === warmId && clip.lut.intensity > 0.7 && clip.lut.intensity < 0.9, `LUT intensity slider (${clip.lut.intensity.toFixed(2)})`);
  await sleep(500);
  await shot('ca-04-lut');

  // ---- Preview = export (pixels) ------------------------------------------------------------
  await run(() => {
    window.__kinora.useUI.getState().clearSelection();
    window.__kinora.engine.seek(1);
  });
  await sleep(900);
  const preview = await run(() => window.__e2e.previewStats());
  const pngFile = await run((f) => window.__e2e.exportTo(f, { container: 'png', start: 1, end: 1 }), path.join(outDir, 'ca-frame.png'));
  const png = await run((f) => window.__e2e.fileStats(f), pngFile);
  const diff = (a, b) => Math.max(...[0, 1, 2].map((c) => Math.abs(a.mean[c] - b.mean[c])));
  console.log(`  preview ${preview.w}×${preview.h} mean ${preview.mean.map((v) => v.toFixed(1))} | png ${png.w}×${png.h} mean ${png.mean.map((v) => v.toFixed(1))} | ungraded ${ungraded.mean.map((v) => v.toFixed(1))}`);
  expect(diff(preview, ungraded) > 8, `the grade changes the picture (Δmean ${diff(preview, ungraded).toFixed(1)})`);
  expect(diff(preview, png) < 2 && Math.abs(preview.p50 - png.p50) <= 3 && Math.abs(preview.p90 - png.p90) <= 3, `exported PNG matches the preview (Δmean ${diff(preview, png).toFixed(2)}, p50 ${preview.p50}/${png.p50}, p90 ${preview.p90}/${png.p90})`);

  // ---- Scopes ----------------------------------------------------------------------------
  await win.locator('[data-action="toggle-scopes"]').click();
  await win.waitForSelector('.scopes');
  await sleep(900);
  const scopeInk = () =>
    run(() =>
      [...document.querySelectorAll('.scope')].map((el) => {
        const c = el.querySelector('canvas');
        const d = window.__e2e.pixels(c);
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
        return { kind: el.getAttribute('data-scope'), lit, w: c.width, h: c.height };
      }),
    );
  let ink = await scopeInk();
  expect(ink.length === 4 && ink.every((s) => s.lit > 200), `all four scopes draw the frame (${ink.map((s) => `${s.kind}:${s.lit}`).join(', ')})`);
  await shot('ca-05-scopes-quad');
  for (const mode of ['Wave', 'Parade', 'Vector', 'Histo']) {
    await win.locator('.scopes__head .segmented button', { hasText: mode }).click();
    await sleep(350);
    ink = await scopeInk();
    expect(ink.length === 1 && ink[0].lit > 200, `${mode} scope on its own (${ink[0]?.lit} lit px)`);
    if (mode === 'Vector') await shot('ca-06-vectorscope');
  }
  await win.locator('.scopes__head .segmented button', { hasText: '4-up' }).click();
  // Scopes follow edits: switching the LUT off changes the waveform.
  const seqBefore = await run(() => window.__kinoraColorAudio.frameTap.last.seq);
  await run((id) => window.__kinora.actions.editClips([id], (c) => (c.lut.intensity = 0.2)), ids.image);
  await sleep(600);
  expect((await run(() => window.__kinoraColorAudio.frameTap.last.seq)) > seqBefore, 'scopes refresh after an edit while paused');
  await run((id) => window.__kinora.actions.editClips([id], (c) => (c.lut.intensity = 0.8)), ids.image);

  // ---- Audio: EQ -------------------------------------------------------------------------
  await win.locator(`.clip[data-clip="${ids.music}"]`).click({ position: { x: 40, y: 20 } });
  await sleep(400);
  const eqSec = section('audio-eq');
  await eqSec.scrollIntoViewIfNeeded();
  await eqSec.locator('select').first().selectOption('bass-boost');
  await sleep(300);
  clip = await clipState(ids.music);
  expect(clip.eq?.length === 2 && clip.eq[0].type === 'lowshelf' && clip.eq[0].gain === 6, 'the Bass boost preset sets two bands');
  // Drag node 2 (a bell) up and to the right.
  const graph = (await center(eqSec.locator('[data-eq-graph]'))).box;
  const node2 = await center(eqSec.locator('[data-band="1"] circle').nth(1));
  await drag(node2, { x: node2.x + graph.width * 0.12, y: node2.y - graph.height * 0.15 });
  clip = await clipState(ids.music);
  expect(clip.eq[1].frequency > 500 && clip.eq[1].gain > 1, `dragging a node sets frequency and gain (${clip.eq[1].frequency} Hz, ${clip.eq[1].gain} dB)`);
  // Mouse wheel over the node narrows / widens it.
  const q0 = clip.eq[1].q;
  const node2b = await center(eqSec.locator('[data-band="1"] circle').nth(1));
  await mouse.move(node2b.x, node2b.y);
  await mouse.wheel(0, -100);
  await sleep(100);
  await mouse.wheel(0, -100);
  await sleep(250);
  clip = await clipState(ids.music);
  expect(clip.eq[1].q > q0 * 1.15, `the mouse wheel changes Q (${q0} → ${clip.eq[1].q})`);
  // Double-click empty graph space adds a band, double-click on its node removes it.
  await mouse.dblclick(graph.x + graph.width * 0.86, graph.y + graph.height * 0.3);
  await sleep(250);
  clip = await clipState(ids.music);
  expect(clip.eq.length === 3 && clip.eq[2].frequency > 5000 && clip.eq[2].gain > 3, `double-clicking the graph adds a bell (${clip.eq[2].frequency} Hz, ${clip.eq[2].gain} dB)`);
  await eqSec.locator('[data-band="2"] circle').nth(1).dblclick();
  await sleep(250);
  expect((await clipState(ids.music)).eq.length === 2, 'double-clicking a node removes its band');
  // The drawn response equals what Web Audio's BiquadFilterNode actually does.
  const respCheck = await run((id) => {
    const k = window.__kinora;
    const ca = window.__kinoraColorAudio;
    const bands = ca.eq.sanitizeEq(k.useProjectStore.getState().project.clips[id].eq);
    const freqs = new Float32Array([40, 90, 200, 450, 1000, 2500, 6000, 12000]);
    const ac = new OfflineAudioContext(1, 128, 48000);
    const total = new Float64Array(freqs.length);
    for (const b of bands) {
      const n = ac.createBiquadFilter();
      n.type = b.type;
      n.frequency.value = b.frequency;
      n.gain.value = b.gain;
      n.Q.value = ca.eq.nodeQ(b);
      const mag = new Float32Array(freqs.length);
      n.getFrequencyResponse(freqs, mag, new Float32Array(freqs.length));
      mag.forEach((m, i) => (total[i] += 20 * Math.log10(m)));
    }
    const mine = ca.eq.eqResponseDb(bands, freqs, 48000);
    return Math.max(...[...mine].map((v, i) => Math.abs(v - total[i])));
  }, ids.music);
  expect(respCheck < 0.05, `EQ graph matches BiquadFilterNode.getFrequencyResponse (max error ${respCheck.toFixed(4)} dB)`);
  await shot('ca-07-eq');

  // ---- Audio: compressor -----------------------------------------------------------------
  const compSec = section('audio-compressor');
  await compSec.scrollIntoViewIfNeeded();
  await compSec.locator('select').first().selectOption('podcast');
  await sleep(300);
  clip = await clipState(ids.music);
  expect(clip.compressor?.enabled && clip.compressor.ratio === 4 && clip.compressor.threshold === -24, 'the Podcast preset enables the compressor');
  const thr = compSec.locator('.field', { hasText: 'Threshold' }).locator('input.slider');
  await thr.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const tb = await thr.boundingBox();
  // Click well away from the thumb (−24 dB sits at 60 %).
  await mouse.click(tb.x + tb.width * 0.3, tb.y + tb.height / 2);
  await sleep(200);
  clip = await clipState(ids.music);
  expect(clip.compressor.threshold > -48 && clip.compressor.threshold < -36, `threshold slider (${clip.compressor.threshold} dB)`);
  // Auto make-up of the node is cancelled: a quiet tone passes at exactly the user's make-up.
  const makeupErr = await run(async (s) => {
    const ca = window.__kinoraColorAudio;
    const ac = new OfflineAudioContext(1, 48000, 48000);
    const osc = ac.createOscillator();
    osc.frequency.value = 440;
    const pre = ac.createGain();
    pre.gain.value = 0.003; // ≈ -50 dBFS, well below the knee
    const comp = ac.createDynamicsCompressor();
    const knee = ca.compressor.kneeFor(s.ratio);
    comp.threshold.value = s.threshold;
    comp.knee.value = knee;
    comp.ratio.value = s.ratio;
    comp.attack.value = s.attack;
    comp.release.value = s.release;
    const mk = ac.createGain();
    mk.gain.value = Math.pow(10, ca.compressor.makeupStageDb(s) / 20);
    osc.connect(pre).connect(comp).connect(mk).connect(ac.destination);
    osc.start();
    const out = (await ac.startRendering()).getChannelData(0);
    let peak = 0;
    for (let i = 24000; i < 48000; i++) peak = Math.max(peak, Math.abs(out[i]));
    return 20 * Math.log10(peak / 0.003) - s.makeup;
  }, clip.compressor);
  expect(Math.abs(makeupErr) < 0.5, `below threshold the compressor applies exactly the make-up (error ${makeupErr.toFixed(2)} dB)`);

  // ---- Play: track meters + live gain reduction ----------------------------------------------
  const meterCount = await win.locator('.track-meter').count();
  expect(meterCount === 1, 'the audio track header has a level meter (the image track has none)');
  await run(() => {
    window.__kinora.engine.seek(0.5);
    window.__kinora.engine.play();
  });
  let peakSeen = -120;
  let grSeen = 0;
  for (let i = 0; i < 12; i++) {
    await sleep(150);
    const m = await run(() => ({ peak: +document.querySelector('.track-meter').dataset.peak, gr: +document.querySelector('.comp__gr').dataset.gr }));
    peakSeen = Math.max(peakSeen, m.peak);
    grSeen = Math.max(grSeen, m.gr);
  }
  await shot('ca-08-playing-meters');
  const playingScopes = await run(() => document.querySelector('.scopes__foot span').textContent);
  expect(peakSeen > -30, `the track meter shows the playing music (peak ${peakSeen.toFixed(1)} dBFS)`);
  expect(grSeen > 1, `the compressor shows live gain reduction (${grSeen.toFixed(1)} dB)`);
  const hz = parseFloat(playingScopes.split('·')[1] ?? '0');
  expect(hz > 2 && hz <= 12, `scopes are throttled while playing (${playingScopes})`);
  // Mute the track: its meter falls silent.
  const audioHeader = win.locator('.tl-header--audio').first();
  await audioHeader.locator('button[title="Mute track"]').click();
  await sleep(1800);
  const muted = await run(() => ({ level: +document.querySelector('.track-meter').dataset.level, cls: document.querySelector('.track-meter').className }));
  // The meter falls with its release ballistics (26 dB/s); below −60 dBFS it reads empty.
  expect(muted.level < -60 && muted.cls.includes('is-muted'), `a muted track's meter drops to silence (${muted.level} dB)`);
  await audioHeader.locator('button[title="Unmute track"]').click();
  await sleep(300);
  await run(() => window.__kinora.engine.pause());

  // ---- Export audio: EQ / compressor change the levels, preview ≈ export ---------------------
  const wav = (name, ov = {}) => run((a) => window.__e2e.exportTo(a.f, { container: 'wav', ...a.ov }), { f: path.join(outDir, name), ov });
  const stats = (f, w) => run((a) => window.__e2e.wavStats(a.f, a.w), { f, w });
  const processed = await stats(await wav('ca-processed.wav'), [4.0]);
  const saved = await run((id) => JSON.parse(JSON.stringify(window.__kinora.useProjectStore.getState().project.clips[id])), ids.music);
  await run((id) => window.__kinora.actions.editClips([id], (c) => (delete c.eq, delete c.compressor)), ids.music);
  const dry = await stats(await wav('ca-dry.wav'), [4.0]);
  await run((id) => window.__kinora.actions.editClips([id], (c) => (c.eq = [{ type: 'lowshelf', frequency: 120, gain: 9, q: 0.7 }])), ids.music);
  const eqOnly = await stats(await wav('ca-bass.wav'));
  await run((id) => window.__kinora.actions.editClips([id], (c) => (delete c.eq, (c.compressor = { enabled: true, threshold: -30, ratio: 8, attack: 0.002, release: 0.1, makeup: 0 }))), ids.music);
  const compOnly = await stats(await wav('ca-comp.wav'), [4.0]);
  const fmt = (s) => `peak ${s.all.peakDb.toFixed(1)} rms ${s.all.rmsDb.toFixed(1)} low ${s.all.lowDb.toFixed(1)} high ${s.all.highDb.toFixed(1)}`;
  console.log(`  dry: ${fmt(dry)}\n  bass: ${fmt(eqOnly)}\n  comp: ${fmt(compOnly)}\n  processed: ${fmt(processed)}`);
  expect(eqOnly.all.lowDb - dry.all.lowDb > 5 && Math.abs(eqOnly.all.highDb - dry.all.highDb) < 1.5, `a +9 dB low shelf raises the lows in the export (+${(eqOnly.all.lowDb - dry.all.lowDb).toFixed(1)} dB lows, ${(eqOnly.all.highDb - dry.all.highDb).toFixed(1)} dB highs)`);
  const crest = (s) => s.all.peakDb - s.all.rmsDb;
  expect(crest(compOnly) < crest(dry) - 2 && compOnly.all.rmsDb < dry.all.rmsDb, `the compressor reduces level and crest factor in the export (crest ${crest(dry).toFixed(1)} → ${crest(compOnly).toFixed(1)} dB)`);
  for (const s of [compOnly, processed]) {
    const gap = s.gaps[0];
    expect(gap.minDb > gap.avgDb - 15, `no gap at the 4 s mix-window boundary with a compressor (min ${gap.minDb.toFixed(1)} vs avg ${gap.avgDb.toFixed(1)} dB)`);
  }
  // Same EQ + compressor settings as while playing: the live track meter agrees with the export.
  expect(Math.abs(processed.all.peakDb - peakSeen) < 3, `preview track meter peak matches the exported peak (${peakSeen.toFixed(1)} vs ${processed.all.peakDb.toFixed(1)} dBFS)`);
  await run((a) => window.__kinora.actions.editClips([a.id], (c) => ((c.eq = a.saved.eq), (c.compressor = a.saved.compressor))), { id: ids.music, saved });

  // ---- Full export (video + audio) and a decoded frame vs the preview ------------------------
  const mp4 = await run((f) => window.__e2e.exportTo(f, { container: 'mp4', end: 3 }), path.join(outDir, 'ca-export.mp4'));
  const decoded = await run((f) => window.__e2e.videoFrameStats(f, 1.0 + 1 / 60), mp4);
  await run(() => window.__kinora.engine.seek(1));
  await sleep(800);
  const preview2 = await run(() => window.__e2e.previewStats());
  expect(diff(preview2, decoded) < 4 && Math.abs(preview2.p50 - decoded.p50) <= 5, `decoded MP4 frame matches the preview (Δmean ${diff(preview2, decoded).toFixed(2)}, p50 ${preview2.p50}/${decoded.p50})`);

  // ---- Save / reopen keeps everything ---------------------------------------------------------
  await run(() => window.__kinora.useProjectStore.getState().update((p) => void (p.name = 'Color Audio')));
  await win.keyboard.press('Control+s');
  await sleep(1200);
  const projFile = path.join(outDir, 'Color Audio.kinora');
  expect(existsSync(projFile), 'project saved');
  await run(async (file) => {
    const k = window.__kinora;
    k.useUI.getState().set({ screen: 'home' });
    await k.projectIO.openProject(file);
  }, projFile);
  await sleep(1500);
  const reopened = await run((ids) => {
    const p = window.__kinora.useProjectStore.getState().project;
    const img = Object.values(p.clips).find((c) => c.type === 'image');
    const mus = Object.values(p.clips).find((c) => c.type === 'audio');
    return { wheels: !!img?.adjust?.wheels?.gain, curves: img?.adjust?.curves?.master?.length, lut: img?.lut?.id, eq: mus?.eq?.length, comp: mus?.compressor?.enabled, imgId: img?.id };
  }, ids);
  expect(reopened.wheels && reopened.curves === 3 && reopened.lut === warmId && reopened.eq === 2 && reopened.comp, `wheels, curves, LUT, EQ and compressor survive save / reopen (${JSON.stringify(reopened)})`);

  // ---- Deleting a LUT that is in use degrades gracefully ------------------------------------
  await win.locator(`.clip[data-clip="${reopened.imgId}"]`).click({ position: { x: 30, y: 20 } });
  await inspectorTab('Adjust');
  const lutSec2 = section('color-lut');
  await lutSec2.scrollIntoViewIfNeeded();
  await lutSec2.locator(`.lut-tile[data-lut="${warmId}"]`).click({ button: 'right' });
  await win.locator('.menu__item', { hasText: 'Delete' }).click();
  await win.locator('[data-action="confirm-delete-lut"]').click();
  await sleep(1000);
  expect((await win.locator('[data-lut-missing]').count()) === 1, 'the clip shows a "LUT not available" warning');
  await run(() => window.__kinora.engine.seek(1.5));
  await sleep(600);
  await shot('ca-09-lut-missing');
  const after = await run(() => window.__e2e.previewStats());
  expect(after.mean.every((v) => v > 5), 'the preview still renders the clip without the missing LUT');
  await lutSec2.locator('.lut-missing button', { hasText: 'Remove' }).click();
  await sleep(200);
  expect(!(await run((id) => window.__kinora.useProjectStore.getState().project.clips[id].lut, reopened.imgId)), '"Remove" clears the reference');

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
