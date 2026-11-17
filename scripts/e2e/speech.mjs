/**
 * Speech & audio scenario, driven through the real UI:
 *  1. text to speech (Windows voices) → a voice-over clip at the playhead,
 *  2. auto captions from it; the transcript must match the spoken text,
 *  3. Captions inspector tab: presets, highlight, position, undo,
 *  4. word-highlight rendering, identical in the preview and in an exported MP4 (frames checked),
 *  5. SRT / VTT export and import,
 *  6. filler-word removal (review list, preview, ripple cut, single undo),
 *  7. silence detection + removal (timeline overlay),
 *  8. beat detection on a music bed + "one per beat" layout,
 *  9. noise reduction with A/B audition, swapped asset, undo,
 * 10. auto-ducking, project save / reopen, and a WebGPU vs WASM transcription benchmark.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SPOKEN =
  'Welcome to Kinora, the video editor that runs on your own computer. Um, today I will show you how automatic captions work. Every word is highlighted while it is spoken, so viewers can follow along.';
const SECOND = 'Thanks for watching, and see you in the next video.';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Word error rate (Levenshtein over words). */
function wer(ref, hyp) {
  const a = norm(ref);
  const b = norm(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] / Math.max(1, a.length);
}

export default async function speech(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const ortFiles = new Set();
  win.on('request', (r) => {
    if (r.url().startsWith('kinora://models/ort/')) ortFiles.add(r.url().replace('kinora://models/ort/', ''));
  });
  win.on('worker', (w) => w.on('console', (m) => (m.type() === 'error' ? console.log(`  [worker error] ${m.text().slice(0, 300)}`) : undefined)));

  const project = () => run(() => window.__kinora.useProjectStore.getState().project);
  const job = () => run(() => window.__kinoraSpeech.store.getState().job);
  const waitJob = async (label, timeout = 240000) => {
    const t0 = Date.now();
    await sleep(300);
    while (await job()) {
      if (Date.now() - t0 > timeout) throw new Error(`${label} did not finish in time`);
      await sleep(250);
    }
    console.log(`  … ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  };
  const tab = async (name) => {
    await win.click(`.rail__btn[data-tab="${name}"]`);
    await sleep(350);
  };
  const openTool = async (id) => {
    await tab('tools');
    const card = win.locator(`[data-tool="${id}"]`);
    if (!(await card.evaluate((el) => el.classList.contains('is-open')))) await card.locator('.tool-card__head').click();
    await sleep(250);
    return card;
  };
  const captions = () =>
    run(() => {
      const p = window.__kinora.useProjectStore.getState().project;
      const track = p.tracks.find((t) => t.role === 'captions');
      return Object.values(p.clips)
        .filter((c) => track && c.trackId === track.id)
        .sort((a, b) => a.start - b.start)
        .map((c) => ({ id: c.id, start: c.start, duration: c.duration, text: c.text.content, font: c.text.fontFamily, highlight: c.caption?.highlight, color: c.caption?.highlightColor, words: c.caption?.words, y: c.transform.y }));
    });
  const selectClip = async (id) => {
    await run((id) => {
      const k = window.__kinora;
      k.useUI.getState().select([id]);
    }, id);
    await sleep(200);
  };

  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- New vertical project by clicking the 9:16 format card -------------------------------------
  await win.locator('.format-card', { hasText: '9:16' }).first().click();
  await win.waitForSelector('.timeline');
  await sleep(500);

  // ---- 1. Text to speech -------------------------------------------------------------------------
  const tts = await openTool('speech.tts');
  await win.waitForFunction(() => document.querySelector('[data-tool="speech.tts"] select.select'), null, { timeout: 30000 });
  const voices = await tts.locator('select.select').first().evaluate((el) => [...el.options].map((o) => o.value));
  console.log(`  voices: ${voices.join(', ')}`);
  expect(voices.length > 0, 'Windows voices are listed');
  const zira = voices.find((v) => /zira/i.test(v)) ?? voices[0];
  await tts.locator('select.select').first().selectOption(zira);
  await tts.locator('[data-input="tts-text"]').fill(SPOKEN);
  await shot('speech-01-tts');
  await tts.locator('[data-action="tts-add"]').click();
  await waitJob('text to speech', 60000);
  let p = await project();
  const voiceClip = Object.values(p.clips).find((c) => c.type === 'audio');
  expect(voiceClip && voiceClip.duration > 8, `voice-over clip added (${voiceClip?.duration.toFixed(2)} s)`);
  expect(voiceClip.start === 0, 'placed at the playhead');

  // A second line at the end, then moved 3 s later (leaves a silence to remove later).
  await run(() => window.__kinora.engine.seek(window.__kinora.engine.duration));
  await tts.locator('[data-input="tts-text"]').fill(SECOND);
  await tts.locator('[data-action="tts-add"]').click();
  await waitJob('text to speech (2)', 60000);
  p = await project();
  const audioClips = Object.values(p.clips).filter((c) => c.type === 'audio');
  expect(audioClips.length === 2, 'second voice-over clip added');
  const second = audioClips.find((c) => c.id !== voiceClip.id);
  expect(Math.abs(second.start - (voiceClip.start + voiceClip.duration)) < 0.05, 'second clip placed at the playhead');
  await run((id) => window.__kinora.useProjectStore.getState().update((p) => void (p.clips[id].start += 3)), second.id);

  // ---- 2. Auto captions -----------------------------------------------------------------------
  await run(() => window.__kinora.useUI.getState().clearSelection());
  const cap = await openTool('speech.captions');
  await cap.locator('.segmented button', { hasText: 'Whole timeline' }).click();
  await cap.locator('[data-preset="word-box"]').click();
  await shot('speech-02-captions-tool');
  await cap.locator('[data-action="generate-captions"]').click();
  await sleep(600);
  await shot('speech-03-transcribing');
  await waitJob('auto captions (cold model)');
  let caps = await captions();
  const transcript = caps.map((c) => c.text.replace(/\n/g, ' ')).join(' ');
  console.log(`  transcript: ${transcript}`);
  const err = wer(`${SPOKEN} ${SECOND}`, transcript);
  console.log(`  word error rate: ${(err * 100).toFixed(1)}%`);
  expect(err < 0.15, 'transcript matches the spoken text closely');
  expect(caps.length >= 4, `${caps.length} captions created`);
  for (const c of caps) for (const line of c.text.split('\n')) expect(line.length <= 20, `line "${line}" fits the 9:16 line length`);
  expect(caps.every((c, i) => i === 0 || c.start >= caps[i - 1].start + caps[i - 1].duration - 1e-6), 'captions never overlap');
  expect(caps.every((c) => c.words && c.words.length === c.text.split(/\s+/).filter(Boolean).length), 'every caption carries word timings');
  expect(caps.every((c) => c.highlight === 'box' && c.font === 'Montserrat'), 'chosen style (Highlight box) applied');
  p = await project();
  expect(p.tracks[0].role === 'captions', 'captions are on the topmost track');
  const lastRun = await run(() => window.__kinoraSpeech.store.getState().lastRun);
  console.log(`  transcription: ${JSON.stringify(lastRun)}`);

  // Preview: a frame mid-sentence shows the highlight box.
  const probe = caps[1];
  const w = probe.words[Math.min(2, probe.words.length - 1)];
  const probeTime = probe.start + (w.start + w.end) / 2;
  await run((t) => {
    const k = window.__kinora;
    k.useUI.getState().clearSelection();
    k.engine.seek(t);
  }, probeTime);
  await sleep(700);
  await shot('speech-04-preview-highlight');

  // ---- 3. Captions inspector tab --------------------------------------------------------------
  await win.locator(`[data-clip="${caps[0].id}"]`).click();
  await sleep(300);
  await win.locator('.tabs__tab', { hasText: 'Captions' }).click();
  await sleep(300);
  await shot('speech-05-captions-tab');
  const pastBefore = await run(() => window.__kinora.useProjectStore.getState().past.length);
  await win.locator('.inspector [data-preset="karaoke"]').click();
  await sleep(250);
  caps = await captions();
  expect(caps.every((c) => c.highlight === 'karaoke' && c.font === 'Poppins'), 'preset applied to every caption at once');
  await win.locator('.inspector [data-highlight="pop"]').click();
  await sleep(200);
  caps = await captions();
  expect(caps.every((c) => c.highlight === 'pop'), 'highlight mode changed on every caption');
  await win.locator('.inspector .segmented button', { hasText: 'Middle' }).click();
  await sleep(200);
  caps = await captions();
  expect(caps.every((c) => Math.abs(c.y) < 1), 'position applied to every caption');
  const pastAfter = await run(() => window.__kinora.useProjectStore.getState().past.length);
  expect(pastAfter - pastBefore === 3, 'each change is one undo step');
  await win.keyboard.press('Control+z');
  await sleep(200);
  caps = await captions();
  expect(caps.every((c) => c.y > 100), 'undo restores the position');
  // Edit one caption's text in the tab.
  const ta = win.locator('[data-input="caption-text"]');
  const original = await ta.inputValue();
  await ta.fill(original.replace(/^\S+/, (m) => m.toUpperCase()));
  await sleep(250);
  caps = await captions();
  expect(caps[0].text.split(/\s+/)[0] === original.split(/\s+/)[0].toUpperCase(), 'caption text edited in the tab');
  expect(caps[0].words.length === caps[0].text.split(/\s+/).filter(Boolean).length, 'word timings kept after the edit');
  await win.locator('.inspector [data-preset="word-box"]').click();
  await sleep(300);
  await shot('speech-06-captions-tab-edited');

  // ---- 4. Export with captions: compare an exported frame with the preview ---------------------
  caps = await captions();
  const frameCap = caps[2] ?? caps[1];
  const fw = frameCap.words[Math.min(1, frameCap.words.length - 1)];
  const frameTime = Math.round((frameCap.start + fw.start + (fw.end - fw.start) * 0.6) * 30) / 30;
  const mp4 = path.join(outDir, 'speech-captions.mp4');
  const exportRes = await run(
    async ({ file, frameTime }) => {
      const k = window.__kinora;
      const p = k.useProjectStore.getState().project;
      k.engine.setSuspended(true);
      try {
        const settings = { container: 'mp4', videoCodec: 'avc', width: 540, height: 960, fps: 30, quality: 'high', audio: true, start: 0, end: k.engine.duration, hardware: 'no-preference', fastStart: false };
        await k.exporter.exportProject(p, settings, file, () => {}, new AbortController().signal);
        const still = file.replace(/\.mp4$/, '-still.png');
        await k.exporter.exportProject(p, { ...settings, container: 'png', start: frameTime, end: frameTime }, still, () => {}, new AbortController().signal);
        return { ok: true, still };
      } catch (e) {
        return { ok: false, error: String(e?.stack ?? e) };
      } finally {
        k.engine.setSuspended(false);
      }
    },
    { file: mp4, frameTime },
  );
  expect(exportRes.ok, `exported MP4 with captions ${exportRes.error ?? ''}`);
  // Decode the exported MP4 at the probe time and at a caption-free moment.
  const frames = await run(({ file, frameTime }) => window.__kinoraSpeech.debug.videoFrames(file, [frameTime, 0.05], 540, 960), { file: mp4, frameTime });
  writeFileSync(path.join(outDir, 'speech-07-export-frame.png'), Buffer.from(frames.frames[0].split(',')[1], 'base64'));
  writeFileSync(path.join(outDir, 'speech-07b-export-frame-start.png'), Buffer.from(frames.frames[1].split(',')[1], 'base64'));
  console.log('  frames .e2e/speech-07-export-frame.png, .e2e/speech-07b-export-frame-start.png');
  expect(frames.hasAudio, `exported MP4 has sound (${frames.duration.toFixed(2)} s)`);
  expect(frames.ink[0] > 0.002, 'the decoded MP4 frame shows the caption');
  // Same moment in the preview, rendered at the export size: must match the still export.
  const cmp = await run(
    async ({ still, frameTime }) => {
      const k = window.__kinora;
      k.useUI.getState().set({ previewQuality: 1 });
      k.engine.seek(frameTime);
      await new Promise((r) => setTimeout(r, 600));
      const snap = await k.engine.snapshot();
      const load = (src) => new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
      const a = await load(URL.createObjectURL(snap));
      const b = await load(window.kinora.media.toUrl(still));
      const W = 270;
      const H = 480;
      const px = (img) => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, W, H);
        return g.getImageData(0, 0, W, H).data;
      };
      const da = px(a);
      const db = px(b);
      let diff = 0;
      let ink = 0;
      for (let i = 0; i < da.length; i += 4) {
        diff += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (db[i] > 40 || db[i + 1] > 40 || db[i + 2] > 40) ink++;
      }
      return { mean: diff / (W * H * 3), ink: ink / (W * H) };
    },
    { still: exportRes.still, frameTime },
  );
  console.log(`  preview vs export: mean abs diff ${cmp.mean.toFixed(2)} (caption ink ${(cmp.ink * 100).toFixed(1)}%)`);
  expect(cmp.ink > 0.002, 'the exported frame contains the caption');
  expect(cmp.mean < 3, 'preview and export render the caption identically');
  await shot('speech-08-preview-at-export-frame');

  // ---- 6. Filler words -------------------------------------------------------------------------
  const fill = await openTool('speech.fillers');
  await fill.locator('.segmented button', { hasText: 'Whole timeline' }).click();
  await fill.locator('[data-action="find-fillers"]').click();
  await waitJob('filler search');
  const review = await run(() => window.__kinoraSpeech.store.getState().fillers);
  console.log(`  fillers: ${review.candidates.map((c) => `${c.text}@${c.start.toFixed(2)}`).join(', ')}`);
  expect(review.candidates.some((c) => /^um/i.test(c.text)), '"Um" found as a filler');
  await fill.locator('[data-filler="0"] .sp-item__body').click();
  await sleep(400);
  expect(await run(() => window.__kinora.engine.playing), 'clicking a filler previews it');
  await sleep(1500);
  await shot('speech-09-fillers');
  const durBefore = await run(() => window.__kinora.engine.duration);
  await fill.locator('[data-action="remove-fillers"]').click();
  await sleep(400);
  const durAfter = await run(() => window.__kinora.engine.duration);
  p = await project();
  const pieces = Object.values(p.clips).filter((c) => c.type === 'audio');
  expect(durAfter < durBefore - 0.1, `filler cut out (${(durBefore - durAfter).toFixed(2)} s shorter)`);
  expect(pieces.length >= 3, 'the voice clip was split around the filler');
  caps = await captions();
  expect(!caps.some((c) => /\bum\b/i.test(c.text)), 'the filler disappeared from the captions too');
  // Audio pieces stay in sync with their source: the second piece starts later in the source.
  const sorted = pieces.sort((a, b) => a.start - b.start);
  expect(sorted[1].trimIn > sorted[0].trimIn + sorted[0].duration - 1e-3, 'source in-points skip the removed audio');
  await win.keyboard.press('Control+z');
  await sleep(300);
  expect(Math.abs((await run(() => window.__kinora.engine.duration)) - durBefore) < 1e-3, 'one undo restores everything');
  await win.keyboard.press('Control+Shift+z');
  await sleep(300);
  expect(Math.abs((await run(() => window.__kinora.engine.duration)) - durAfter) < 1e-3, 'redo re-applies the cut');

  // ---- 7. Silences -----------------------------------------------------------------------------
  const sil = await openTool('audio.silence');
  await sil.locator('.segmented button', { hasText: 'Whole timeline' }).click();
  await sil.locator('[data-action="detect-silence"]').click();
  await waitJob('silence detection');
  const silences = await run(() => window.__kinoraSpeech.store.getState().silences);
  console.log(`  silences: ${silences.ranges.map((r) => `${r.start.toFixed(2)}–${r.end.toFixed(2)}`).join(', ')}`);
  const gap = silences.ranges.find((r) => r.end - r.start > 2.4);
  expect(!!gap, 'the 3 s gap between the voice-overs is detected');
  expect((await win.locator('.sp-silence.is-on').count()) === silences.ranges.length, 'silences are shown on the timeline');
  await shot('speech-10-silences');
  const beforeSil = await run(() => window.__kinora.engine.duration);
  await sil.locator('[data-action="remove-silences"]').click();
  await sleep(300);
  const afterSil = await run(() => window.__kinora.engine.duration);
  expect(beforeSil - afterSil > 2.4, `silences removed (${(beforeSil - afterSil).toFixed(2)} s)`);

  // ---- 5. SRT / VTT ----------------------------------------------------------------------------
  await run(() => window.__kinora.useUI.getState().clearSelection());
  const subs = await openTool('speech.subtitles');
  await subs.locator('[data-action="export-srt"]').click();
  await sleep(600);
  await subs.locator('[data-action="export-vtt"]').click();
  await sleep(600);
  p = await project();
  const srtFile = path.join(outDir, `${p.name}.srt`);
  const vttFile = path.join(outDir, `${p.name}.vtt`);
  expect(existsSync(srtFile) && existsSync(vttFile), 'SRT and VTT files written');
  const srt = readFileSync(srtFile, 'utf8');
  const vtt = readFileSync(vttFile, 'utf8');
  caps = await captions();
  expect(srt.includes('-->') && srt.split('-->').length - 1 === caps.length, `SRT has ${caps.length} cues`);
  expect(vtt.startsWith('WEBVTT'), 'VTT header present');
  const importCount = await run((file) => window.__kinoraSpeech.actions.importSubtitles(file), srtFile);
  caps = await captions();
  expect(importCount === caps.length, `SRT re-imported as ${importCount} captions (replacing, no duplicates)`);

  // ---- 8. Beats --------------------------------------------------------------------------------
  const musicIds = await run(async () => {
    const k = window.__kinora;
    k.engine.seek(0);
    return k.actions.addSound('music-upbeat-pop', { time: 0 });
  });
  await selectClip(musicIds[0]);
  const beats = await openTool('audio.beats');
  await beats.locator('[data-action="detect-beats"]').click();
  await waitJob('beat detection');
  p = await project();
  const beatMarkers = p.markers.filter((m) => m.label === 'Beat' || /^Bar \d+$/.test(m.label));
  const bars = beatMarkers.filter((m) => m.label.startsWith('Bar'));
  const gaps = beatMarkers.slice(1).map((m, i) => m.time - beatMarkers[i].time);
  const median = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  console.log(`  beats: ${beatMarkers.length}, bars: ${bars.length}, median spacing ${median.toFixed(3)} s (${(60 / median).toFixed(1)} BPM)`);
  expect(Math.abs(60 / median - 120) < 4, 'tempo of the 120 BPM bed found');
  expect(bars.length >= 3 && Math.abs(bars[1].time - bars[0].time - 2) < 0.1, 'downbeats every 4 beats');
  // Lay out four backgrounds one per beat.
  const genIds = await run(() => {
    const k = window.__kinora;
    const ids = [];
    for (const g of ['mesh-gradient', 'radial-glow', 'conic-sweep', 'gradient-flow']) ids.push(...k.actions.addGenerator(g, { time: 0, newTrack: true }));
    k.useUI.getState().select(ids);
    return ids;
  });
  await beats.locator('[data-action="sequence-beats"]').click();
  await sleep(300);
  p = await project();
  const placed = genIds.map((id) => p.clips[id]).sort((a, b) => a.start - b.start);
  const beatTimes = beatMarkers.map((m) => m.time);
  expect(placed.every((c) => beatTimes.some((t) => Math.abs(t - c.start) < 1e-3)), 'clips start exactly on beats');
  expect(placed.every((c, i) => i === 0 || Math.abs(c.start - (placed[i - 1].start + placed[i - 1].duration)) < 1e-3), 'one clip per beat, back to back');
  await shot('speech-11-beats');

  // ---- 9. Noise reduction ----------------------------------------------------------------------
  const noisy = await run(async (voiceId) => {
    const k = window.__kinora;
    const s = window.__kinoraSpeech;
    const p = k.useProjectStore.getState().project;
    const voice = p.clips[voiceId] ?? Object.values(p.clips).find((c) => c.type === 'audio' && !p.assets[c.assetId].source.soundId);
    const asset = p.assets[voice.assetId];
    const dec = await s.extract.decodeAsset(asset, 0, asset.duration, { sampleRate: 48000, channels: 1 });
    const ch = dec.channels[0];
    let seed = 11;
    for (let i = 0; i < ch.length; i++) ch[i] += 0.02 * (((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1);
    // WAV encoding (16-bit PCM) done here to keep the test independent from the app's helpers.
    const n = ch.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const ws = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    ws(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 48000, true);
    v.setUint32(28, 96000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    ws(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 32767, true);
    const info = await window.kinora.call('x:speech:saveAudio', 'audio', 'noisy voice', new Uint8Array(buf));
    const res = await k.assets.importMediaFiles([info]);
    const ids = k.actions.addAsset(res.assets[0], { time: 0, newTrack: true });
    return { clipId: ids[0], assetId: res.assets[0].id };
  }, sorted[0].id);
  await selectClip(noisy.clipId);
  const dn = await openTool('audio.denoise');
  await dn.locator('[data-action="denoise-preview"]').click();
  await waitJob('noise reduction preview');
  await sleep(500);
  await dn.locator('.segmented button', { hasText: 'A · Original' }).click();
  await sleep(600);
  await dn.locator('.segmented button', { hasText: 'B · Clean' }).click();
  await sleep(600);
  await shot('speech-12-denoise-ab');
  await dn.locator('[data-action="denoise-preview"]').click(); // stop
  await dn.locator('[data-action="denoise-apply"]').click();
  await waitJob('noise reduction');
  const dnRes = await run(async ({ clipId, assetId }) => {
    const k = window.__kinora;
    const s = window.__kinoraSpeech;
    const p = k.useProjectStore.getState().project;
    const clip = p.clips[clipId];
    const level = async (a) => {
      const d = await s.extract.decodeAsset(a, 0, Math.min(a.duration, 30), { sampleRate: 16000, channels: 1 });
      const x = d.channels[0];
      // Noise floor: the quietest 10 % of 20 ms frames.
      const frames = [];
      for (let i = 0; i + 320 <= x.length; i += 320) {
        let e = 0;
        for (let j = i; j < i + 320; j++) e += x[j] * x[j];
        frames.push(10 * Math.log10(e / 320 + 1e-12));
      }
      frames.sort((a, b) => a - b);
      return frames[Math.floor(frames.length * 0.1)];
    };
    return { swapped: clip.assetId !== assetId, newName: p.assets[clip.assetId].name, before: await level(p.assets[assetId]), after: await level(p.assets[clip.assetId]), trimIn: clip.trimIn };
  }, noisy);
  console.log(`  noise floor: ${dnRes.before.toFixed(1)} dB → ${dnRes.after.toFixed(1)} dB (${dnRes.newName})`);
  expect(dnRes.swapped, 'clip now uses the cleaned asset');
  expect(dnRes.before - dnRes.after > 10, 'noise floor reduced by more than 10 dB');
  await win.keyboard.press('Control+z');
  await sleep(300);
  p = await project();
  expect(p.clips[noisy.clipId].assetId === noisy.assetId, 'undo restores the original sound in one step');
  await run((id) => window.__kinora.useProjectStore.getState().update((p) => void delete p.clips[id]), noisy.clipId);

  // ---- 10. Auto-ducking ------------------------------------------------------------------------
  await selectClip(musicIds[0]);
  const duck = await openTool('audio.duck');
  await duck.locator('[data-action="auto-duck"]').click();
  await waitJob('auto-ducking');
  p = await project();
  const kfs = p.clips[musicIds[0]].keyframes?.volume ?? [];
  const minV = Math.min(...kfs.map((k) => k.v));
  console.log(`  ducking: ${kfs.length} keyframes, min ${(20 * Math.log10(minV)).toFixed(1)} dB`);
  expect(kfs.length >= 4 && Math.abs(20 * Math.log10(minV) + 12) < 0.6, 'music ducked by 12 dB under the speech');
  await run(() => window.__kinora.engine.seek(1.5));
  await sleep(400);
  await shot('speech-13-timeline');

  // ---- Transcript reuse: finding fillers right after captions needs no new transcription ----------
  await run(() => window.__kinora.useUI.getState().clearSelection());
  const reuse = await run(async () => {
    const s = window.__kinoraSpeech;
    await s.actions.autoCaptions('timeline');
    const t0 = performance.now();
    await s.actions.findFillers('timeline');
    return performance.now() - t0;
  });
  expect(reuse < 1500, `filler search reuses the caption transcript (${reuse.toFixed(0)} ms)`);

  // ---- Save, reopen: captions keep their words and highlight ----------------------------------------
  const reopened = await run(async () => {
    const k = window.__kinora;
    const ok = await k.projectIO.saveProject();
    const file = k.useProjectStore.getState().filePath;
    await k.projectIO.openProject(file);
    const p = k.useProjectStore.getState().project;
    const t = p.tracks.find((x) => x.role === 'captions');
    const caps = Object.values(p.clips).filter((c) => t && c.trackId === t.id);
    return { ok, file, count: caps.length, words: caps.every((c) => c.caption?.words?.length > 0), highlight: caps[0]?.caption?.highlight, beats: p.markers.length };
  });
  console.log(`  reopened: ${JSON.stringify(reopened)}`);
  expect(reopened.count > 0 && reopened.words && reopened.highlight === 'box', 'captions persist in the project file');

  // ---- Transcription benchmark: WASM vs WebGPU on the same audio ---------------------------------
  const bench = await run(async (musicId) => {
    const k = window.__kinora;
    const s = window.__kinoraSpeech;
    const p = k.useProjectStore.getState().project;
    // Speech only (the music bed is left out): the voice-overs, twice in a row (~35 s).
    const voices = Object.values(p.clips).filter((c) => c.type === 'audio' && c.id !== musicId);
    const end = Math.max(...voices.map((c) => c.start + c.duration));
    const one = (await s.extract.mixTimeline(p, 0, end, { sampleRate: 16000, channels: 1, only: new Set(voices.map((c) => c.id)) })).channels[0];
    const both = new Float32Array(one.length * 2);
    both.set(one, 0);
    both.set(one, one.length);
    const audio = { channels: [both], duration: both.length / 16000 };
    const out = { seconds: audio.duration };
    for (const device of ['wasm', 'webgpu']) {
      s.transcriber.disposeTranscriber();
      const t0 = performance.now();
      await s.transcriber.transcribe(audio.channels[0], { language: 'en', device });
      const cold = performance.now() - t0;
      const t1 = performance.now();
      const r = await s.transcriber.transcribe(audio.channels[0], { language: 'en', device });
      out[device] = { cold: Math.round(cold), warm: Math.round(performance.now() - t1), device: r.device, rtf: +(audio.duration / ((performance.now() - t1) / 1000)).toFixed(1) };
    }
    s.transcriber.disposeTranscriber();
    return out;
  }, musicIds[0]);
  console.log(`  benchmark (${bench.seconds.toFixed(1)} s audio): WASM cold ${bench.wasm.cold} ms / warm ${bench.wasm.warm} ms (${bench.wasm.rtf}× RT) · WebGPU cold ${bench.webgpu.cold} ms / warm ${bench.webgpu.warm} ms (${bench.webgpu.rtf}× RT)`);
  console.log(`  ONNX Runtime files fetched: ${[...ortFiles].join(', ') || '(none seen)'}`);
}
