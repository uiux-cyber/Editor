/** Smoke test: the app starts, shows the home screen, and can open an empty project. */
export default async function smoke({ win, shot, run, sleep }) {
  await win.waitForSelector('.home', { timeout: 20000 });
  await sleep(1500);
  await shot('01-home');

  const counts = await run(() => window.__kinora.LIBRARY_COUNTS);
  console.log('  library:', JSON.stringify(counts));

  await win.click('.format-card');
  await win.waitForSelector('.timeline', { timeout: 10000 });
  await sleep(800);
  await shot('02-editor-empty');
}
