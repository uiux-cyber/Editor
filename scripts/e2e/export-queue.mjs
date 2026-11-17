/**
 * Export feature test (presets, multi-aspect, queue, In / Out, transparency, captions). Drives the
 * real UI with mouse and keyboard, runs the background queue and verifies every output:
 *
 *  1. Builds a project: landscape footage (rendered by the app itself), an overlay that sits on
 *     an empty background, a sound and a captions track (text clips on a `role: 'captions'` track).
 *  2. Marks In / Out with I / O, drags the Out handle on the ruler, undoes, clears with Alt+X.
 *  3. Export dialog → transparent WebM (VP9 alpha) of the In–Out range, captions not burned in,
 *     SRT + VTT sidecars and an embedded WebVTT track; watched to completion in the dialog.
 *  4. Export dialog → PNG sequence of the range with captions burned in → "Add to queue".
 *  5. Export dialog → four platform presets in three aspects with framing previews → queue;
 *     keeps editing while the queue runs, cancels a running job and retries it.
 *  6. Re-imports and decodes every output: durations, sizes, aspect / reframing, alpha channel,
 *     burned-in vs hidden captions, sidecar contents and embedded subtitle tracks.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Parse SRT / VTT text into cues (seconds). */
function parseCues(text) {
  const out = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const t = (s) => {
      const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s.trim());
      return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
    };
    const [a, b] = lines[i].split('-->');
    out.push({ start: t(a), end: t(b), text: lines.slice(i + 1).join('\n') });
  }
  return out;
}

/** Width, height and colour type of a PNG file (IHDR). */
function pngInfo(file) {
  const b = readFileSync(file);
  if (b.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

export default async function exportQueue(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const mouse = win.mouse;
  const modal = win.locator('.modal');
  const NAME = 'Queue Test';

  // Start from a clean output folder for this scenario.
  for (const f of readdirSync(outDir)) if (f.startsWith(NAME) || f.startsWith('fixture-queue')) rmSync(path.join(outDir, f), { recursive: true, force: true });

  const project = () => run(() => window.__kinora.useProjectStore.getState().project);
  const jobs = () =>
    run(() =>
      window.__kinora.exportQueue.useExportQueue.getState().jobs.map((j) => ({ id: j.id, label: j.label, status: j.status, path: j.output.path, kind: j.output.kind, error: j.error ?? null, result: j.result ?? null, w: j.settings.width, h: j.settings.height })),
    );
  const waitFor = async (what, fn, timeout = 120000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
      await sleep(150);
    }
  };
  const elementShot = async (locator, name) => {
    const file = path.join(outDir, `${name}.png`);
    await locator.screenshot({ path: file });
    console.log(`  screenshot ${path.relative(ctx.root, file)}`);
  };

  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- 1. Fixture footage + project ----------------------------------------------------------
  const fixture = path.join(outDir, 'fixture-queue.mp4');
  await run(async (fixture) => {
    const k = window.__kinora;
    await k.projectIO.newProject({ name: 'Fixture', width: 1920, height: 1080, fps: 30 });
    const a = k.actions;
    a.addShape('rect', { time: 0 });
    a.editClips(k.useUI.getState().selection, (c) => {
      c.duration = 6;
      c.shape.width = 1920;
      c.shape.height = 1080;
      c.shape.radius = 0;
      c.shape.fill = { type: 'linear', angle: 20, stops: [{ offset: 0, color: '#ff5f6d' }, { offset: 1, color: '#ffc371' }] };
    });
    a.addText('gradient-title', { time: 0 });
    const p = k.useProjectStore.getState().project;
    const settings = { container: 'mp4', videoCodec: 'avc', width: 1920, height: 1080, fps: 30, quality: 'medium', audio: false, start: 0, end: 6, hardware: 'no-preference', fastStart: false };
    await k.exporter.exportProject(p, settings, fixture, () => {}, new AbortController().signal);
    k.useProjectStore.getState().markSaved(null);
  }, fixture);
  expect(existsSync(fixture), 'fixture footage rendered');

  await run(async ({ fixture, NAME }) => {
    const k = window.__kinora;
    await k.projectIO.newProject({ name: NAME, width: 1920, height: 1080, fps: 30 });
    const res = await k.assets.importMediaFiles(await window.kinora.fs.stat([fixture]));
    const a = k.actions;
    const store = k.useProjectStore.getState();
    a.addAsset(res.assets[0], { time: 0 });
    a.addShape('star', { time: 6 });
    a.editClips(k.useUI.getState().selection, (c) => {
      c.duration = 3;
      c.transform.x = -300;
      c.transform.y = -150;
      c.transform.scaleX = c.transform.scaleY = 0.8;
      c.shape.fill = { type: 'solid', color: '#22d3ee' };
    });
    await a.addSound('ding', { time: 1 });
    // Captions: text clips on a track with role 'captions'.
    store.update((p) => void p.tracks.unshift({ id: 'tr_captions', kind: 'visual', name: 'Captions', muted: false, hidden: false, locked: false, role: 'captions' }));
    for (const [text, start, duration] of [
      ['Hello and welcome', 0.5, 2],
      ['This part is transparent', 6.2, 1.2],
      ['Thanks for watching', 7.6, 1.2],
    ]) {
      const [id] = a.addText('subtitle-classic', { time: start });
      k.useProjectStore.getState().update((p) => {
        const c = p.clips[id];
        c.trackId = 'tr_captions';
        c.start = start;
        c.duration = duration;
        c.text.content = text;
        c.transform.y = 380;
      });
    }
    k.useUI.getState().clearSelection();
    k.engine.seek(1);
  }, { fixture, NAME });
  await win.waitForSelector('.timeline');
  await sleep(800);
  let p = await project();
  expect(Object.values(p.clips).filter((c) => c.trackId === 'tr_captions').length === 3 && Math.abs(Math.max(...Object.values(p.clips).map((c) => c.start + c.duration)) - 9) < 1e-6, 'project with footage, overlay, sound and a 3-cue captions track (9 s)');

  // ---- 2. In / Out marks ------------------------------------------------------------------------
  await win.keyboard.press('Shift+z'); // fit the timeline
  await run(() => document.activeElement?.blur());
  await run(() => window.__kinora.engine.seek(6));
  await win.keyboard.press('i');
  await run(() => window.__kinora.engine.seek(8));
  await win.keyboard.press('o');
  await sleep(200);
  p = await project();
  expect(p.inPoint === 6 && p.outPoint === 8, `I / O mark the playhead (in ${p.inPoint}, out ${p.outPoint})`);
  await win.waitForSelector('[data-inout] .io-band');
  const outHandle = win.locator('[data-handle="out"]');
  const hb = await outHandle.boundingBox();
  const pps = await run(() => window.__kinora.useUI.getState().pxPerSec);
  await mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await mouse.down();
  await mouse.move(hb.x + hb.width / 2 + pps * 0.25, hb.y + hb.height / 2, { steps: 4 });
  await mouse.move(hb.x + hb.width / 2 + pps * 0.5, hb.y + hb.height / 2, { steps: 4 });
  await mouse.up();
  await sleep(200);
  await elementShot(win.locator('.timeline'), '40-eq-inout-dragged');
  p = await project();
  expect(p.outPoint > 8.25 && p.outPoint < 8.75 && p.inPoint === 6, `dragging the Out handle on the ruler moves the Out point (${p.outPoint.toFixed(3)} s)`);
  await win.keyboard.press('Control+z');
  await sleep(200);
  p = await project();
  expect(p.outPoint === 8, 'one Ctrl+Z restores the Out point (the drag is a single undo step)');
  await win.keyboard.press('Alt+x');
  await sleep(150);
  p = await project();
  expect(p.inPoint === undefined && p.outPoint === undefined, 'Alt+X clears In / Out');
  await win.keyboard.press('Control+z');
  await sleep(150);
  p = await project();
  expect(p.inPoint === 6 && p.outPoint === 8, 'Ctrl+Z brings the marks back');
  await win.keyboard.press('Shift+i');
  expect((await run(() => window.__kinora.engine.time)) === 6, 'Shift+I jumps to the In point');
  await run(() => window.__kinora.engine.seek(7));
  await sleep(300);
  await elementShot(win.locator('.timeline'), '41-eq-inout');

  // ---- 3. Transparent WebM of the range, captions as files + embedded track -----------------
  await win.keyboard.press('Control+e');
  await modal.waitFor();
  await sleep(300);
  expect(await modal.locator('[data-range="inout"]').evaluate((el) => el.classList.contains('is-active')), 'the dialog starts on the marked In–Out range');
  const summary = await modal.locator('[data-range-summary]').innerText();
  expect(summary.includes('00:06:00') && summary.includes('00:08:00'), `range summary shows 06:00 → 08:00 (${summary.replace(/\s+/g, ' ')})`);
  expect((await modal.locator('[data-target].is-selected').count()) === 1 && (await modal.locator('[data-target="custom"].is-selected').count()) === 1, 'Custom is the default format');
  await modal.locator('.xd-card .field:has(.field__label:has-text("Transparent")) .toggle').click();
  expect((await modal.locator('.xd-card .field:has(.field__label:has-text("Format")) select').inputValue()) === 'webm-alpha', 'transparent background switches the format to WebM · VP9 with transparency');
  await modal.locator('.xd-row:has(.xd-row__label:has-text("Burn into the video")) .toggle').click();
  await modal.locator('[data-sidecar="srt"]').click();
  await modal.locator('[data-sidecar="vtt"]').click();
  await modal.locator('.xd-row:has(.xd-row__label:has-text("Embedded subtitles")) .toggle').click();
  await sleep(900);
  await shot('42-eq-dialog-transparent');
  await modal.locator('[data-export]').click();
  await win.waitForSelector('.export-done', { timeout: 120000 });
  await sleep(200);
  await shot('43-eq-transparent-done');
  await modal.locator('.btn--primary', { hasText: 'Done' }).click();
  const webm = path.join(outDir, `${NAME}.webm`);
  expect(existsSync(webm) && existsSync(path.join(outDir, `${NAME}.srt`)) && existsSync(path.join(outDir, `${NAME}.vtt`)), 'transparent WebM with SRT and VTT sidecars written');

  // ---- 4. PNG sequence of the range (captions burned in) → background queue ------------------
  await win.keyboard.press('Control+e');
  await modal.waitFor();
  await sleep(300);
  expect(await modal.locator('.xd-card .field:has(.field__label:has-text("Transparent")) .toggle').evaluate((el) => el.classList.contains('is-on')), 'the dialog remembers the last choices');
  await modal.locator('.xd-card .field:has(.field__label:has-text("Format")) select').selectOption('png-sequence');
  await modal.locator('.xd-row:has(.xd-row__label:has-text("Burn into the video")) .toggle').click();
  await modal.locator('[data-sidecar="vtt"]').click(); // keep SRT only
  await sleep(500);
  await modal.locator('[data-add-to-queue]').click();
  await win.waitForSelector('.modal', { state: 'detached' });
  await win.waitForSelector('[data-export-queue]');
  expect(true, '"Add to queue" closes the dialog and shows the queue in the title bar');

  // ---- 5. Four platform presets, three aspects → queue ------------------------------------------
  await run(() => window.__kinora.engine.seek(3));
  await win.keyboard.press('Control+e');
  await modal.waitFor();
  await sleep(300);
  await modal.locator('[data-range="all"]').click();
  await modal.locator('[data-target="custom"]').click();
  for (const id of ['youtube-1080p', 'tiktok', 'instagram-square', 'instagram-portrait']) await modal.locator(`[data-target="${id}"]`).click();
  expect((await modal.locator('[data-target].is-selected').count()) === 4, 'four presets selected');
  // Framing previews: one per output, each rendered from the adapted project.
  const previews = await waitFor(
    'framing previews',
    async () => {
      const r = await modal.locator('[data-preview-target] canvas').evaluateAll((els) =>
        els.map((c) => {
          // Read through a copy so the app's canvas is not flagged for repeated readbacks.
          const copy = document.createElement('canvas');
          copy.width = c.width;
          copy.height = c.height;
          const g = copy.getContext('2d', { willReadFrequently: true });
          g.drawImage(c, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let lit = 0;
          for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
          return { w: c.width, h: c.height, lit: lit / (d.length / 16) };
        }),
      );
      return r.length === 4 && r.every((x) => x.lit > 0.5) ? r : null;
    },
    20000,
  );
  const ratios = previews.map((x) => Math.round((x.w / x.h) * 100) / 100);
  expect([16 / 9, 9 / 16, 4 / 5, 1].every((r, i) => near(ratios[i], r, 0.025)), `framing previews rendered for 16:9, 9:16, 4:5 and 1:1 (${ratios.join(', ')}) and filled by the reframed footage`);
  expect((await modal.locator('[data-preview-target]:has-text("Reframed to fit")').count()) === 3, 'three previews are reframed, the 16:9 one keeps the original framing');
  expect((await modal.locator('[data-export]').innerText()).includes('Export 4 files'), 'the export button counts the files');
  await shot('44-eq-dialog-multi');
  await modal.locator('[data-export]').click();
  await win.waitForSelector('.xd-watch', { timeout: 20000 });
  await sleep(700);
  await shot('45-eq-watch');
  await modal.locator('[data-continue]').click();
  await win.waitForSelector('.modal', { state: 'detached' });

  // The editor stays usable while the queue runs.
  const markersBefore = (await project()).markers.length;
  await run(() => document.activeElement?.blur());
  await win.keyboard.press('m');
  await sleep(150);
  expect((await project()).markers.length === markersBefore + 1, 'editing works while exports run (M adds a marker)');
  await run(() => {
    window.__kinora.engine.seek(0);
    window.__kinora.engine.play();
  });
  await sleep(700);
  const playing = await run(() => ({ playing: window.__kinora.engine.playing, time: window.__kinora.engine.time }));
  await run(() => window.__kinora.engine.pause());
  expect(playing.playing && playing.time > 0.2, `the live preview keeps playing while exporting (t=${playing.time.toFixed(2)} s)`);

  // Queue popover from the title bar; cancel the last export while it runs, then retry it.
  await win.locator('[data-export-queue]').click();
  await win.waitForSelector('.xq-pop');
  const pctText = await win.locator('.xq-btn__pct').innerText();
  expect(/%$/.test(pctText), `title bar shows the total progress (${pctText})`);
  const lastRow = win.locator('.xq-pop [data-job]:has-text("Instagram feed 1:1")');
  await waitFor('the last job to start', async () => (await lastRow.getAttribute('data-status')) === 'running', 120000);
  await shot('46-eq-queue-running');
  await lastRow.locator('[data-action="cancel"]').click();
  await waitFor('the job to be cancelled', async () => (await lastRow.getAttribute('data-status')) === 'cancelled', 30000);
  let list = await jobs();
  const lastPath = list.find((j) => j.label === 'Instagram feed 1:1').path;
  await sleep(300);
  expect(!existsSync(lastPath), 'cancelling a running export removes its unfinished file');
  // "Paused (faster)" suspends the live preview while the queue runs.
  await win.locator('.xq-pop__foot .segmented button', { hasText: 'Paused' }).click();
  await lastRow.locator('[data-action="retry"]').click();
  await run(() => window.__kinora.engine.play());
  const suspended = await run(() => window.__kinora.engine.playing);
  expect(!suspended, 'with "Paused (faster)" the preview does not play while exporting');
  await win.locator('.xq-pop__foot .segmented button', { hasText: 'Live' }).click();
  await waitFor('the queue to finish', async () => (await jobs()).every((j) => j.status === 'done' || j.status === 'failed'), 240000);
  list = await jobs();
  const failed = list.filter((j) => j.status !== 'done');
  expect(failed.length === 0, `every queued export finished (${list.length} jobs${failed.length ? `, failed: ${JSON.stringify(failed)}` : ''})`);
  for (const j of list) console.log(`    ${j.label.padEnd(30)} ${j.w}×${j.h}  ${(j.result.bytes / 1e6).toFixed(2)} MB  ${j.result.frames} frames in ${j.result.seconds.toFixed(1)} s`);
  await sleep(400);
  await shot('47-eq-queue-done');
  await win.keyboard.press('Escape');

  // ---- 6. Verify every output ------------------------------------------------------------------
  const importInfo = (file) =>
    run(async (file) => {
      const k = window.__kinora;
      const res = await k.assets.importMediaFiles(await window.kinora.fs.stat([file]));
      const a = res.assets[0];
      if (!a) return { error: JSON.stringify(res.failures) };
      let transparent = false;
      try {
        const input = k.assets.openInput(a);
        const track = await input.getPrimaryVideoTrack();
        transparent = !!track && (await track.canBeTransparent());
        input.dispose();
      } catch {
        /* not a video */
      }
      return { duration: a.duration, width: a.width, height: a.height, hasAudio: a.hasAudio, videoCodec: a.videoCodec, transparent };
    }, file);

  /** Decode a frame with Chromium's own decoder and sample it. */
  const sample = (file, time, kind) =>
    run(
      async ({ file, time, kind }) => {
        const url = window.kinora.media.toUrl(file);
        let source;
        let w;
        let h;
        if (kind === 'image') {
          const blob = await (await fetch(url)).blob();
          source = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
          w = source.width;
          h = source.height;
        } else {
          const v = document.createElement('video');
          v.crossOrigin = 'anonymous';
          v.muted = true;
          v.preload = 'auto';
          v.src = url;
          await new Promise((res, rej) => {
            v.onloadeddata = res;
            v.onerror = () => rej(new Error('video decode error'));
          });
          v.currentTime = time;
          await new Promise((res) => (v.onseeked = res));
          source = v;
          w = v.videoWidth;
          h = v.videoHeight;
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(source, 0, 0);
        const px = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data);
        // Caption band: the captions sit 380 design px below the middle of a 16:9 frame and move
        // proportionally in reframed outputs (pixel offset = 380 × height / 1080).
        const k = Math.min(w, h) / 1080;
        const capY = h / 2 + (380 * h) / 1080;
        let capAlpha = 0;
        let capLuma = 0;
        for (let y = capY - 34; y < capY + 34; y += 3) {
          const row = g.getImageData(0, Math.round(y), w, 1).data;
          for (let i = 0; i < row.length; i += 4) {
            capAlpha = Math.max(capAlpha, row[i + 3]);
            if (row[i + 3] > 0) capLuma = Math.max(capLuma, (row[i] + row[i + 1] + row[i + 2]) / 3);
          }
        }
        // Mean brightness of the top and bottom rows (black when letterboxed).
        const rowLuma = (y) => {
          const row = g.getImageData(0, y, w, 1).data;
          let s = 0;
          for (let i = 0; i < row.length; i += 4) s += (row[i] + row[i + 1] + row[i + 2]) / 3;
          return s / (row.length / 4);
        };
        return { w, h, corner: px(12, 12), star: px(w / 2 - 300 * k, h / 2 - 150 * k), capAlpha, capLuma, top: rowLuma(8), bottom: rowLuma(h - 8) };
      },
      { file, time, kind },
    );

  // Transparent WebM.
  const tw = await importInfo(webm);
  expect(!tw.error && near(tw.duration, 2, 0.1) && tw.width === 1920 && tw.height === 1080 && tw.videoCodec === 'vp9', `transparent WebM: 2 s, 1920×1080 VP9 (${JSON.stringify(tw)})`);
  expect(tw.transparent, 'the WebM video track carries an alpha channel');
  const ts = await sample(webm, 0.8, 'video');
  expect(ts.corner[3] === 0, `decoded WebM frame is see-through where no layer covers it (corner alpha ${ts.corner[3]})`);
  expect(ts.star[3] > 240, `…and opaque on the overlay (alpha ${ts.star[3]})`);
  expect(ts.capAlpha === 0, 'captions are not burned in when "Burn into the video" is off');
  const webmBytes = readFileSync(webm).toString('latin1');
  expect(webmBytes.includes('S_TEXT/WEBVTT') && webmBytes.includes('This part is transparent'), 'the WebM embeds a WebVTT subtitle track with the cues');
  const expectRange = [
    { start: 0.2, end: 1.4, text: 'This part is transparent' },
    { start: 1.6, end: 2, text: 'Thanks for watching' },
  ];
  const sameCues = (a, b) => a.length === b.length && a.every((c, i) => near(c.start, b[i].start, 0.002) && near(c.end, b[i].end, 0.002) && c.text === b[i].text);
  const srt = parseCues(readFileSync(path.join(outDir, `${NAME}.srt`), 'utf8'));
  const vttText = readFileSync(path.join(outDir, `${NAME}.vtt`), 'utf8');
  expect(sameCues(srt, expectRange), `SRT sidecar holds the range's cues re-based to 0 (${JSON.stringify(srt)})`);
  expect(vttText.startsWith('WEBVTT') && sameCues(parseCues(vttText), expectRange), 'VTT sidecar matches');

  // PNG sequence.
  const seqDir = path.join(outDir, `${NAME} - PNG sequence`);
  const frames = readdirSync(seqDir).filter((f) => f.endsWith('.png')).sort();
  expect(frames.length === 60 && frames[0] === `${NAME} - PNG sequence_00000.png` && frames[59].endsWith('_00059.png'), `PNG sequence: 60 numbered frames for the 2 s range (${frames.length})`);
  const info = pngInfo(path.join(seqDir, frames[24]));
  expect(info.width === 1920 && info.height === 1080 && info.colorType === 6, `frames are 1920×1080 RGBA PNGs (${JSON.stringify(info)})`);
  const fs24 = await sample(path.join(seqDir, frames[24]), 0, 'image');
  expect(fs24.corner[3] === 0 && fs24.star[3] === 255, `PNG frame keeps transparency (corner ${fs24.corner[3]}, overlay ${fs24.star[3]})`);
  expect(fs24.capAlpha > 200, `captions are burned in when the option is on (caption alpha ${fs24.capAlpha})`);
  const seqSrt = parseCues(readFileSync(path.join(seqDir, `${NAME} - PNG sequence.srt`), 'utf8'));
  expect(sameCues(seqSrt, expectRange), 'the sequence folder holds its SRT');

  // Platform presets.
  const expected = [
    { file: `${NAME} - YouTube 1080p 16x9.mp4`, w: 1920, h: 1080 },
    { file: `${NAME} - TikTok 9x16.mp4`, w: 1080, h: 1920 },
    { file: `${NAME} - Instagram feed 4x5.mp4`, w: 1080, h: 1350 },
    { file: `${NAME} - Instagram feed 1x1.mp4`, w: 1080, h: 1080 },
  ];
  const timeline = [
    { start: 0.5, end: 2.5, text: 'Hello and welcome' },
    { start: 6.2, end: 7.4, text: 'This part is transparent' },
    { start: 7.6, end: 8.8, text: 'Thanks for watching' },
  ];
  for (const e of expected) {
    const file = path.join(outDir, e.file);
    const v = await importInfo(file);
    expect(!v.error && near(v.duration, 9, 0.15) && v.width === e.w && v.height === e.h && v.hasAudio && v.videoCodec === 'avc', `${e.file}: 9 s, ${e.w}×${e.h}, H.264 + audio (${JSON.stringify(v)})`);
    const f = await sample(file, 3, 'video');
    expect(f.top > 20 && f.bottom > 20, `…the footage fills the ${e.w}×${e.h} frame with no bars (edge brightness ${f.top.toFixed(0)} / ${f.bottom.toFixed(0)})`);
    const c = await sample(file, 6.8, 'video');
    expect(c.capLuma > 180, `…captions are burned in (caption brightness ${c.capLuma.toFixed(0)})`);
    const bytes = readFileSync(file).toString('latin1');
    expect(bytes.includes('wvtt') && bytes.includes('Thanks for watching'), '…an embedded WebVTT (wvtt) track holds the captions');
    expect(bytes.indexOf('moov') > 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'), '…and the index (moov) comes first for fast start');
    const side = parseCues(readFileSync(file.replace(/\.mp4$/, '.srt'), 'utf8'));
    expect(sameCues(side, timeline), '…and the SRT sidecar has the timeline cues');
    expect(!existsSync(file.replace(/\.mp4$/, '.vtt')), '…without a VTT (not requested)');
  }
  expect(statSync(path.join(outDir, `${NAME} - Instagram feed 1x1.mp4`)).size > 100000, 'the retried export completed');

  // ---- Selected clips range ---------------------------------------------------------------------
  await run(() => {
    const k = window.__kinora;
    const p = k.useProjectStore.getState().project;
    const star = Object.values(p.clips).find((c) => c.type === 'shape');
    k.useUI.getState().select([star.id]);
  });
  await win.keyboard.press('Control+e');
  await modal.waitFor();
  await modal.locator('[data-range="selection"]').click();
  const sel = await modal.locator('[data-range-summary]').innerText();
  expect(sel.includes('00:06:00') && sel.includes('00:09:00'), `"Selected clips" uses the selection's span (${sel.replace(/\s+/g, ' ')})`);
  await win.keyboard.press('Escape');
  await win.waitForSelector('.modal', { state: 'detached' });

  // Dialog choices are stored in the user settings for the next session.
  const prefs = await run(() => window.kinora.settings.get('export.prefs'));
  expect(JSON.stringify(prefs?.selected) === JSON.stringify(['youtube-1080p', 'tiktok', 'instagram-square', 'instagram-portrait']) && prefs?.burnInCaptions === true && JSON.stringify(prefs?.sidecars) === '["srt"]', `export choices are remembered in the settings (${JSON.stringify(prefs?.selected)})`);

  // Saved projects keep their marks.
  const saved = await run(async () => {
    const k = window.__kinora;
    await k.projectIO.saveProject();
    const file = k.useProjectStore.getState().filePath;
    k.useUI.getState().set({ screen: 'home' });
    await k.projectIO.openProject(file);
    const p = k.useProjectStore.getState().project;
    return { inPoint: p.inPoint, outPoint: p.outPoint };
  });
  expect(saved.inPoint === 6 && saved.outPoint === 8, 'In / Out survive save and reopen');

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
