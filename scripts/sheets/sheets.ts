/**
 * Contact-sheet renderer for templates. Runs in a hidden Electron window with the real
 * compositor and bundled fonts, and writes PNG sheets through `window.sheets.save`.
 *
 * Each row is one template variation; the columns are frames at 12%, 35%, the poster time and
 * 92% of its duration, so entrances, the hero frame and exits can all be judged.
 */

import '@/styles/fonts';
import { Compositor, type MediaProvider } from '@/engine/compositor';
import { ensureFont, preloadBundledFonts } from '@/engine/sources/text';
import { FONT_PAIRS, PALETTES, TEMPLATES } from '@/library';
import { ASPECT_SIZES, buildTemplate, supportsAspect, type TemplateVariation } from '@/library/templateEngine';
import type { AspectId } from '@/library/types';
import { demoProvider, templateThumbProject } from '@/ui/library/thumbs';

declare global {
  interface Window {
    sheets: { save: (name: string, dataUrl: string) => Promise<void>; done: (summary: string) => void };
  }
}

const params = new URLSearchParams(location.search);
const ids = (params.get('ids') || '').split(',').filter(Boolean);
const aspects = ((params.get('aspects') || '16:9').split(',').filter(Boolean) as AspectId[]).filter((a) => a in ASPECT_SIZES);
const variants = Math.max(1, Math.min(4, Number(params.get('variants') || 1)));
const category = params.get('category') || '';

const provider: MediaProvider = demoProvider;
const FRAMES = [0.12, 0.35, -1, 0.92];
const ROWS_PER_SHEET = 6;

async function main(): Promise<void> {
  const defs = TEMPLATES.filter((t) => (ids.length ? ids.includes(t.id) : true) && (category ? t.category === category : true));
  const compositor = new Compositor(document.createElement('canvas'), { preserveDrawingBuffer: true });
  let sheetCount = 0;
  const problems: string[] = [];

  for (const aspect of aspects) {
    const { cw, ch } = ASPECT_SIZES[aspect];
    const cellW = ch > cw ? 270 : 480;
    const cellH = Math.round((cellW * ch) / cw);
    const label = 26;
    const rows: { def: (typeof defs)[number]; v: TemplateVariation }[] = [];
    for (const def of defs) {
      if (!supportsAspect(def, aspect)) continue;
      for (let n = 0; n < variants; n++) {
        const palette = PALETTES[(n * 5 + rows.length) % Math.max(1, PALETTES.length)];
        const fonts = FONT_PAIRS[(n * 3 + rows.length) % Math.max(1, FONT_PAIRS.length)];
        rows.push({ def, v: { key: `${def.id}:${n}`, templateId: def.id, paletteId: palette?.id ?? '', fontPairId: fonts?.id ?? '', seed: 1000 + n * 77 + rows.length } });
      }
    }
    for (let start = 0; start < rows.length; start += ROWS_PER_SHEET) {
      const chunk = rows.slice(start, start + ROWS_PER_SHEET);
      const sheet = document.createElement('canvas');
      sheet.width = cellW * FRAMES.length + (FRAMES.length + 1) * 6;
      sheet.height = chunk.length * (cellH + label + 6) + 6;
      const ctx = sheet.getContext('2d')!;
      ctx.fillStyle = '#16181d';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      for (let r = 0; r < chunk.length; r++) {
        const { def, v } = chunk[r];
        const y = 6 + r * (cellH + label + 6);
        ctx.fillStyle = '#e8eaf0';
        ctx.font = '600 14px "Inter Variable", "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${def.id}  ·  ${def.category}  ·  ${aspect}  ·  ${v.paletteId} / ${v.fontPairId}`, 8, y + label / 2);
        const built = buildTemplate(v, cw, ch);
        if (!built) {
          problems.push(`${def.id} [${aspect}] failed to build`);
          continue;
        }
        const project = templateThumbProject(built.clips, cellW, cellH, cw, ch, v.seed);
        await Promise.all(built.clips.map((c) => (c.type === 'text' ? ensureFont(c.text) : Promise.resolve())));
        compositor.setSize(cellW, cellH);
        for (let f = 0; f < FRAMES.length; f++) {
          const frac = FRAMES[f] < 0 ? (def.poster ?? 0.6) : FRAMES[f];
          try {
            compositor.render(project, built.duration * frac, provider);
            ctx.drawImage(compositor.canvas as CanvasImageSource, 6 + f * (cellW + 6), y + label, cellW, cellH);
          } catch (err) {
            problems.push(`${def.id} [${aspect}] render failed: ${(err as Error).message}`);
          }
        }
      }
      const name = `${category || 'templates'}-${aspect.replace(':', 'x')}-${String(++sheetCount).padStart(2, '0')}.png`;
      await window.sheets.save(name, sheet.toDataURL('image/png'));
    }
  }
  window.sheets.done(JSON.stringify({ templates: defs.length, sheets: sheetCount, problems }));
}

void preloadBundledFonts().then(main).catch((err) => window.sheets.done(JSON.stringify({ error: String(err?.stack ?? err) })));
