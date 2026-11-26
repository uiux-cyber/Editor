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
import { getTemplate } from '@/library';
import { ASPECT_SIZES, buildTemplate, supportsAspect, variationPage, type TemplateVariation } from '@/library/templateEngine';
import type { TemplateCategory, TemplateDef } from '@/library/types';
import type { AspectId } from '@/library/types';
import { demoProvider, prepareMotion, releaseMotion, templateThumbProject, type ThumbMotion } from '@/ui/library/thumbs';

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
/** Render generated designs: the gallery's pages 1..feed (for the category, or all). */
const feed = Math.max(0, Number(params.get('feed') || 0));
/** Posters only, many per sheet. */
const grid = params.get('grid') === '1';

const provider: MediaProvider = demoProvider;
const FRAMES = [0.12, 0.35, -1, 0.92];
const ROWS_PER_SHEET = 6;

async function main(): Promise<void> {
  // Generated designs (gen-…) are not in the registry list: look them up by id.
  const defs = ids.some((id) => id.startsWith('gen-'))
    ? ids.map((id) => getTemplate(id)).filter((d): d is TemplateDef => !!d)
    : TEMPLATES.filter((t) => (ids.length ? ids.includes(t.id) : true) && (category ? t.category === category : true));
  const compositor = new Compositor(document.createElement('canvas'), { preserveDrawingBuffer: true });
  let sheetCount = 0;
  const problems: string[] = [];

  for (const aspect of aspects) {
    const { cw, ch } = ASPECT_SIZES[aspect];
    const cellW = ch > cw ? 270 : 480;
    const cellH = Math.round((cellW * ch) / cw);
    const label = 26;
    const rows: { def: TemplateDef; v: TemplateVariation }[] = [];
    if (feed > 0) {
      for (let p = 1; p <= feed; p++)
        for (const v of variationPage({ aspect, category: (category || 'all') as TemplateCategory | 'all' }, p)) {
          const def = getTemplate(v.templateId);
          if (def) rows.push({ def, v });
        }
    }
    for (const def of feed > 0 ? [] : defs) {
      if (!supportsAspect(def, aspect)) continue;
      for (let n = 0; n < variants; n++) {
        const palette = PALETTES[(n * 5 + rows.length) % Math.max(1, PALETTES.length)];
        const fonts = FONT_PAIRS[(n * 3 + rows.length) % Math.max(1, FONT_PAIRS.length)];
        rows.push({ def, v: { key: `${def.id}:${n}`, templateId: def.id, paletteId: palette?.id ?? '', fontPairId: fonts?.id ?? '', seed: 1000 + n * 77 + rows.length } });
      }
    }
    // Rows of frames, or (grid) a grid of posters.
    const frames = grid ? [-1] : FRAMES;
    const cols = grid ? (ch > cw ? 6 : 4) : 1;
    const perSheet = grid ? cols * (ch > cw ? 2 : 4) : ROWS_PER_SHEET;
    const itemW = cellW * frames.length + (frames.length - 1) * 6;
    for (let start = 0; start < rows.length; start += perSheet) {
      const chunk = rows.slice(start, start + perSheet);
      const sheet = document.createElement('canvas');
      const lines = Math.ceil(chunk.length / cols);
      sheet.width = cols * (itemW + 6) + 6;
      sheet.height = lines * (cellH + label + 6) + 6;
      const ctx = sheet.getContext('2d')!;
      ctx.fillStyle = '#16181d';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      for (let r = 0; r < chunk.length; r++) {
        const { def, v } = chunk[r];
        const x0 = 6 + (r % cols) * (itemW + 6);
        const y = 6 + Math.floor(r / cols) * (cellH + label + 6);
        ctx.fillStyle = '#e8eaf0';
        ctx.font = `600 ${grid ? 12 : 14}px "Inter Variable", "Segoe UI", sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(grid ? `${def.id.replace(/^gen-/, '')} · ${v.paletteId}`.slice(0, 60) : `${def.id}  ·  ${def.category}  ·  ${aspect}  ·  ${v.paletteId} / ${v.fontPairId}`, x0 + 2, y + label / 2);
        const built = buildTemplate(v, cw, ch);
        if (!built) {
          problems.push(`${def.id} [${aspect}] failed to build`);
          continue;
        }
        const project = templateThumbProject(built.clips, cellW, cellH, cw, ch, v.seed);
        // Motion layers (in-memory clips) render at twice the cell size, like a sharp thumbnail.
        const motion: ThumbMotion[] = [];
        for (const raw of built.assets) {
          let a = raw;
          if (a.source.type === 'motion') {
            a = { ...a, source: { ...a.source, meta: { ...a.source.meta, width: cellW * 2, height: cellH * 2, fps: 30 } } };
            const clip = built.clips.find((c) => 'assetId' in c && c.assetId === a.id);
            motion.push({ asset: a, start: clip?.start ?? 0 });
          }
          if (!project.assets[a.id]) project.assets[a.id] = a;
        }
        await Promise.all(built.clips.map((c) => (c.type === 'text' ? ensureFont(c.text) : Promise.resolve())));
        compositor.setSize(cellW, cellH);
        for (let f = 0; f < frames.length; f++) {
          const frac = frames[f] < 0 ? (def.poster ?? 0.6) : frames[f];
          try {
            if (motion.length) await prepareMotion(motion, built.duration * frac);
            compositor.render(project, built.duration * frac, provider);
            ctx.drawImage(compositor.canvas as CanvasImageSource, x0 + f * (cellW + 6), y + label, cellW, cellH);
          } catch (err) {
            problems.push(`${def.id} [${aspect}] render failed: ${(err as Error).message}`);
          }
        }
        if (motion.length) releaseMotion(motion);
      }
      const name = `${feed ? 'feed' : 'templates'}${category ? '-' + category : ''}-${aspect.replace(':', 'x')}-${String(++sheetCount).padStart(2, '0')}.png`;
      await window.sheets.save(name, sheet.toDataURL('image/png'));
    }
  }
  window.sheets.done(JSON.stringify({ templates: defs.length, sheets: sheetCount, problems }));
}

void preloadBundledFonts().then(main).catch((err) => window.sheets.done(JSON.stringify({ error: String(err?.stack ?? err) })));
