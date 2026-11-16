/** Smoke test: the app starts, shows the home screen, and can open an empty project. */
export default async function smoke({ win, shot, run, sleep }) {
  await win.waitForSelector('.home', { timeout: 20000 });
  await sleep(1500);
  await shot('01-home');

  const counts = await run(() => window.__kinora.LIBRARY_COUNTS);
  console.log('  library:', JSON.stringify(counts));
  const env = await run(async () => {
    const r = await fetch('kinora://models/mediapipe/selfie_segmenter.tflite');
    return { isolated: window.crossOriginIsolated, sab: typeof SharedArrayBuffer !== 'undefined', modelStatus: r.status, modelBytes: (await r.arrayBuffer()).byteLength, webgpu: !!navigator.gpu };
  });
  console.log('  runtime:', JSON.stringify(env));
  if (!env.isolated || env.modelStatus !== 200) throw new Error('cross-origin isolation or model serving is broken');

  await win.click('.format-card');
  await win.waitForSelector('.timeline', { timeout: 10000 });
  await sleep(800);
  await shot('02-editor-empty');
}
