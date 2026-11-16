/**
 * Full pipeline test:
 *  1. Build a project from generated content (background, text, sticker, shape, sound).
 *  2. Export it to MP4 (H.264 + AAC) and verify the file by importing it back.
 *  3. Build a second project from that video (two clips, transition, filter, effect, speed),
 *     play it in the preview, then export again.
 */
import path from 'node:path';

async function exportTo(ctx, name, overrides = {}) {
  const file = path.join(ctx.outDir, name);
  const result = await ctx.run(
    async ({ file, overrides }) => {
      const k = window.__kinora;
      const project = k.useProjectStore.getState().project;
      const duration = k.engine.duration;
      const settings = {
        container: 'mp4',
        videoCodec: 'avc',
        width: project.settings.width,
        height: project.settings.height,
        fps: project.settings.fps,
        quality: 'medium',
        audio: true,
        start: 0,
        end: duration,
        hardware: 'no-preference',
        fastStart: false,
        ...overrides,
      };
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
  if (!result.ok) throw new Error(`export failed: ${result.error}`);
  console.log(`  exported ${name}: ${result.frames} frames in ${result.seconds.toFixed(1)}s (${result.speed.toFixed(0)} fps)`);
  return file;
}

async function importFile(ctx, file) {
  const info = await ctx.run(async (file) => {
    const k = window.__kinora;
    const stats = await window.kinora.fs.stat([file]);
    const res = await k.assets.importMediaFiles(stats);
    const a = res.assets[0];
    return { failures: res.failures, size: stats[0].size, asset: a ? { id: a.id, kind: a.kind, duration: a.duration, width: a.width, height: a.height, fps: a.fps, hasAudio: a.hasAudio, videoCodec: a.videoCodec, audioCodec: a.audioCodec } : null };
  }, file);
  if (!info.asset) throw new Error(`import failed: ${JSON.stringify(info.failures)}`);
  console.log(`  imported: ${JSON.stringify(info.asset)} size=${info.size}`);
  return info.asset;
}

export default async function run(ctx) {
  const { win, shot, run, sleep } = ctx;
  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- Project 1: generated content -----------------------------------------------------------
  await run(async () => {
    const k = window.__kinora;
    await k.projectIO.newProject({ name: 'E2E one', width: 1280, height: 720, fps: 30 });
  });
  await win.waitForSelector('.timeline');
  await run(async () => {
    const k = window.__kinora;
    const a = k.actions;
    a.addGenerator('aurora', { time: 0 });
    k.engine.seek(0);
    a.addText('gradient-title', { time: 0 });
    a.addSticker('pulse-heart', { time: 0.5 });
    a.editClips(k.useUI.getState().selection, (c) => {
      c.transform.x = -420;
      c.transform.y = 200;
      c.size = 220;
    });
    a.addShape('star', { time: 1 });
    a.editClips(k.useUI.getState().selection, (c) => {
      c.transform.x = 430;
      c.transform.y = -190;
      c.transform.scaleX = c.transform.scaleY = 0.5;
      c.anim = { in: { id: 'pop-in', duration: 0.5 }, loop: { id: 'spin', duration: 4 } };
    });
    await a.addSound('whoosh-soft', { time: 0.2 });
    await a.addSound('ding', { time: 1.5 });
    k.useUI.getState().clearSelection();
    k.engine.seek(2.5);
  });
  await sleep(900);
  await shot('10-project1');

  const first = await exportTo(ctx, 'e2e-one.mp4');

  // ---- Project 2: edit the exported video ----------------------------------------------------
  await run(async () => {
    const k = window.__kinora;
    k.useProjectStore.getState().markSaved(null);
    await k.projectIO.newProject({ name: 'E2E two', width: 1920, height: 1080, fps: 30 });
  });
  await win.waitForSelector('.timeline');
  const asset = await importFile(ctx, first);
  if (asset.kind !== 'video' || Math.abs(asset.duration - 6) > 0.2 || asset.width !== 1280 || !asset.hasAudio) {
    throw new Error(`unexpected exported file properties: ${JSON.stringify(asset)}`);
  }

  await run(async (assetId) => {
    const k = window.__kinora;
    const a = k.actions;
    const project = () => k.useProjectStore.getState().project;
    const asset = project().assets[assetId];
    a.addAsset(asset, { time: 0 });
    const firstId = k.useUI.getState().selection[0];
    a.addAsset(asset);
    const secondId = k.useUI.getState().selection[0];
    // Trim both clips to 3 s, butt them together, then add a transition.
    k.useProjectStore.getState().update((p) => {
      p.clips[firstId].duration = 3;
      p.clips[secondId].start = 3;
      p.clips[secondId].trimIn = 1;
      p.clips[secondId].duration = 3;
      p.clips[secondId].speed = 1;
    });
    a.addTransition('fade', firstId, secondId);
    a.applyFilter('teal-orange', firstId);
    a.applyEffect('rgb-split', secondId);
    a.addText('basic-heading', { time: 0.5 });
    k.useUI.getState().select([firstId]);
    k.engine.seek(1);
  }, asset.id);
  await sleep(1500);
  await shot('11-project2-paused');

  // Seek into the transition and check the preview shows a frame.
  await run(() => window.__kinora.engine.seek(3));
  await sleep(1200);
  await shot('12-project2-transition');

  // Play for a moment.
  await run(() => {
    window.__kinora.engine.seek(0.2);
    window.__kinora.engine.play();
  });
  await sleep(1800);
  const t = await run(() => ({ time: window.__kinora.engine.time, playing: window.__kinora.engine.playing }));
  console.log(`  playback: ${JSON.stringify(t)}`);
  if (!t.playing || t.time < 1.2) throw new Error('playback did not advance');
  await shot('13-project2-playing');
  await run(() => window.__kinora.engine.pause());

  const second = await exportTo(ctx, 'e2e-two.mp4', { quality: 'high' });
  const out = await importFile(ctx, second);
  if (Math.abs(out.duration - 6) > 0.25 || out.width !== 1920 || out.height !== 1080) throw new Error(`unexpected second export: ${JSON.stringify(out)}`);

  // Other containers.
  await exportTo(ctx, 'e2e-two.webm', { container: 'webm', videoCodec: 'vp9', width: 640, height: 360 });
  await exportTo(ctx, 'e2e-two.gif', { container: 'gif', width: 320, height: 180, fps: 10, end: 2 });
  await exportTo(ctx, 'e2e-two.mp3', { container: 'mp3' });
  await exportTo(ctx, 'e2e-two.wav', { container: 'wav' });
  await exportTo(ctx, 'e2e-frame.png', { container: 'png', start: 1.5, end: 1.5 });

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
