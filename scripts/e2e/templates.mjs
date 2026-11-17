/**
 * Templates & branding, driven through the real UI:
 *  1. Save a selection as a template (media → placeholder), re-apply it, rename / duplicate /
 *     delete it.
 *  2. Set up a brand kit (name, colours, fonts, a generated logo), switch "Use my brand" on and
 *     check that gallery thumbnails use the brand colours and applied templates get the logo.
 *  3. Apply a template with music: one audio clip trimmed to the template with fades, one undo step.
 *  4. Install content packs: a malicious one is rejected, the sample pack is installed and its
 *     filter, transition, text style and template are used.
 *  5. Start a project from a branded template with music on the Home screen, export it and
 *     verify the video, the picture (brand background + logo) and the sound.
 */
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const BRAND = { primary: 'e63946', secondary: '457b9d', accent: 'f4a261', background: '0b1d2a', text: 'f1faee' };
const LOGO_RGB = [255, 136, 0];

export default async function templates(ctx) {
  const { win, shot, run, sleep, outDir, root } = ctx;
  const k = () => window.__kinora;
  void k;
  const project = () =>
    run(() => {
      const kk = window.__kinora;
      const p = kk.useProjectStore.getState().project;
      return {
        clips: Object.values(p.clips),
        assets: p.assets,
        transitions: Object.values(p.transitions),
        selection: kk.useUI.getState().selection,
        past: kk.useProjectStore.getState().past.length,
        txn: !!kk.useProjectStore.getState().txnBase,
      };
    });
  const tab = async (name) => {
    await win.click(`.rail__btn[data-tab="${name}"]`);
    await sleep(500);
  };
  const waitFor = async (fn, what, timeout = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
      await sleep(150);
    }
  };
  const call = (channel, ...args) => run(({ channel, args }) => window.kinora.call(channel, ...args), { channel, args });
  /** Click a template tile at the end of the timeline; returns the project and the new clips. */
  const applyTile = async (locator, withAudio) => {
    const before = new Set((await project()).clips.map((c) => c.id));
    const at = await run(() => {
      const kk = window.__kinora;
      kk.engine.seek(kk.engine.duration);
      return kk.engine.time;
    });
    await locator.click();
    const res = await waitFor(async () => {
      const s = await project();
      const fresh = s.clips.filter((c) => !before.has(c.id));
      if (!fresh.length || s.txn || (withAudio && !fresh.some((c) => c.type === 'audio'))) return null;
      return { p: s, fresh, at };
    }, 'the template layers');
    if (!withAudio) await sleep(1200);
    const s = await project();
    return { p: s, fresh: s.clips.filter((c) => !before.has(c.id)), at };
  };
  const search = async (text) => {
    await win.locator('.lib__search input').fill(text);
    await sleep(700);
  };

  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- Fixtures: a logo (transparent PNG, orange mark) and a photo, drawn in the renderer --------
  const logoFile = path.join(outDir, 'e2e-pick-logo.png');
  const photoFile = path.join(outDir, 'templates-photo.png');
  await run(
    async ({ logoFile, photoFile, logoRgb }) => {
      const png = async (w, h, draw) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        draw(c.getContext('2d'));
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        return new Uint8Array(await blob.arrayBuffer());
      };
      const logo = await png(480, 240, (g) => {
        g.fillStyle = `rgb(${logoRgb.join(',')})`;
        g.beginPath();
        g.roundRect(8, 8, 224, 224, 48);
        g.fill();
        g.fillStyle = '#ffffff';
        g.font = 'bold 150px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('K', 120, 128);
        g.fillStyle = `rgb(${logoRgb.join(',')})`;
        g.font = 'bold 92px sans-serif';
        g.textAlign = 'left';
        g.fillText('KIN', 248, 128);
      });
      const photo = await png(1280, 720, (g) => {
        const gr = g.createLinearGradient(0, 0, 1280, 720);
        gr.addColorStop(0, '#2b6cb0');
        gr.addColorStop(1, '#f6ad55');
        g.fillStyle = gr;
        g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#ffffffaa';
        g.beginPath();
        g.arc(900, 260, 140, 0, Math.PI * 2);
        g.fill();
      });
      await window.kinora.fs.writeFile(logoFile, logo);
      await window.kinora.fs.writeFile(photoFile, photo);
    },
    { logoFile, photoFile, logoRgb: LOGO_RGB },
  );
  expect(existsSync(logoFile) && existsSync(photoFile), 'logo and photo fixtures generated');

  // =============================================================================================
  // 1. Save as template
  // =============================================================================================
  await win.click('.format-card >> nth=0');
  await win.waitForSelector('.timeline');
  const designIds = await run(async (photoFile) => {
    const kk = window.__kinora;
    const a = kk.actions;
    const [asset] = (await kk.assets.importMediaFiles(await window.kinora.fs.stat([photoFile]))).assets;
    kk.engine.seek(0);
    a.addGenerator('aurora', { time: 0 });
    const bg = kk.useUI.getState().selection[0];
    a.addAsset(asset, { newTrack: true, time: 0.5 });
    const photo = kk.useUI.getState().selection[0];
    a.editClips([photo], (c) => {
      c.duration = 4;
      c.transform.scaleX = c.transform.scaleY = 0.45;
      c.transform.x = -420;
    });
    kk.engine.seek(0.8);
    a.addText('gradient-title', { time: 0.8 });
    const title = kk.useUI.getState().selection[0];
    a.editClips([title], (c) => {
      c.text.content = 'Weekend Market';
      c.text.fontSize = 104;
      c.transform.x = 400;
      c.duration = 4;
    });
    kk.useUI.getState().select([bg, photo, title]);
    return { bg, photo, title };
  }, photoFile);
  await tab('templates');
  await sleep(800);
  expect(await win.locator('[data-testid=save-as-template]').isVisible(), 'the Templates tab offers “Save as template…” for the selection');
  await win.click('[data-testid=save-as-template]');
  await win.waitForSelector('.modal .tpl-save');
  await win.locator('[data-testid=template-name]').fill('E2E Market Promo');
  await win.locator('.modal select.select').first().selectOption('promo');
  await win.locator('[data-testid=template-tags]').fill('market, weekend');
  await sleep(900);
  await shot('t01-save-dialog');
  await win.click('[data-testid=save-template]');
  await win.waitForSelector('.modal .tpl-save', { state: 'detached' });
  await sleep(600);
  const stored = await call('x:templates:list');
  expect(stored.length === 1, 'the template is stored in userData/templates');
  const tpl = stored[0].json;
  expect(tpl.name === 'E2E Market Promo' && tpl.category === 'promo' && tpl.tags.join() === 'market,weekend', 'name, category and tags are saved');
  expect(!!stored[0].poster && existsSync(stored[0].poster), 'a poster thumbnail was rendered next to it');
  const slots = tpl.clips.filter((c) => c.type === 'shape' && c.shape.slot);
  expect(slots.length === 1 && !tpl.clips.some((c) => c.type === 'image'), 'the photo became a placeholder (no media reference)');
  expect(Math.min(...tpl.clips.map((c) => c.start)) === 0, 'times are relative to the template start');

  // "My templates" chip, re-apply at another time.
  const mineChip = win.locator('.lib__chips .chip', { hasText: 'My templates' });
  expect(await mineChip.isVisible(), 'a “My templates” chip appears first');
  await mineChip.click();
  await sleep(1200);
  await shot('t02-my-templates');
  const before = (await project()).clips.length;
  const mine = await applyTile(win.locator('.tile--mine').first(), false);
  let p = mine.p;
  const added = mine.fresh;
  expect(added.length === tpl.clips.length && Math.abs(Math.min(...added.map((c) => c.start)) - mine.at) < 0.02, `applying inserts every layer at the playhead (${added.length} layers at ${mine.at.toFixed(2)} s)`);
  expect(new Set(added.map((c) => c.groupId)).size === 1, 'the inserted layers are grouped');
  expect(added.some((c) => c.type === 'shape' && c.shape.slot), 'the placeholder is ready for new media');
  await win.locator('.stage__overlay').click({ position: { x: 5, y: 5 } });
  await win.keyboard.press('Control+z');
  await sleep(400);
  expect((await project()).clips.length === before, 'one Ctrl+Z removes the whole template');

  // Rename / duplicate / delete through the tile menu.
  await win.locator('.tile--mine').first().hover();
  await win.locator('.tile--mine .tile__action').first().click();
  await win.locator('.menu__item', { hasText: 'Rename' }).click();
  await win.locator('[data-testid=rename-input]').fill('Market Promo');
  await win.click('[data-testid=rename-save]');
  await sleep(700);
  expect((await call('x:templates:list'))[0].json.name === 'Market Promo', 'rename updates the stored template');
  expect(await win.locator('.tile--mine', { hasText: 'Market Promo' }).isVisible(), 'the gallery shows the new name');
  await win.locator('.tile--mine').first().hover();
  await win.locator('.tile--mine .tile__action').first().click();
  await win.locator('.menu__item', { hasText: 'Duplicate' }).click();
  await sleep(900);
  expect((await call('x:templates:list')).length === 2 && (await win.locator('.tile--mine').count()) === 2, 'duplicate adds a copy');
  const copy = win.locator('.tile--mine', { hasText: 'copy' });
  await copy.click({ button: 'right' });
  await win.locator('.menu__item', { hasText: 'Delete' }).click();
  await sleep(300);
  await shot('t03-delete-confirm');
  await win.click('[data-testid=confirm-delete]');
  await sleep(800);
  expect((await call('x:templates:list')).length === 1 && (await win.locator('.tile--mine').count()) === 1, 'delete removes the copy (and only the copy)');

  // =============================================================================================
  // 2. Brand kit
  // =============================================================================================
  await win.locator('.lib__chips .chip', { hasText: 'All' }).click();
  await win.click('[data-testid=open-brand-kit]');
  await win.waitForSelector('.modal .brand-kit');
  await win.locator('[data-testid=brand-name]').fill('Kinetic Labs');
  for (const [key, hex] of Object.entries(BRAND)) {
    const input = win.locator(`.brand-color[data-color="${key}"] input.input`);
    await input.click();
    await input.fill(hex);
    await input.press('Enter');
    await sleep(120);
  }
  const fonts = win.locator('.brand-font .font-picker');
  await fonts.nth(0).click();
  await win.locator('.font-panel input').fill('Oswald');
  await win.locator('.font-item', { hasText: 'Oswald' }).click();
  await fonts.nth(1).click();
  await win.locator('.font-panel input').fill('Rubik');
  await win.locator('.font-item', { hasText: 'Rubik' }).click();
  await win.click('[data-testid=brand-add-logo]');
  await win.waitForSelector('.brand-logo img');
  await sleep(1500);
  const contrastRows = await win.locator('.brand-contrast__row').count();
  expect(contrastRows === 6, 'live contrast checks are shown');
  await win.locator('.brand-preview__item').first().hover();
  await sleep(1200);
  await shot('t04-brand-kit');
  const { kit } = await call('x:brand:get');
  expect(kit && kit.name === 'Kinetic Labs' && kit.colors.primary === `#${BRAND.primary}` && kit.colors.background === `#${BRAND.background}`, 'name and colours are saved to userData/brand');
  expect(kit.heading.family === 'Oswald' && kit.body.family === 'Rubik', 'heading and body fonts are saved');
  expect(kit.logos.length === 1 && /[\\/]brand[\\/]logos[\\/]/.test(kit.logos[0].path) && existsSync(kit.logos[0].path), 'the logo was copied into userData/brand/logos');
  await win.click('[data-testid=brand-use-toggle] button.toggle');
  await win.locator('.modal .btn--primary', { hasText: 'Done' }).click();
  await sleep(2000);

  // Brand thumbnails: the gallery tiles are painted with the brand background.
  const navy = [0x0b, 0x1d, 0x2a];
  const tileShare = await run((rgb) => {
    const canvases = [...document.querySelectorAll('.tile--template canvas')].slice(0, 6);
    return canvases.map((c) => {
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let near = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) < 90) near++;
      return near / (d.length / 4);
    });
  }, navy);
  console.log(`  brand-background share per tile: ${tileShare.map((x) => x.toFixed(2)).join(' ')}`);
  expect(tileShare.filter((x) => x > 0.15).length >= 3, 'gallery thumbnails render with the brand colours');
  await shot('t05-brand-gallery');

  await search('logo reveal');
  await sleep(1500);
  await shot('t06-brand-logo-tile');
  const revealRes = await applyTile(win.locator('.tile--template').first(), true);
  p = revealRes.p;
  const reveal = revealRes.fresh;
  const logoClip = reveal.find((c) => c.type === 'image');
  expect(!!logoClip && p.assets[logoClip.assetId]?.source.path === kit.logos[0].path, 'the Logo placeholder is filled with the brand logo');
  const texts = reveal.filter((c) => c.type === 'text');
  expect(texts.some((t) => t.text.fontFamily === 'Oswald') && texts.some((t) => t.text.fontFamily === 'Rubik'), 'texts use the brand heading and body fonts');
  await run((t) => {
    window.__kinora.useUI.getState().clearSelection();
    window.__kinora.engine.seek(t);
  }, revealRes.at + 3.2);
  await sleep(1200);
  await shot('t07-brand-applied');

  // =============================================================================================
  // 3. Music
  // =============================================================================================
  await search('flash sale');
  await sleep(800);
  expect(await win.locator('.tile--template .tile__music').first().isVisible(), 'templates with music show a music badge');
  const pastBefore = (await project()).past;
  const countBefore = (await project()).clips.length;
  const saleRes = await applyTile(win.locator('.tile--template').first(), true);
  p = saleRes.p;
  const sale = saleRes.fresh;
  const music = sale.find((c) => c.type === 'audio');
  const musicAsset = p.assets[music.assetId];
  const layers = sale.filter((c) => c.type !== 'audio');
  const end = Math.max(...layers.map((c) => c.start + c.duration));
  console.log(`  music: ${musicAsset.name} ${music.duration.toFixed(2)}s vol=${music.volume} fades=${music.fadeIn}/${music.fadeOut}`);
  expect(musicAsset.source.type === 'generated' && musicAsset.source.soundId === 'music-funk-groove', 'the template’s music bed is added as a synthesised sound');
  expect(Math.abs(music.start - saleRes.at) < 0.02 && Math.abs(music.start + music.duration - end) < 0.05, 'the music is trimmed to the template length');
  expect(music.fadeIn > 0 && music.fadeOut > 0, 'the music fades in and out');
  expect(music.groupId && layers.every((c) => c.groupId === music.groupId), 'music and layers form one group');
  expect(p.past === pastBefore + 1, 'layers and music are a single undo step');
  await shot('t08-music-applied');
  await win.locator('.stage__overlay').click({ position: { x: 5, y: 5 } });
  await win.keyboard.press('Control+z');
  await sleep(400);
  p = await project();
  expect(p.clips.length === countBefore, 'one Ctrl+Z removes layers and music together');
  // Music switched off: the same template adds no audio.
  await win.click('[data-testid=include-music] button.toggle');
  await sleep(200);
  const silent = await applyTile(win.locator('.tile--template').first(), false);
  expect(silent.fresh.length > 0 && !silent.fresh.some((c) => c.type === 'audio'), '“Music” off applies the layers only');
  await win.keyboard.press('Control+z');
  await win.click('[data-testid=include-music] button.toggle');
  await sleep(200);

  // =============================================================================================
  // 4. Content packs
  // =============================================================================================
  const pick = path.join(outDir, 'e2e-pick.kinorapack');
  writeFileSync(
    pick,
    JSON.stringify({
      format: 'kinora-pack',
      version: 1,
      id: 'evil-pack',
      name: 'Evil pack',
      effects: [{ id: 'evil-hang', name: 'Hang', category: 'color', glsl: 'vec4 effect(vec2 uv){ while (true) {} return tex(uv); }', params: [] }],
    }),
  );
  await win.click('[data-testid=templates-menu]');
  await win.locator('.menu__item', { hasText: 'Install content pack' }).click();
  await win.waitForSelector('[data-testid=pack-errors]');
  await sleep(300);
  await shot('t09-pack-rejected');
  const errText = await win.locator('[data-testid=pack-errors]').innerText();
  expect(/while loops/.test(errText), 'a pack with an unsafe shader is rejected with a readable reason');
  expect((await call('x:packs:list')).length === 0, 'nothing was installed');
  copyFileSync(path.join(root, 'resources/packs/sample.kinorapack'), pick);
  await win.click('[data-testid=install-pack]');
  await win.waitForSelector('[data-pack="kinora-sample"]');
  await sleep(500);
  await shot('t10-pack-installed');
  const packs = await call('x:packs:list');
  expect(packs.length === 1 && packs[0].file.endsWith('kinora-sample.kinorapack'), 'the sample pack is copied to userData/packs');
  await win.locator('.modal .btn--primary', { hasText: 'Done' }).click();
  await sleep(300);

  // Two adjacent clips to use the pack's filter and transition on.
  const pair = await run(() => {
    const kk = window.__kinora;
    const a = kk.actions;
    kk.engine.seek(60);
    a.addGenerator('aurora', { time: 60, newTrack: true });
    const first = kk.useUI.getState().selection[0];
    const track = kk.useProjectStore.getState().project.clips[first].trackId;
    a.addGenerator('stripes', { time: 65, trackId: track });
    const second = kk.useUI.getState().selection[0];
    kk.useProjectStore.getState().update((pp) => {
      pp.clips[first].duration = 5;
      pp.clips[second].start = 65;
    });
    kk.useUI.getState().select([first]);
    return { first, second };
  });
  await tab('filters');
  await search('amber');
  expect(await win.locator('.lib .tile', { hasText: 'Amber Glow' }).isVisible(), 'the Filters gallery lists the pack filter');
  await win.locator('.lib .tile', { hasText: 'Amber Glow' }).click();
  await sleep(300);
  p = await project();
  expect(p.clips.find((c) => c.id === pair.first).filter?.id === 'kinora-sample-amber-glow', 'the pack filter applies to the selected clip');
  await tab('transitions');
  await search('diagonal');
  await shot('t11-pack-transition');
  await win.locator('.lib .tile', { hasText: 'Diagonal Blinds' }).click();
  await sleep(300);
  p = await project();
  expect(p.transitions.some((t) => t.type === 'kinora-sample-diagonal-blinds'), 'the pack transition is added on the cut');
  await run(() => window.__kinora.engine.seek(64.9));
  await sleep(900);
  await shot('t12-pack-transition-preview');
  await tab('text');
  await search('ribbon');
  await win.locator('.lib .tile', { hasText: 'Ribbon Title' }).click();
  await sleep(400);
  p = await project();
  const ribbon = p.clips.find((c) => c.type === 'text' && c.text.content === 'Summer Sale');
  expect(!!ribbon && ribbon.text.fontFamily === 'Anton', 'the pack text style adds a styled title');

  // Apply brand to selection (inspector section).
  await win.locator('.tabs__tab').first().click();
  await sleep(300);
  const brandBtn = win.locator('[data-section="brand-template"] button', { hasText: 'Apply brand' });
  await brandBtn.scrollIntoViewIfNeeded();
  await brandBtn.click();
  await sleep(300);
  p = await project();
  const branded = p.clips.find((c) => c.id === ribbon.id);
  expect(branded.text.fontFamily === 'Oswald', '“Apply brand” restyles the selection with the brand heading font');
  expect(branded.text.background?.color === `#${BRAND.primary}` && branded.text.fill.type === 'solid' && branded.text.fill.color !== ribbon.text.fill.color, '…and the brand colours (ribbon in the primary colour, readable text on it)');
  await shot('t13-apply-brand');

  await tab('templates');
  await search('spotlight card');
  await sleep(800);
  const cardRes = await applyTile(win.locator('.tile--template').first(), true);
  p = cardRes.p;
  const card = cardRes.fresh;
  expect(card.some((c) => c.type === 'generator' && c.generatorId === 'kinora-sample-soft-rays'), 'the pack template uses the pack’s animated background');
  expect(card.some((c) => c.type === 'image' && p.assets[c.assetId]?.source.path === kit.logos[0].path), 'the pack template’s Logo slot gets the brand logo');
  await run((t) => {
    window.__kinora.useUI.getState().clearSelection();
    window.__kinora.engine.seek(t);
  }, cardRes.at + 3.3);
  await sleep(1200);
  await shot('t14-pack-template');

  // =============================================================================================
  // 5. Home: start from a branded template with music, export and verify
  // =============================================================================================
  await run(() => {
    const kk = window.__kinora;
    kk.useProjectStore.getState().markSaved(null);
    kk.useUI.getState().set({ screen: 'home' });
  });
  await win.waitForSelector('.home');
  await sleep(1500);
  const homeBrand = await win.locator('.home [data-testid=use-brand] button.toggle').getAttribute('aria-checked');
  expect(homeBrand === 'true', 'the Home screen shows “Use my brand” on');
  expect(await win.locator('.home .chip', { hasText: 'My templates' }).isVisible(), 'Home lists My templates');
  await shot('t15-home-brand');
  const homeTile = win.locator('.home-tpl[data-template="b-business-logo-reveal"]');
  await homeTile.scrollIntoViewIfNeeded();
  await sleep(800);
  await homeTile.click();
  await win.waitForSelector('.timeline');
  p = await waitFor(async () => {
    const s = await project();
    return s.clips.some((c) => c.type === 'audio') ? s : null;
  }, 'home template music');
  expect(p.clips.some((c) => c.type === 'image' && p.assets[c.assetId]?.source.path === kit.logos[0].path), 'the new project has the brand logo');
  expect(p.past === 0, 'the new project starts with a clean undo history');
  await run(() => window.__kinora.engine.seek(3));
  await sleep(1200);
  await shot('t16-home-project');

  const exported = await run(
    async ({ dir }) => {
      const kk = window.__kinora;
      const project = kk.useProjectStore.getState().project;
      const base = { videoCodec: 'avc', width: 1280, height: 720, fps: 30, quality: 'medium', audio: true, start: 0, end: kk.engine.duration, hardware: 'no-preference', fastStart: false };
      const signal = new AbortController().signal;
      const join = (n) => `${dir}\\${n}`;
      kk.engine.setSuspended(true);
      try {
        await kk.exporter.exportProject(project, { ...base, container: 'mp4' }, join('templates-branded.mp4'), () => {}, signal);
        await kk.exporter.exportProject(project, { ...base, container: 'png', start: 3, end: 3 }, join('templates-branded.png'), () => {}, signal);
        await kk.exporter.exportProject(project, { ...base, container: 'wav' }, join('templates-branded.wav'), () => {}, signal);
      } finally {
        kk.engine.setSuspended(false);
      }
      return { duration: kk.engine.duration };
    },
    { dir: outDir },
  );
  const mp4 = path.join(outDir, 'templates-branded.mp4');
  expect(existsSync(mp4), 'the branded template exports to MP4');
  const probe = await run(async (file) => {
    const kk = window.__kinora;
    const res = await kk.assets.importMediaFiles(await window.kinora.fs.stat([file]));
    const a = res.assets[0];
    return a ? { duration: a.duration, width: a.width, height: a.height, hasAudio: a.hasAudio, videoCodec: a.videoCodec, audioCodec: a.audioCodec } : null;
  }, mp4);
  console.log(`  exported: ${JSON.stringify(probe)}`);
  expect(probe && Math.abs(probe.duration - exported.duration) < 0.2 && probe.width === 1280 && probe.hasAudio, 'the export has the template’s length, size and an audio track');
  const pixels = await run(
    async ({ file, bg, logo }) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = window.kinora.media.toUrl(file);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let nearBg = 0;
      let nearLogo = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 70) nearBg++;
        if (Math.abs(d[i] - logo[0]) + Math.abs(d[i + 1] - logo[1]) + Math.abs(d[i + 2] - logo[2]) < 60) nearLogo++;
      }
      const n = d.length / 4;
      return { bg: nearBg / n, logo: nearLogo / n };
    },
    { file: path.join(outDir, 'templates-branded.png'), bg: navy, logo: LOGO_RGB },
  );
  console.log(`  frame at 3 s: ${(pixels.bg * 100).toFixed(1)}% brand background, ${(pixels.logo * 100).toFixed(2)}% logo orange`);
  expect(pixels.bg > 0.25, 'the exported frame uses the brand background');
  expect(pixels.logo > 0.002, 'the exported frame shows the brand logo');
  const rms = await run(async (file) => {
    const buf = await (await fetch(window.kinora.media.toUrl(file))).arrayBuffer();
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    let s = 0;
    for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
    return Math.sqrt(s / ch.length);
  }, path.join(outDir, 'templates-branded.wav'));
  console.log(`  music RMS ${rms.toFixed(4)}`);
  expect(rms > 0.01, 'the exported sound contains the music bed');

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
