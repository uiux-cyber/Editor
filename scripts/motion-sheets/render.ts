/**
 * Motion contact-sheet page (see scripts/render-motion.mjs). Each clip version runs in its own
 * sandboxed frame from kinora://motion, exactly as in the app.
 */

// @ts-expect-error virtual module provided by scripts/render-motion.mjs
import { counts, fontPairs, palettes, presets, sources } from 'virtual:motion-presets';
import { backdropFor, resolveVariation, variationOf, type MotionLibrary } from '@/library/motionVariations';
import type { MotionPresetDef } from '@/library/motionPresets';
import { MOTION_FRAME_URL, motionFontFamily, normalizeMotionParams, type MotionMeta, type MotionValue } from '@shared/motion';

declare global {
  interface Window {
    sheets: { save: (name: string, dataUrl: string) => Promise<void>; log: (text: string) => void; done: (summary: string) => void };
  }
}

const q = new URLSearchParams(location.search);
const list = (s: string | null): string[] => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const ids = list(q.get('ids'));
const category = q.get('category') || '';
const SIZES: Record<string, [number, number]> = { '16:9': [768, 432], '9:16': [432, 768], '1:1': [540, 540], '4:5': [540, 675] };
// Aspect ids, or an exact size such as 960x540.
for (const a of list(q.get('aspects'))) {
  const m = /^(\d+)x(\d+)$/.exec(a);
  if (m) SIZES[a.replace('x', ':')] = [Number(m[1]), Number(m[2])];
}
const aspects = list(q.get('aspects'))
  .map((a) => (/^\d+x\d+$/.test(a) ? a.replace('x', ':') : a))
  .filter((a) => a in SIZES);
const variants = Math.max(1, Math.min(8, Number(q.get('variants') || 2)));

const THUMB_H = 216;
const LABEL = 28;
const GAP = 6;
const ROWS_PER_SHEET = 8;
const FRAMES = (q.get('times') || '').split(',').filter(Boolean).map(Number).filter((x) => x >= 0 && x <= 1).slice(0, 8);
if (!FRAMES.length) FRAMES.push(0.15, 0.4, -1, 0.9);

const lib: MotionLibrary = { presets: presets as MotionPresetDef[], palettes, fontPairs, fontFor: motionFontFamily };

// ---- a minimal client for the sandboxed runtime ---------------------------------------------------

type Reply = { id?: number; type: string; ok?: boolean; error?: string; bitmap?: ImageBitmap; level?: string; text?: string };
const frames = new Map<MessageEventSource, Runtime>();
window.addEventListener('message', (e) => {
  const rt = e.source ? frames.get(e.source) : undefined;
  const d = e.data as (Reply & { __kinoraMotion?: boolean }) | null;
  if (rt && d?.__kinoraMotion === true) rt.onMessage(d);
});

class Runtime {
  private readonly iframe: HTMLIFrameElement;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private next = 1;
  private readonly waiting = new Map<number, (r: Reply) => void>();
  readonly logs: string[] = [];

  constructor() {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    Object.assign(f.style, { position: 'fixed', left: '-30000px', top: '0', width: '8px', height: '8px', border: '0' });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      setTimeout(() => reject(new Error('The runtime did not start within 20 s.')), 20000);
    });
    f.src = MOTION_FRAME_URL;
    document.body.appendChild(f);
    this.iframe = f;
    frames.set(f.contentWindow!, this);
  }

  onMessage(d: Reply): void {
    if (d.type === 'ready') this.resolveReady();
    else if (d.type === 'log') this.logs.push(`[${d.level}] ${d.text}`);
    else if (typeof d.id === 'number') {
      this.waiting.get(d.id)?.(d);
      this.waiting.delete(d.id);
    }
  }

  async send(msg: Record<string, unknown>, timeout: number, what: string): Promise<Reply> {
    await this.ready;
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${what} took longer than ${timeout / 1000} s`));
      }, timeout);
      this.waiting.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.iframe.contentWindow!.postMessage({ __kinoraMotion: true, id, ...msg }, '*');
    });
  }

  dispose(): void {
    frames.delete(this.iframe.contentWindow!);
    this.iframe.remove();
  }
}

// ---- checks -----------------------------------------------------------------------------------------

const probe = document.createElement('canvas');
probe.width = 96;
probe.height = 96;
const pg = probe.getContext('2d', { willReadFrequently: true })!;

function pixels(b: ImageBitmap): Uint8ClampedArray {
  pg.clearRect(0, 0, 96, 96);
  pg.drawImage(b, 0, 0, 96, 96);
  return pg.getImageData(0, 0, 96, 96).data;
}

/** Share of pixels that are not (almost) transparent. */
function coverage(b: ImageBitmap): number {
  const d = pixels(b);
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
  return n / (d.length / 4);
}

/** Share of pixels that differ clearly between two pictures. */
function difference(a: ImageBitmap, b: ImageBitmap): number {
  const x = pixels(a).slice();
  const y = pixels(b);
  let n = 0;
  for (let i = 0; i < x.length; i += 4) {
    const dd = Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) + Math.abs(x[i + 3] - y[i + 3]);
    if (dd > 60) n++;
  }
  return n / (x.length / 4);
}

// ---- rendering --------------------------------------------------------------------------------------

interface Row {
  label: string;
  note: string;
  frames: (ImageBitmap | null)[];
  backdrop: { bg: string; bg2: string } | null;
  error: string | null;
}

async function renderRow(p: MotionPresetDef, aspect: string, n: number, problems: string[]): Promise<Row> {
  const [w, h] = SIZES[aspect];
  const v = variationOf(lib, p, n);
  const resolved = resolveVariation(lib, v)!;
  const values: Record<string, MotionValue> = resolved.values;
  const meta: MotionMeta = { name: p.name, width: w, height: h, duration: p.duration, fps: 30, seed: resolved.seed, params: normalizeMotionParams(p.params) };
  const what = `${p.id} [${aspect}, version ${n}${v.paletteId ? ` ${v.paletteId}/${v.fontPairId}` : ''}${v.look ? ` look ${v.look}` : ''}${v.copy ? ` words ${v.copy}` : ''}]`;
  const posterAt = p.poster ?? 0.55;
  const times = FRAMES.map((f) => p.duration * (f < 0 ? posterAt : f));
  const rt = new Runtime();
  const row: Row = { label: `${p.id}  ·  ${p.category}  ·  ${aspect}  ·  ${v.paletteId ? `${v.paletteId} / ${v.fontPairId}` : 'as designed'}${v.look ? `  ·  look ${v.look}` : ''}${v.copy ? `  ·  words ${v.copy}` : ''}`, note: '', frames: [], backdrop: p.fullFrame ? null : backdropFor(lib, v), error: null };
  try {
    const t0 = performance.now();
    const init = await rt.send({ type: 'init', code: p.code, meta, images: {}, params: values }, 30000, 'Starting');
    const initMs = Math.round(performance.now() - t0);
    if (!init.ok) throw new Error(init.error ?? 'could not start');
    let slowest = 0;
    for (const t of times) {
      const s = performance.now();
      const r = await rt.send({ type: 'render', t }, 15000, `Frame ${t.toFixed(2)} s`);
      slowest = Math.max(slowest, performance.now() - s);
      if (r.error || !r.bitmap) throw new Error(r.error ?? `no picture at ${t.toFixed(2)} s`);
      row.frames.push(r.bitmap);
    }
    // Render the poster again after later frames: a clip must draw the same picture for the same t.
    const again = await rt.send({ type: 'render', t: times[2] }, 15000, 'Poster again');
    if (again.bitmap) {
      const diff = difference(row.frames[2]!, again.bitmap);
      if (diff > 0.01) problems.push(`${what}: the frame at ${times[2].toFixed(2)} s differs when rendered again (${Math.round(diff * 100)}% of pixels). Every frame must be a pure function of t.`);
      again.bitmap.close();
    }
    // Strict check (when the first and third times are equal): any pixel that differs.
    if (Math.abs(times[0] - times[2]) < 1e-9) {
      const a = new OffscreenCanvas(row.frames[0]!.width, row.frames[0]!.height).getContext('2d')!;
      const c = new OffscreenCanvas(row.frames[2]!.width, row.frames[2]!.height).getContext('2d')!;
      a.drawImage(row.frames[0]!, 0, 0);
      c.drawImage(row.frames[2]!, 0, 0);
      const x = a.getImageData(0, 0, w, h).data;
      const y = c.getImageData(0, 0, w, h).data;
      let diff = 0;
      let first = -1;
      for (let i = 0; i < x.length; i++)
        if (x[i] !== y[i]) {
          diff++;
          if (first < 0) first = i;
        }
      if (diff) problems.push(`${what}: frames at ${times[0].toFixed(2)} s differ in ${diff} channel values (first at pixel ${Math.floor(first / 4) % w}, ${Math.floor(first / 4 / w)}).`);
    }
    const cov = coverage(row.frames[2]!);
    if (p.fullFrame && cov < 0.98) problems.push(`${what}: marked fullFrame but ${Math.round((1 - cov) * 100)}% of the poster frame is transparent.`);
    if (!p.fullFrame && cov < 0.004) problems.push(`${what}: almost nothing is visible at the poster time (${times[2].toFixed(2)} s).`);
    if (initMs > 8000) problems.push(`${what}: slow to start (${initMs} ms).`);
    if (slowest > 600) problems.push(`${what}: slow frames (${Math.round(slowest)} ms at ${w}×${h}).`);
    for (const l of rt.logs) if (/^\[(error|warn)\]/.test(l)) problems.push(`${what}: console ${l.slice(0, 300)}`);
    row.note = `start ${initMs} ms · slowest frame ${Math.round(slowest)} ms · poster coverage ${Math.round(cov * 100)}%`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    row.error = msg;
    problems.push(`${what}: ${msg}${rt.logs.length ? `\n      logs: ${rt.logs.slice(-6).join(' | ')}` : ''}`);
  } finally {
    rt.dispose();
  }
  return row;
}

function drawSheet(rows: Row[], aspect: string): HTMLCanvasElement {
  const [w, h] = SIZES[aspect];
  const tw = Math.round((THUMB_H * w) / h);
  const width = Math.max(900, 12 + FRAMES.length * (tw + GAP));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = rows.length * (THUMB_H + LABEL + GAP) + GAP;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0d11';
  g.fillRect(0, 0, c.width, c.height);
  rows.forEach((r, i) => {
    const y = GAP + i * (THUMB_H + LABEL + GAP);
    g.fillStyle = r.error ? '#ff7a7a' : '#d6d9e2';
    g.font = '600 14px "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    g.fillText(r.label, 8, y + LABEL / 2 - 1);
    g.fillStyle = '#7d8394';
    g.font = '12px "Segoe UI", sans-serif';
    g.textAlign = 'right';
    g.fillText(r.error ? `✖ ${r.error.slice(0, 120)}` : r.note, width - 8, y + LABEL / 2 - 1);
    g.textAlign = 'left';
    FRAMES.forEach((_, k) => {
      const x = 6 + k * (tw + GAP);
      const top = y + LABEL;
      if (r.backdrop) {
        const grad = g.createLinearGradient(x, top, x + tw, top + THUMB_H);
        grad.addColorStop(0, r.backdrop.bg);
        grad.addColorStop(1, r.backdrop.bg2);
        g.fillStyle = grad;
      } else g.fillStyle = '#1b1e27';
      g.fillRect(x, top, tw, THUMB_H);
      const f = r.frames[k];
      if (f) g.drawImage(f, x, top, tw, THUMB_H);
      // Thin frame edge, so clips that draw outside the frame are easy to spot.
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.strokeRect(x + 0.5, top + 0.5, tw - 1, THUMB_H - 1);
    });
    for (const f of r.frames) f?.close();
  });
  return c;
}

async function main(): Promise<void> {
  const chosen = (presets as MotionPresetDef[]).filter((p) => (!ids.length || ids.includes(p.id)) && (!category || p.category === category));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of presets as MotionPresetDef[]) {
    if (seen.has(p.id)) problems.push(`Two designs use the id "${p.id}".`);
    seen.add(p.id);
  }
  // Settings must be valid for the inspector: normalizing must keep every one.
  for (const p of chosen) {
    const kept = normalizeMotionParams(p.params);
    if (kept.length !== p.params.length) problems.push(`${p.id}: ${p.params.length - kept.length} setting(s) are invalid and would be dropped (check ids, types, defaults, options).`);
    for (const look of p.looks ?? []) for (const k of Object.keys(look)) if (!p.params.some((x) => x.id === k)) problems.push(`${p.id}: a look sets "${k}", which is not a setting.`);
    for (const cp of p.copy ?? []) for (const k of Object.keys(cp)) if (!p.params.some((x) => x.id === k && x.type === 'text')) problems.push(`${p.id}: copy sets "${k}", which is not a text setting.`);
    for (const k of p.vary ?? []) if (!p.params.some((x) => x.id === k)) problems.push(`${p.id}: vary lists "${k}", which is not a setting.`);
  }
  if (!chosen.length) problems.push('No designs matched.');
  window.sheets.log(`${chosen.length} design(s) from ${(sources as string[]).map((s, i) => `${s} (${(counts as number[])[i]})`).join(', ')}`);
  let sheets = 0;
  let rows = 0;
  const stem = (aspect: string): string => `motion-${aspect.replace(':', 'x')}`;
  for (const aspect of aspects) {
    let batch: Row[] = [];
    const flush = async (): Promise<void> => {
      if (!batch.length) return;
      sheets++;
      const c = drawSheet(batch, aspect);
      await window.sheets.save(`${stem(aspect)}-${String(sheets).padStart(2, '0')}.png`, c.toDataURL('image/png'));
      batch = [];
    };
    for (const p of chosen) {
      for (let n = 0; n < variants; n++) {
        batch.push(await renderRow(p, aspect, n, problems));
        rows++;
        if (batch.length >= ROWS_PER_SHEET) await flush();
      }
    }
    await flush();
  }
  window.sheets.done(JSON.stringify({ presets: chosen.length, rows, sheets, problems }));
}

main().catch((err) => window.sheets.done(JSON.stringify({ error: String(err?.stack ?? err) })));
