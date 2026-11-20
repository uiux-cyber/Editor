/**
 * Contact sheet of the Motion library for visual review: every ready-made clip at three moments
 * (landscape), on a dark stage, written to .e2e/motion-sheet.png. Not part of the default run:
 *
 *   npm run build && node scripts/e2e.mjs motion-sheet
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export default async function motionSheet({ win, run, root }) {
  await win.waitForSelector('.home', { timeout: 20000 });
  const dataUrl = await run(async () => {
    const m = window.__kinora.motion;
    const W = 480;
    const H = 270;
    const cols = 3;
    const label = 28;
    const rows = m.presets.length;
    const sheet = new OffscreenCanvas(W * cols, (H + label) * rows);
    const g = sheet.getContext('2d');
    g.fillStyle = '#0d0f14';
    g.fillRect(0, 0, sheet.width, sheet.height);
    for (const [r, p] of m.presets.entries()) {
      const times = [0.3, 0.55, 0.8].map((f) => p.duration * f);
      const res = await m.testMotion(p.code, { name: p.name, width: W, height: H, duration: p.duration, fps: 30, seed: 1, params: p.params }, times);
      const y = r * (H + label);
      g.fillStyle = '#c9ccd6';
      g.font = '600 15px sans-serif';
      g.fillText(`${p.name}  ·  ${res.ok ? times.map((t) => t.toFixed(1) + ' s').join(' / ') : res.error}`, 10, y + 19);
      res.frames.forEach((f, c) => {
        g.fillStyle = '#1b1e27';
        g.fillRect(c * W + 2, y + label, W - 4, H - 4);
        g.drawImage(f, c * W + 2, y + label, W - 4, H - 4);
        f.close();
      });
    }
    const blob = await sheet.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const out = path.join(root, '.e2e', 'motion-sheet.png');
  writeFileSync(out, Buffer.from(dataUrl, 'base64'));
  console.log(`  ✓ wrote ${out}`);
}
