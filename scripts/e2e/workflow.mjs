/**
 * Workflow features through the real UI: command palette (search + run, library "jump to"),
 * rebinding a shortcut and using it, the shortcuts dialog following the keymap, light theme on
 * every major surface and back, language switching, F6 panel focus, and Collect project into a
 * folder then reopening it from there.
 *
 *   npm run build && node scripts/e2e.mjs workflow
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

function expect(cond, message) {
  if (!cond) throw new Error(`expectation failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

export default async function workflow(ctx) {
  const { win, shot, run, sleep, outDir } = ctx;
  const kb = win.keyboard;
  const state = () =>
    run(() => {
      const k = window.__kinora;
      const p = k.useProjectStore.getState().project;
      return {
        name: p.name,
        clips: Object.values(p.clips).map((c) => ({ id: c.id, type: c.type, start: c.start, duration: c.duration })),
        selection: k.useUI.getState().selection,
        modal: k.useUI.getState().modal,
        screen: k.useUI.getState().screen,
        filePath: k.useProjectStore.getState().filePath,
        theme: document.documentElement.dataset.theme,
        lang: document.documentElement.lang,
        palette: k.workflow.palette.usePalette.getState().open,
      };
    });
  const openPalette = async (keys = 'Control+k') => {
    await kb.press(keys);
    await win.waitForSelector('.palette', { timeout: 5000 });
    await sleep(150);
  };
  const paletteRun = async (query, expectTitle) => {
    await openPalette();
    await kb.type(query, { delay: 15 });
    await sleep(250);
    const first = await win.locator('.palette__item').first().locator('.palette__title').innerText();
    if (expectTitle) expect(first.toLowerCase().includes(expectTitle.toLowerCase()), `palette: "${query}" → "${first}"`);
    await kb.press('Enter');
    await sleep(400);
    return first;
  };
  const openSettings = async (section) => {
    await kb.press('Control+,');
    await win.waitForSelector('.settings', { timeout: 5000 });
    if (section) await win.locator(`.settings__tab[data-section="${section}"]`).click();
    await sleep(300);
  };
  const closeSettings = async () => {
    await win.locator('.settings__head .icon-btn').click();
    await sleep(200);
  };

  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- Fixtures: a short clip and a still rendered by the app itself ------------------------
  const clipFile = path.join(outDir, 'wf-clip.mp4');
  const stillFile = path.join(outDir, 'wf-still.png');
  await run(
    async ({ clipFile, stillFile }) => {
      const k = window.__kinora;
      await k.projectIO.newProject({ name: 'Fixture', width: 1280, height: 720, fps: 30 });
      k.actions.addGenerator('aurora', { time: 0 });
      k.actions.addText('gradient-title', { time: 0 });
      const project = k.useProjectStore.getState().project;
      const base = { videoCodec: 'avc', width: 640, height: 360, fps: 30, quality: 'medium', audio: false, start: 0, end: 3, hardware: 'no-preference', fastStart: false };
      const signal = new AbortController().signal;
      await k.exporter.exportProject(project, { ...base, container: 'mp4' }, clipFile, () => {}, signal);
      await k.exporter.exportProject(project, { ...base, container: 'png', start: 1, end: 1 }, stillFile, () => {}, signal);
      k.useProjectStore.getState().markSaved(null);
      k.useUI.getState().set({ screen: 'home' });
    },
    { clipFile, stillFile },
  );
  expect(existsSync(clipFile) && existsSync(stillFile), 'fixtures rendered');
  await win.waitForSelector('.home');

  // ---- Command palette on the start screen ---------------------------------------------------
  await openPalette();
  await shot('wf-01-palette-home');
  const homeCount = await win.locator('.palette__item').count();
  expect(homeCount > 5, `palette lists the commands available on the start screen (${homeCount})`);
  await kb.press('Escape');
  await sleep(150);
  expect(!(await state()).palette, 'Escape closes the palette');

  // Ctrl+Shift+P also opens it; '>' restricts to commands.
  await openPalette('Control+Shift+P');
  await kb.type('>theme light', { delay: 10 });
  await sleep(200);
  expect((await win.locator('.palette__item').count()) >= 1, 'Ctrl+Shift+P opens the palette, ">" searches commands');
  await kb.press('Escape');

  // New project from the palette (opens the New project dialog).
  await paletteRun('new proj', 'New project');
  expect((await state()).modal === 'newProject', 'running "New project…" from the palette opens its dialog');
  await win.locator('.modal .btn--primary').click();
  await win.waitForSelector('.timeline');
  await sleep(500);

  // ---- Media + palette commands in the editor ------------------------------------------------
  await run(async (files) => {
    const k = window.__kinora;
    await k.assets.importMediaFiles(await window.kinora.fs.stat(files));
  }, [clipFile, stillFile]);
  await sleep(500);
  await win.locator('.media-tile', { hasText: 'wf-clip' }).click();
  await sleep(300);
  await win.locator('.media-tile', { hasText: 'wf-still' }).click();
  await sleep(300);
  let s = await state();
  expect(s.clips.length === 2, 'two clips on the timeline');

  // Split through the palette with the playhead inside the first clip.
  const video = s.clips.find((c) => c.type === 'video');
  await run((t) => window.__kinora.engine.seek(t), video.start + video.duration / 2);
  await run((id) => window.__kinora.useUI.getState().select([id]), video.id);
  await paletteRun('split play', 'Split at playhead');
  s = await state();
  expect(s.clips.length === 3, 'palette ran "Split at playhead"');

  // Jump to a library item: a sticker by name.
  await openPalette();
  await kb.type('red heart', { delay: 10 });
  await sleep(300);
  await shot('wf-02-palette-search');
  const libRow = win.locator('.palette__item[data-key^="lib:sticker:"]').first();
  expect((await libRow.count()) === 1, 'palette finds library stickers by name');
  await libRow.click();
  await sleep(400);
  expect((await state()).clips.some((c) => c.type === 'sticker'), 'picking a sticker in the palette adds it');

  // Recently used comes first.
  await openPalette();
  const firstSection = await win.locator('.palette__section').first().innerText();
  expect(/recent/i.test(firstSection), `recently used commands come first ("${firstSection.trim()}")`);
  await kb.press('Escape');

  // ---- Rebind a shortcut and use it ---------------------------------------------------------
  await openSettings('shortcuts');
  await win.locator('.sc__search input').fill('duplicate');
  await sleep(200);
  const row = win.locator('.sc-row[data-command="edit.duplicate"]');
  expect((await row.count()) === 1, 'Settings → Shortcuts lists Duplicate when searching');
  // A conflicting combination is reported…
  await row.locator('.sc-chip__keys').first().click();
  await sleep(100);
  await kb.press('Control+z');
  await sleep(200);
  expect(await row.locator('.sc-conflict').isVisible(), 'recording Ctrl+Z warns that Undo already uses it');
  await shot('wf-03-shortcut-conflict');
  await row.locator('.sc-conflict .btn--outline').click();
  // …a free one is assigned.
  await row.locator('.sc-chip__keys').first().click();
  await sleep(100);
  await kb.press('Control+j');
  await sleep(200);
  const bindings = await run(() => window.__kinora.workflow.keymap.bindingsFor('edit.duplicate'));
  expect(bindings.join() === 'Ctrl+J', `Duplicate is now Ctrl+J (${bindings.join()})`);
  await shot('wf-04-settings-shortcuts');
  await closeSettings();
  const saved = await run(() => window.kinora.settings.get('shortcuts.keymap'));
  expect(JSON.stringify(saved) === JSON.stringify({ 'edit.duplicate': ['Ctrl+J'] }), 'the keymap is persisted in settings');

  const sticker = (await state()).clips.find((c) => c.type === 'sticker');
  await run((id) => window.__kinora.useUI.getState().select([id]), sticker.id);
  await win.locator('.stage__overlay').click({ position: { x: 4, y: 4 } });
  await run((id) => window.__kinora.useUI.getState().select([id]), sticker.id);
  const before = (await state()).clips.length;
  await kb.press('Control+d');
  await sleep(250);
  expect((await state()).clips.length === before, 'the old shortcut Ctrl+D no longer duplicates');
  await kb.press('Control+j');
  await sleep(250);
  expect((await state()).clips.length === before + 1, 'the new shortcut Ctrl+J duplicates');
  const menuText = await run(() => window.__kinora.workflow.keymap.shortcutText('edit.duplicate'));
  expect(menuText === 'Ctrl+J', 'menus show the new shortcut');

  // The shortcuts dialog follows the keymap.
  await win.locator('.stage__overlay').click({ position: { x: 4, y: 4 } });
  await kb.press('?');
  await win.waitForSelector('.modal .shortcuts');
  await sleep(200);
  const dupRow = win.locator('.shortcut', { hasText: 'Duplicate' }).first();
  expect((await dupRow.innerText()).replace(/\s+/g, '').includes('CtrlJ'), 'the keyboard shortcuts dialog shows Ctrl+J for Duplicate');
  await shot('wf-05-shortcuts-dialog');
  await kb.press('Escape');

  // Reset one command.
  await openSettings('shortcuts');
  await win.locator('.sc__search input').fill('duplicate');
  await win.locator('.sc-row[data-command="edit.duplicate"] .sc-row__actions .icon-btn').click();
  await sleep(150);
  expect((await run(() => window.__kinora.workflow.keymap.bindingsFor('edit.duplicate'))).join() === 'Ctrl+D', 'reset restores Ctrl+D');
  await closeSettings();

  // ---- F6 cycles focus between the panels -----------------------------------------------------
  await win.locator('.stage__overlay').click({ position: { x: 4, y: 4 } });
  const paneAfter = async () => {
    await kb.press('F6');
    await sleep(80);
    return run(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null);
  };
  const order = [await paneAfter(), await paneAfter(), await paneAfter(), await paneAfter()];
  expect(order.join() === 'inspector,timeline,library,preview', `F6 cycles library → preview → inspector → timeline (${order.join()})`);
  await kb.press('Shift+F6');
  await sleep(80);
  expect((await run(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane'))) === 'library', 'Shift+F6 goes back');

  // ---- Light theme on every surface ------------------------------------------------------------
  await openSettings('appearance');
  await shot('wf-06-settings-appearance-dark');
  await win.locator('.choice-card[data-value="light"]').click();
  await sleep(400);
  expect((await state()).theme === 'light', 'choosing Light in Settings → Appearance applies the light theme');
  expect((await run(() => window.kinora.settings.get('appearance.theme'))) === 'light', 'the theme is persisted');
  await shot('wf-10-light-settings-appearance');
  for (const section of ['general', 'shortcuts', 'language']) {
    await win.locator(`.settings__tab[data-section="${section}"]`).click();
    await sleep(250);
    await shot(`wf-11-light-settings-${section}`);
  }
  await closeSettings();

  // Editor with a selected text clip (inspector), timeline, preview chrome.
  const textId = await run(() => window.__kinora.actions.addText('gradient-title', { time: 0 })[0]);
  await sleep(500);
  await shot('wf-12-light-editor');
  await win.locator('.tabs__tab', { hasText: 'Animate' }).click().catch(() => {});
  await sleep(500);
  await shot('wf-13-light-inspector-animate');
  for (const tab of ['templates', 'effects', 'stickers', 'text', 'audio', 'transitions', 'elements', 'media']) {
    await win.click(`.rail__btn[data-tab="${tab}"]`);
    await sleep(tab === 'templates' ? 1500 : 600);
    await shot(`wf-14-light-library-${tab}`);
  }
  // Menus and context menu.
  await win.locator('.titlebar__menu [data-menu="File"]').click();
  await sleep(200);
  await shot('wf-15-light-menu-file');
  await kb.press('ArrowRight');
  await sleep(200);
  await kb.press('ArrowRight');
  await sleep(200);
  expect(/fullscreen preview/i.test(await win.locator('.menu').innerText()), 'ArrowRight moves through the menu bar (View menu open)');
  await shot('wf-16-light-menu-view');
  await kb.press('Escape');
  await win.locator(`.clip[data-clip="${textId}"]`).click({ button: 'right' });
  await sleep(200);
  await shot('wf-17-light-context-menu');
  await kb.press('Escape');
  // Palette, dialogs, toasts.
  await openPalette();
  await kb.type('zoom', { delay: 10 });
  await sleep(200);
  await shot('wf-18-light-palette');
  await kb.press('Escape');
  await kb.press('Control+e');
  await win.waitForSelector('.modal');
  await sleep(400);
  await shot('wf-19-light-export-dialog');
  await kb.press('Escape');
  await win.locator('.stage__overlay').click({ position: { x: 4, y: 4 } });
  await kb.press('?');
  await sleep(300);
  await shot('wf-20-light-shortcuts-dialog');
  await kb.press('Escape');
  await run(() => {
    const ui = window.__kinora.useUI.getState();
    ui.toast({ kind: 'success', message: 'Project saved' });
    ui.toast({ kind: 'warning', message: '2 media files could not be found', detail: 'Right-click the file in the Media tab and choose Relink.' });
  });
  await sleep(300);
  await shot('wf-21-light-toasts');
  // Playing state and home screen.
  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
  await run(() => window.__kinora.useUI.getState().set({ screen: 'home' }));
  await win.waitForSelector('.home');
  await sleep(1500);
  await shot('wf-22-light-home');
  await run(() => window.__kinora.useUI.getState().set({ screen: 'editor' }));
  await win.waitForSelector('.timeline');
  await sleep(500);

  // Back to dark through View → Theme → Dark.
  await win.locator('.titlebar__menu [data-menu="View"]').click();
  await sleep(150);
  await win.locator('.menu__item', { hasText: 'Dark' }).click();
  await sleep(300);
  expect((await state()).theme === 'dark', 'View → Theme → Dark switches back');

  // ---- Language ------------------------------------------------------------------------------
  await openSettings('language');
  await win.locator('.choice-card[data-value="es"]').click();
  await sleep(300);
  s = await state();
  expect(s.lang === 'es', 'choosing Español switches the language live');
  expect((await win.locator('.settings__title').innerText()) === 'Idioma', 'the settings window is translated');
  await shot('wf-30-language-es-settings');
  await closeSettings();
  const menus = await win.locator('.titlebar__menu button').allInnerTexts();
  expect(menus.includes('Archivo') && menus.includes('Ayuda'), `title-bar menus are translated (${menus.join(', ')})`);
  await win.locator('.titlebar__menu [data-menu="File"]').click();
  await sleep(200);
  expect((await win.locator('.menu').innerText()).includes('Recopilar proyecto…'), 'menu items are translated');
  await shot('wf-31-language-es-menu');
  await kb.press('Escape');
  await openPalette();
  await kb.type('dividir', { delay: 10 });
  await sleep(200);
  expect((await win.locator('.palette__item').first().innerText()).includes('Dividir'), 'the palette searches translated titles');
  await shot('wf-32-language-es-palette');
  await kb.press('Escape');
  await openSettings('language');
  await win.locator('.choice-card[data-value="hi"]').click();
  await sleep(300);
  await shot('wf-33-language-hi-settings');
  await win.locator('.choice-card[data-value="en"]').click();
  await sleep(300);
  expect((await state()).lang === 'en', 'back to English');
  expect((await run(() => window.kinora.settings.get('language.code'))) === 'en', 'the language is persisted');
  await closeSettings();

  // ---- Collect project ----------------------------------------------------------------------
  await run(() => window.__kinora.useProjectStore.getState().update((p) => void (p.name = 'Collect Test')));
  const collectDir = path.join(outDir, 'Collected', 'Collect Test');
  await rm(collectDir, { recursive: true, force: true });
  await win.locator('.titlebar__menu [data-menu="File"]').click();
  await sleep(150);
  await win.locator('.menu__item', { hasText: 'Collect project…' }).click();
  await win.waitForSelector('.modal [data-action="choose-folder"]');
  await win.locator('.modal [data-action="choose-folder"]').click();
  await win.waitForFunction(() => !document.querySelector('.modal [data-action="collect"]')?.hasAttribute('disabled'), null, { timeout: 10000 });
  await shot('wf-40-collect-dialog');
  await win.locator('.modal [data-action="collect"]').click();
  await win.waitForFunction((dir) => (window.__kinora.useProjectStore.getState().filePath ?? '').startsWith(dir), collectDir, { timeout: 30000 });
  await sleep(500);
  s = await state();
  const collectedFile = path.join(collectDir, 'Collect Test.kinora');
  expect(s.filePath === collectedFile, `the collected project is now open (${s.filePath})`);
  expect(existsSync(collectedFile), 'the project file was written into the folder');
  const mediaFiles = readdirSync(path.join(collectDir, 'Media')).sort();
  expect(mediaFiles.join() === 'wf-clip.mp4,wf-still.png', `media was copied into Media/ (${mediaFiles.join(', ')})`);
  const json = JSON.parse(readFileSync(collectedFile, 'utf8'));
  const paths = Object.values(json.project.assets)
    .filter((a) => a.source.type === 'file')
    .map((a) => a.source.path)
    .sort();
  expect(paths.join() === 'Media/wf-clip.mp4,Media/wf-still.png', `the project stores relative media paths (${paths.join(', ')})`);

  // Reopen it from the collected folder: the relative paths resolve there.
  const clipCount = s.clips.length;
  await run(async (file) => {
    const k = window.__kinora;
    k.useProjectStore.getState().markSaved(null);
    k.useUI.getState().set({ screen: 'home' });
    await k.projectIO.openProject(file);
  }, collectedFile);
  await sleep(1200);
  const reopened = await run(() => {
    const k = window.__kinora;
    const p = k.useProjectStore.getState().project;
    return {
      clips: Object.keys(p.clips).length,
      paths: Object.values(p.assets)
        .filter((a) => a.source.type === 'file')
        .map((a) => a.source.path)
        .sort(),
      missing: Object.values(p.assets).filter((a) => k.assets.assetRuntime(a.id)?.status === 'missing').length,
    };
  });
  expect(reopened.clips === clipCount, 'reopening the collected project restores every clip');
  expect(reopened.missing === 0, 'every collected media file loads');
  expect(
    reopened.paths.every((p) => p.toLowerCase().startsWith(path.join(collectDir, 'Media').toLowerCase())),
    `media resolves inside the collected folder (${reopened.paths.map((p) => path.basename(p)).join(', ')})`,
  );
  expect((await win.locator('.media-tile.is-missing').count()) === 0, 'no media is reported missing');
  await shot('wf-41-collected-reopened');

  // Collecting again into the same folder reuses the copies (incremental).
  await win.locator('.titlebar__menu [data-menu="File"]').click();
  await sleep(150);
  await win.locator('.menu__item', { hasText: 'Collect project…' }).click();
  await win.locator('.modal [data-action="choose-folder"]').click();
  await win.waitForFunction(() => !document.querySelector('.modal [data-action="collect"]')?.hasAttribute('disabled'), null, { timeout: 10000 });
  expect((await win.locator('.modal .collect-warn').count()) >= 1, 'collecting again warns that the project will be replaced');
  await win.locator('.modal [data-option="switch"]').uncheck();
  await win.locator('.modal [data-action="collect"]').click();
  await win.waitForSelector('.collect-done', { timeout: 30000 });
  const doneText = await win.locator('.collect-done').innerText();
  expect(/already there/.test(doneText), `media already in the folder is reused ("${doneText.split('\n')[0]}")`);
  await shot('wf-42-collect-again');
  await win.locator('.modal .btn--primary', { hasText: 'Done' }).click();

  await run(() => window.__kinora.useProjectStore.getState().markSaved(null));
}
