/**
 * Performance & media test: proxies, background render cache, FFmpeg conversion and HDR,
 * exercised through the real UI (tiles, transport buttons, dialogs, inspector) with checks on
 * the project state, the files written and the pixels produced.
 *
 *   npm run build && node scripts/e2e.mjs media
 *
 * FFmpeg: when it is not installed, a fake ffmpeg.exe (scripts/e2e/fake-ffmpeg.cs, compiled
 * with the .NET Framework C# compiler) mimics FFmpeg's banner and `-progress` output and writes
 * a valid file, and the test "locates" it through the Settings / conversion dialog.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

/** Replace the first `from` fourcc after the first 'stsd' box with `to` (MP4 sample entry). */
function patchFourcc(buf, from, to) {
  const stsd = buf.indexOf(Buffer.from('stsd'));
  const pos = stsd < 0 ? -1 : buf.indexOf(Buffer.from(from), stsd);
  if (pos < 0) throw new Error(`no ${from} sample entry`);
  const out = Buffer.from(buf);
  out.write(to, pos, 'ascii');
  return out;
}

function compileFakeFfmpeg(root, outDir) {
  const exe = path.join(outDir, 'fake-ffmpeg', 'ffmpeg.exe');
  mkdirSync(path.dirname(exe), { recursive: true });
  const windir = process.env.WINDIR ?? 'C:\\Windows';
  const csc = [path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((p) => existsSync(p));
  if (!csc) throw new Error('csc.exe (.NET Framework) not found: cannot build the fake FFmpeg');
  execFileSync(csc, ['/nologo', '/optimize+', `/out:${exe}`, path.join(root, 'scripts', 'e2e', 'fake-ffmpeg.cs')], { stdio: 'pipe' });
  return exe;
}

export default async function media(ctx) {
  const { win, shot, run, sleep, outDir, root } = ctx;
  const mouse = win.mouse;
  await win.waitForSelector('.home', { timeout: 20000 });
  const appInfo = await run(() => window.kinora.app.info());
  const userData = appInfo.userData;

  const waitFor = async (fn, arg, what, timeout = 60000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await run(fn, arg);
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
      await sleep(200);
    }
  };
  const newProject = (opts) =>
    run(async (opts) => {
      const k = window.__kinora;
      k.useProjectStore.getState().markSaved(null);
      k.useUI.getState().set({ screen: 'home' });
      await k.projectIO.newProject(opts);
    }, opts).then(() => win.waitForSelector('.timeline'));
  const importUi = (files) =>
    run(async (files) => {
      const assets = await window.__kinoraMedia.importFiles(await window.kinora.fs.stat(files));
      return assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, hdr: !!a.hdr, width: a.width, height: a.height, duration: a.duration, transcodedFrom: a.transcodedFrom ?? null }));
    }, files);
  const exportFile = (file, overrides) =>
    run(
      async ({ file, overrides }) => {
        const k = window.__kinora;
        const project = k.useProjectStore.getState().project;
        const s = { container: 'mp4', videoCodec: 'avc', width: project.settings.width, height: project.settings.height, fps: project.settings.fps, quality: 'high', audio: false, start: 0, end: k.engine.duration, hardware: 'no-preference', fastStart: false, ...overrides };
        k.engine.setSuspended(true);
        try {
          await k.exporter.exportProject(project, s, file, () => {}, new AbortController().signal);
        } finally {
          k.engine.setSuspended(false);
        }
      },
      { file, overrides },
    );

  // =============================================================================================
  // 1. Proxies
  // =============================================================================================
  console.log('\n— Proxies');
  const clip1440 = path.join(outDir, 'media-1440p.mp4');
  await newProject({ name: 'Fixture 1440p', width: 2560, height: 1440, fps: 30 });
  await run(async () => {
    const k = window.__kinora;
    k.actions.addGenerator('aurora', { time: 0 });
    k.actions.addText('gradient-title', { time: 0 });
    k.actions.addText('basic-heading', { time: 0 });
    k.useProjectStore.getState().update((p) => {
      for (const c of Object.values(p.clips)) c.duration = 6;
    });
    await k.actions.addSound('ding', { time: 0.5 });
  });
  // 'high' (AAC 192 kbit/s): the Windows AAC encoder rejects the 256 kbit/s of 'best'.
  await exportFile(clip1440, { quality: 'high', audio: true, end: 6 });
  expect(existsSync(clip1440), 'rendered a 2560×1440 test clip with the app exporter');

  await newProject({ name: 'Proxies', width: 2560, height: 1440, fps: 30 });
  await run(() => window.__kinora.useUI.getState().setLibraryTab('media'));
  const [src] = await importUi([clip1440]);
  expect(src && src.width === 2560 && src.height === 1440, `imported the 1440p clip (${src?.width}×${src?.height})`);
  // Automatic creation (1440p ≥ threshold): the tile shows progress while the worker transcodes.
  await waitFor((id) => !!window.__kinoraMedia.proxies.jobs.getState().jobs[id] || !!window.__kinoraMedia.getProject().assets[id].proxy, src.id, 'proxy job');
  const sawProgress = await run((id) => !!window.__kinoraMedia.proxies.jobs.getState().jobs[id]);
  if (sawProgress) {
    await win.waitForSelector('.media-tile .mt-badge--pending', { timeout: 10000 }).catch(() => null);
    await shot('40-media-proxy-progress');
  }
  const proxy = await waitFor(
    (id) => {
      const a = window.__kinoraMedia.getProject().assets[id];
      const rt = window.__kinora.assets.useAssetRuntime.getState().items[id];
      return a.proxy && rt?.proxyUrl ? a.proxy : null;
    },
    src.id,
    'proxy to finish',
    120000,
  );
  expect(proxy.path.toLowerCase().startsWith(path.join(userData, 'proxies').toLowerCase()) && existsSync(proxy.path), `proxy written to userData\\proxies (${path.basename(proxy.path)})`);
  const probed = await run(async (p) => {
    const M = window.__kinoraMedia;
    const input = new M.mb.Input({ source: new M.mb.UrlSource(window.kinora.media.toUrl(p)), formats: M.mb.ALL_FORMATS });
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    const stats = await v.computePacketStats();
    let keys = 0;
    const sink = new M.mb.EncodedPacketSink(v);
    for await (const pkt of sink.packets()) if (pkt.type === 'key') keys++;
    const r = { w: await v.getDisplayWidth(), h: await v.getDisplayHeight(), codec: await v.getCodec(), audio: a ? await a.getCodec() : null, frames: stats.packetCount, keys, duration: await input.computeDuration() };
    input.dispose();
    return r;
  }, proxy.path);
  expect(probed.w === 960 && probed.h === 540 && probed.codec === 'avc' && probed.audio === 'aac', `proxy is ${probed.w}×${probed.h} ${probed.codec} + ${probed.audio}`);
  expect(probed.keys >= Math.floor(probed.duration / 0.5), `short key-frame interval (${probed.keys} key frames in ${probed.duration.toFixed(1)} s)`);
  const runner = await run(() => window.__kinoraMedia.proxies.proxyRunner());
  expect(runner === 'worker', `the proxy was transcoded off the UI thread (${runner})`);
  await win.waitForSelector('.media-tile .mt-badge--proxy');
  await shot('41-media-proxy-ready');

  // Put it on the timeline and look at what the preview plays.
  await win.locator('.media-tile').first().click();
  await run(() => window.__kinora.engine.seek(1));
  const previewSources = () =>
    run(() => [...document.querySelectorAll('video')].filter((v) => v.src).map((v) => ({ src: decodeURIComponent(v.src), w: v.videoWidth })));
  let vids = await waitFor(async () => {
    const list = [...document.querySelectorAll('video')].filter((v) => v.src && v.videoWidth > 0);
    return list.length ? list.map((v) => ({ src: decodeURIComponent(v.src), w: v.videoWidth })) : null;
  }, null, 'preview video element');
  expect(vids.some((v) => v.src.toLowerCase().includes('\\proxies\\') && v.w === 960), 'with "Use proxies" on, the preview plays the 960×540 proxy');
  await sleep(500);
  await shot('42-media-preview-proxy-on');

  await win.click('[data-proxy-toggle]');
  vids = await waitFor(async () => {
    const list = [...document.querySelectorAll('video')].filter((v) => v.src && v.videoWidth > 0 && !decodeURIComponent(v.src).toLowerCase().includes('\\proxies\\'));
    return list.length ? list.map((v) => ({ src: decodeURIComponent(v.src), w: v.videoWidth })) : null;
  }, null, 'original video element');
  expect(vids.some((v) => v.w === 2560) && !(await run(() => window.__kinoraMedia.prefs.getState().useProxies)), 'clicking the Proxy toggle switches the preview to the 2560×1440 original');
  await sleep(400);
  await shot('43-media-preview-proxy-off');
  await win.click('[data-proxy-toggle]');
  await waitFor(async () => [...document.querySelectorAll('video')].some((v) => decodeURIComponent(v.src).toLowerCase().includes('\\proxies\\') && v.videoWidth === 960), null, 'proxy again');
  expect((await previewSources()).length > 0, 'toggling back plays the proxy again');

  // Export with proxies on: the output must come from the original, not the proxy.
  const exported = path.join(outDir, 'media-proxy-export.mp4');
  await exportFile(exported, { end: 2, quality: 'best' });
  const cmp = await run(
    async ({ orig, exp, prox }) => {
      const M = window.__kinoraMedia;
      const frame = async (file) => {
        const input = new M.mb.Input({ source: new M.mb.UrlSource(window.kinora.media.toUrl(file)), formats: M.mb.ALL_FORMATS });
        const sink = new M.mb.CanvasSink(await input.getPrimaryVideoTrack(), { width: 2560, height: 1440, fit: 'fill' });
        const wc = await sink.getCanvas(1.0);
        const c = document.createElement('canvas');
        c.width = 2560;
        c.height = 1440;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(wc.canvas, 0, 0);
        input.dispose();
        return g.getImageData(0, 0, 2560, 1440).data;
      };
      const [a, b, p] = [await frame(orig), await frame(exp), await frame(prox)];
      const diff = (x, y) => {
        let s = 0;
        for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
        return s / ((x.length / 4) * 3);
      };
      return { exportVsOriginal: diff(b, a), exportVsProxy: diff(b, p), proxyVsOriginal: diff(p, a) };
    },
    { orig: clip1440, exp: exported, prox: proxy.path },
  );
  console.log(`  frame differences (mean |Δ|): export↔original ${cmp.exportVsOriginal.toFixed(2)}, export↔proxy ${cmp.exportVsProxy.toFixed(2)}, proxy↔original ${cmp.proxyVsOriginal.toFixed(2)}`);
  expect(cmp.exportVsOriginal < cmp.exportVsProxy * 0.7, 'export uses the original media even while the preview plays proxies');

  // Missing proxy files are regenerated when the project is opened again.
  const saved = path.join(outDir, 'Media proxies.kinora');
  await run(async (file) => {
    const k = window.__kinora;
    k.useProjectStore.getState().update((p) => void (p.name = 'Media proxies'));
    await k.projectIO.saveProject();
    return file;
  }, saved);
  await waitFor((f) => window.kinora.fs.stat([f]).then((s) => s[0].exists), saved, 'project saved', 10000);
  const savedJson = JSON.parse(readFileSync(saved, 'utf8'));
  expect(Object.values(savedJson.project.assets).some((a) => a.proxy?.path === proxy.path), 'asset.proxy is saved with the project');
  await run(async () => {
    const k = window.__kinora;
    k.useProjectStore.getState().markSaved(null);
    k.useUI.getState().set({ screen: 'home' });
  });
  await sleep(300);
  rmSync(proxy.path, { force: true });
  await run((f) => window.__kinora.projectIO.openProject(f), saved);
  await win.waitForSelector('.timeline');
  if (await win.waitForSelector('.media-tile .mt-badge--pending', { timeout: 8000 }).catch(() => null)) {
    await sleep(150);
    await shot('40-media-proxy-regenerating');
  }
  const regenerated = await waitFor(
    (id) => {
      const a = window.__kinoraMedia.getProject().assets[id];
      return a?.proxy && window.__kinora.assets.useAssetRuntime.getState().items[id]?.proxyUrl ? a.proxy.path : null;
    },
    src.id,
    'regenerated proxy',
    120000,
  );
  expect(existsSync(regenerated), 'a deleted proxy file is regenerated when the project is reopened');

  // =============================================================================================
  // 2. Background render cache
  // =============================================================================================
  console.log('\n— Render cache');
  await newProject({ name: 'Heavy', width: 1920, height: 1080, fps: 30 });
  await run(async () => {
    const k = window.__kinora;
    let n = 0;
    const fx = (effectId, params = {}) => ({ uid: `fx_${n++}`, effectId, enabled: true, params });
    // Deliberately heavy: 18 full-frame procedural layers, each with 8 multi-pass effects
    // (~380 full-frame shader passes per frame), plus a title.
    const base = ['aurora', 'plasma', 'liquid-marble', 'clouds', 'flowing-silk', 'water-caustics', 'lava-lamp', 'soft-waves', 'mesh-gradient', 'gradient-flow', 'flame', 'conic-sweep'];
    const gens = [...base, ...base.slice(0, 6)];
    for (const g of gens) k.actions.addGenerator(g, { time: 0 });
    k.actions.addText('gradient-title', { time: 2 });
    k.useProjectStore.getState().update((p) => {
      let i = 0;
      for (const c of Object.values(p.clips)) {
        if (c.type === 'text') {
          c.duration = 1;
          continue;
        }
        c.duration = 6;
        c.transform.opacity = i === 0 ? 1 : 0.32;
        c.effects = [
          fx('lens-blur', { radius: 60 }),
          fx('oil-paint', { radius: 24 }),
          fx('box-blur', { radius: 180 }),
          fx('surface-blur', { radius: 30 }),
          fx('zoom-blur'),
          fx('god-rays'),
          fx('frosted-glass'),
          fx('glow'),
        ];
        i++;
      }
    });
    k.useUI.getState().clearSelection();
    k.engine.seek(0);
  });
  await waitFor(() => {
    const st = window.__kinoraMedia.cache.state.getState();
    return st.project === window.__kinora.useProjectStore.getState().project && st.segments.length === 6;
  }, null, 'cache segments');
  let runs = await run(() => window.__kinoraMedia.cache.statusRuns());
  expect(runs.some((r) => r.status === 'needs-render'), `the heavy project is flagged "needs render" (amber): ${JSON.stringify(runs.map((r) => `${r.start}-${r.end}:${r.status}`))}`);

  const measure = async () => {
    await run(() => {
      const k = window.__kinora;
      k.engine.pause();
      k.engine.seek(0);
    });
    await sleep(600);
    await run(() => {
      window.__kinoraMedia.cache.resetPlaybackStats();
      window.__kinora.engine.play();
    });
    await sleep(3500);
    return run(() => {
      const s = window.__kinoraMedia.cache.playbackStats();
      window.__kinora.engine.pause();
      return { ...s, fps: s.distinct / s.seconds };
    });
  };
  const before = await measure();
  console.log(`  BEFORE rendering: ${before.fps.toFixed(1)} fps (${before.distinct} distinct frames in ${before.seconds.toFixed(1)} s, ${before.live} live / ${before.fromCache} cached)`);
  await shot('44-media-cache-needs-render');

  await win.click('[data-render-preview]');
  await waitFor(() => !!window.__kinoraMedia.cache.state.getState().job, null, 'render job');
  await sleep(1500);
  await win.click('[data-media-tasks]');
  await sleep(300);
  await shot('45-media-cache-rendering');
  await win.keyboard.press('Escape');
  const t0 = Date.now();
  await waitFor(() => !window.__kinoraMedia.cache.state.getState().job, null, 'render job to finish', 300000);
  console.log(`  rendered 6 s of heavy timeline in ${((Date.now() - t0) / 1000 + 1.8).toFixed(1)} s`);
  runs = await run(() => window.__kinoraMedia.cache.statusRuns());
  expect(runs.length === 1 && runs[0].status === 'cached' && runs[0].end >= 5.99, `the whole range is rendered (green): ${JSON.stringify(runs.map((r) => `${r.start}-${r.end}:${r.status}`))}`);
  const cacheFiles = readdirSync(path.join(userData, 'cache')).filter((f) => f.endsWith('.mp4'));
  expect(cacheFiles.length >= 6, `${cacheFiles.length} H.264 segments in userData\\cache`);
  await shot('46-media-cache-rendered');

  const after = await measure();
  console.log(`  AFTER rendering: ${after.fps.toFixed(1)} fps (${after.distinct} distinct frames in ${after.seconds.toFixed(1)} s, ${after.live} live / ${after.fromCache} cached)`);
  expect(after.fromCache > after.live, 'playback is served from the render cache');
  // On a fast or idle machine the live preview may already keep up; then the cache must simply
  // hold the full rate.
  const fullRate = before.fps >= 27 && after.fps >= 27;
  expect(after.fps > before.fps * 1.3 || (after.fps >= 27 && before.fps < 27) || fullRate, `playback is faster from the cache, or full rate both ways (${before.fps.toFixed(1)} → ${after.fps.toFixed(1)} fps)`);
  await sleep(300);
  await shot('47-media-cache-playing');

  // Precise invalidation: editing the text (2 s–3 s) only invalidates that second.
  await run(() =>
    window.__kinora.useProjectStore.getState().update((p) => {
      const t = Object.values(p.clips).find((c) => c.type === 'text');
      t.text.content = 'Edited after rendering';
    }),
  );
  await waitFor(() => {
    const st = window.__kinoraMedia.cache.state.getState();
    return st.project === window.__kinora.useProjectStore.getState().project;
  }, null, 'recomputed segments');
  const statuses = await run(() => window.__kinoraMedia.cache.state.getState().segments.map((s) => window.__kinoraMedia.cache.segmentStatus(s)));
  expect(statuses[2] !== 'cached' && [0, 1, 3, 4, 5].every((i) => statuses[i] === 'cached'), `an edit invalidates only the seconds it touches (${statuses.join(', ')})`);
  await shot('48-media-cache-invalidated');
  // Undo restores the old content → the old segment files are valid again.
  await run(() => window.__kinora.useProjectStore.getState().undo());
  await waitFor(() => {
    const st = window.__kinoraMedia.cache.state.getState();
    return st.project === window.__kinora.useProjectStore.getState().project && st.segments.every((s) => window.__kinoraMedia.cache.segmentStatus(s) === 'cached');
  }, null, 'undo revalidates the segment');
  expect(true, 'undo makes the earlier render valid again (content-addressed keys)');

  // =============================================================================================
  // 3. FFmpeg conversion (fake executable when FFmpeg is not installed)
  // =============================================================================================
  console.log('\n— FFmpeg');
  const fake = compileFakeFfmpeg(root, outDir);
  expect(existsSync(fake), `fake FFmpeg compiled (${path.relative(root, fake)})`);
  const mp4 = readFileSync(clip1440);
  const prores = path.join(outDir, 'media-prores.mov');
  const proresSlow = path.join(outDir, 'media-prores-slow.mov');
  writeFileSync(prores, patchFourcc(mp4, 'avc1', 'apcn'));
  writeFileSync(proresSlow, patchFourcc(mp4, 'avc1', 'apcn'));

  await newProject({ name: 'FFmpeg', width: 1920, height: 1080, fps: 30 });
  await run(() => window.__kinora.useUI.getState().setLibraryTab('media'));
  const none = await importUi([prores]);
  expect(none.length === 0, 'a ProRes-coded file cannot be imported directly');
  await win.waitForSelector('.modal >> text=Convert unsupported media?');
  await win.waitForSelector('[data-ffmpeg-state="missing"]');
  await sleep(300);
  await shot('50-media-ffmpeg-missing');
  expect(await win.locator('.mx-convert__steps').isVisible(), 'without FFmpeg the dialog explains how to install it');
  expect(await win.locator('[data-convert-start]').isDisabled(), 'Convert is disabled until FFmpeg is available');

  await win.click('[data-ffmpeg-browse]');
  await win.waitForSelector('[data-ffmpeg-state="found"]');
  await sleep(200);
  await shot('51-media-ffmpeg-found');
  await win.click('[data-convert-start]');
  await waitFor(() => Object.values(window.__kinoraMedia.ffmpeg.state.getState().jobs).some((j) => j.ratio > 0.2), null, 'conversion progress', 20000);
  await win.click('[data-media-tasks]');
  await sleep(250);
  await shot('52-media-ffmpeg-converting');
  await win.keyboard.press('Escape');
  const converted = await waitFor(() => Object.values(window.__kinoraMedia.getProject().assets).find((a) => a.transcodedFrom) ?? null, null, 'converted asset', 60000);
  expect(converted.transcodedFrom.toLowerCase() === prores.toLowerCase() && converted.kind === 'video' && converted.width === 2560 && Math.abs(converted.duration - 6) < 0.2, `converted copy imported (${converted.name}, ${converted.width}×${converted.height}, ${converted.duration.toFixed(2)} s) with transcodedFrom`);
  expect(converted.source.path.toLowerCase().startsWith(path.join(userData, 'converted').toLowerCase()) && existsSync(converted.source.path), 'converted file lives in userData\\converted');
  await win.waitForSelector('.media-tile .mt-badge--conv');
  await sleep(400);
  await shot('53-media-ffmpeg-converted');

  // Cancel a (slow) conversion from the background-tasks popover.
  await importUi([proresSlow]);
  await win.waitForSelector('[data-convert-start]:not([disabled])');
  await win.click('[data-convert-start]');
  await waitFor(() => Object.values(window.__kinoraMedia.ffmpeg.state.getState().jobs).some((j) => j.ratio > 0.05), null, 'slow conversion progress', 20000);
  await win.click('[data-media-tasks]');
  await win.locator('.mx-popover .mx-task', { hasText: 'slow' }).locator('button').click();
  await waitFor(() => Object.keys(window.__kinoraMedia.ffmpeg.state.getState().jobs).length === 0, null, 'cancelled conversion', 20000);
  await sleep(500);
  const assetsAfterCancel = await run(() => Object.values(window.__kinoraMedia.getProject().assets).filter((a) => a.transcodedFrom).length);
  const leftovers = readdirSync(path.join(userData, 'converted')).filter((f) => f.endsWith('.part'));
  expect(assetsAfterCancel === 1 && leftovers.length === 0, 'cancelling stops FFmpeg and leaves no partial file');
  await win.keyboard.press('Escape');

  // Settings sections (shown in the Settings window, or in their own dialog in this build).
  await run(() => window.__kinoraMedia.openMediaSettings());
  await win.waitForSelector('[data-settings-section="proxies"]');
  await win.waitForSelector('[data-settings-section="ffmpeg"] [data-ffmpeg-state="found"]');
  await sleep(500);
  await shot('54-media-settings');
  await win.locator('[data-settings-section="cache"]').scrollIntoViewIfNeeded();
  await sleep(200);
  await shot('55-media-settings-storage');
  await win.keyboard.press('Escape');

  // =============================================================================================
  // 4. HDR
  // =============================================================================================
  console.log('\n— HDR');
  const hdrFile = path.join(outDir, 'media-hdr-pq.mp4');
  const sdrFile = path.join(outDir, 'media-sdr-ramp.mp4');
  const made = await run(
    async ({ hdrFile, sdrFile }) => {
      const M = window.__kinoraMedia;
      const write = async (file, bytes) => {
        const h = await window.kinora.fs.openWrite(file);
        await window.kinora.fs.write(h, 0, bytes);
        await window.kinora.fs.closeWrite(h);
      };
      const hdr = await M.makeSyntheticHdrVideo({ width: 1280, height: 720, frames: 60, pq: true });
      const sdr = await M.makeSyntheticHdrVideo({ width: 1280, height: 720, frames: 60, pq: false });
      await write(hdrFile, hdr.bytes);
      await write(sdrFile, sdr.bytes);
      return { codec: hdr.codec, bits: hdr.bitDepth };
    },
    { hdrFile, sdrFile },
  );
  console.log(`  synthetic PQ / BT.2020 clip: ${made.codec} (${made.bits}-bit)`);
  await newProject({ name: 'HDR', width: 1280, height: 720, fps: 30 });
  await run(() => window.__kinora.useUI.getState().setLibraryTab('media'));
  const hdrAssets = await importUi([hdrFile, sdrFile]);
  const hdrA = hdrAssets.find((a) => a.name.includes('hdr'));
  const sdrA = hdrAssets.find((a) => a.name.includes('sdr'));
  expect(hdrA?.hdr === true && sdrA && !sdrA.hdr, 'the PQ clip is detected as HDR, the SDR one is not');
  await win.waitForSelector('.media-tile .mt-badge--hdr');
  const passthrough = await run(() => window.__kinoraMedia.hdr.probeHdrPipeline());
  expect(passthrough === true, 'pipeline probe: WebGL uploads of PQ frames carry the raw signal (so the extension tone-maps)');

  await win.locator('.media-tile', { hasText: 'media-hdr-pq' }).click();
  await sleep(300);
  await run(() => window.__kinora.engine.seek(0.5));
  await win.locator('.tabs__tab', { hasText: 'Adjust' }).click();
  await win.waitForSelector('[data-section="hdr"]');
  await win.locator('[data-section="hdr"]').scrollIntoViewIfNeeded();
  await sleep(700);
  await shot('56-media-hdr-inspector');
  await win.locator('[data-section="hdr"] select').selectOption('aces');
  const op = await run(() => Object.values(window.__kinora.useProjectStore.getState().project.clips).find((c) => c.type === 'video').toneMap?.operator);
  expect(op === 'aces', 'the inspector sets the tone-mapping operator');
  await win.locator('[data-section="hdr"] select').selectOption('bt2390');

  // Preview and export must agree on the tone-mapped pixels.
  const hdrPng = path.join(outDir, 'media-hdr-frame.png');
  await exportFile(hdrPng, { container: 'png', start: 0.5, end: 0.5 });
  await run(() => window.__kinora.engine.seek(0.5));
  await sleep(900);
  const samples = await run(async (png) => {
    const read = async (blob) => {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const at = (x, y) => [...g.getImageData(Math.floor(x * bmp.width), Math.floor(y * bmp.height), 1, 1).data.slice(0, 3)];
      return { patches: [0.125, 0.375, 0.625, 0.875].map((x) => at(x, 0.75)), ramp: [0.3, 0.5, 0.58, 0.75, 0.9].map((x) => at(x, 0.25)) };
    };
    const preview = await read(await window.__kinora.engine.snapshot());
    const exported = await read(await (await fetch(window.kinora.media.toUrl(png))).blob());
    return { preview, exported };
  }, hdrPng);
  console.log(`  tone-mapped patches 100/203/1000/4000 nits — preview ${JSON.stringify(samples.preview.patches.map((p) => p[0]))}, export ${JSON.stringify(samples.exported.patches.map((p) => p[0]))}`);
  const maxDev = Math.max(...samples.preview.patches.flatMap((p, i) => p.map((v, j) => Math.abs(v - samples.exported.patches[i][j]))), ...samples.preview.ramp.flatMap((p, i) => p.map((v, j) => Math.abs(v - samples.exported.ramp[i][j]))));
  expect(maxDev <= 4, `preview and export tone-map identically (max deviation ${maxDev}/255)`);
  const ex = samples.exported.patches.map((p) => p[0]);
  expect(ex[0] < ex[1] && ex[1] < ex[2] && ex[2] <= ex[3], 'brighter HDR patches stay brighter after tone-mapping');
  expect(Math.abs(ex[0] - Math.round(0.508 * 255)) > 20, `tone-mapping is applied (100-nit patch ${ex[0]} ≠ raw PQ code ${Math.round(0.508 * 255)})`);
  await shot('57-media-hdr-preview');

  // An HDR proxy keeps the raw signal, so the preview through the proxy matches the export too.
  await win.locator('.media-tile', { hasText: 'media-hdr-pq' }).click({ button: 'right' });
  await win.locator('.menu__item', { hasText: 'Create proxy' }).click();
  await waitFor((id) => !!window.__kinora.assets.useAssetRuntime.getState().items[id]?.proxyUrl, hdrA.id, 'HDR proxy', 60000);
  await run(() => window.__kinora.engine.seek(0.25));
  await waitFor(async () => [...document.querySelectorAll('video')].some((v) => decodeURIComponent(v.src).toLowerCase().includes('\\proxies\\') && v.videoWidth === 960), null, 'HDR proxy in the preview');
  await run(() => window.__kinora.engine.seek(0.5));
  await sleep(900);
  const viaProxy = await run(async () => {
    const bmp = await createImageBitmap(await window.__kinora.engine.snapshot());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return [0.125, 0.375, 0.625, 0.875].map((x) => g.getImageData(Math.floor(x * bmp.width), Math.floor(0.75 * bmp.height), 1, 1).data[0]);
  });
  const proxyDev = Math.max(...viaProxy.map((v, i) => Math.abs(v - ex[i])));
  expect(proxyDev <= 8, `HDR proxy preview matches the export after tone-mapping (${JSON.stringify(viaProxy)}, max deviation ${proxyDev})`);

  // SDR media is untouched: export a frame of the SDR clip and compare it with the decoded source.
  await run(() => {
    const k = window.__kinora;
    k.useProjectStore.getState().update((p) => {
      for (const c of Object.values(p.clips)) delete p.clips[c.id];
    });
  });
  await win.locator('.media-tile', { hasText: 'media-sdr-ramp' }).click();
  await sleep(300);
  const sdrPng = path.join(outDir, 'media-sdr-frame.png');
  await exportFile(sdrPng, { container: 'png', start: 0.5, end: 0.5 });
  const sdrDiff = await run(
    async ({ png, src }) => {
      const M = window.__kinoraMedia;
      const bmp = await createImageBitmap(await (await fetch(window.kinora.media.toUrl(png))).blob());
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const a = g.getImageData(0, 0, c.width, c.height).data;
      const input = new M.mb.Input({ source: new M.mb.UrlSource(window.kinora.media.toUrl(src)), formats: M.mb.ALL_FORMATS });
      const wc = await new M.mb.CanvasSink(await input.getPrimaryVideoTrack()).getCanvas(0.5);
      g.drawImage(wc.canvas, 0, 0);
      const b = g.getImageData(0, 0, c.width, c.height).data;
      input.dispose();
      let max = 0;
      let differing = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (d > 0) differing++;
        if (d > max) max = d;
      }
      return { max, differing, total: a.length / 4 };
    },
    { png: sdrPng, src: sdrFile },
  );
  expect(sdrDiff.max === 0, `SDR frames pass through bit-identical (max Δ ${sdrDiff.max}, ${sdrDiff.differing}/${sdrDiff.total} pixels differ)`);

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
  console.log(`\n  SUMMARY playback fps before/after render: ${before.fps.toFixed(1)} → ${after.fps.toFixed(1)}`);
}
