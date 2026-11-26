/**
 * Generated designs: an endless supply of structurally different templates.
 *
 * Each design is an archetype (a composition idea: film title card, Swiss poster, cut-out
 * collage…) applied to a category's content, with a number `n`: the content set, and through the
 * variation seed every structural choice (where the type sits, what the picture does, which
 * devices decorate it, how it moves). Designs are described by their id alone
 * (`gen-<archetype>-<category>-<n>`), so they are rebuilt on demand, in any aspect ratio, and are
 * stable across sessions.
 */

import { hashString, seededRandom } from '@/core/easing';
import type { TemplateCategory, TemplateDef } from '../../types';
import type { Archetype } from './archetype';
import { cinema, collage, editorial, product, stack, swiss } from './arch-a';
import { cards, glowMinimal, orbit, quote, splitScreen, technical } from './arch-b';
import { band, endcard, outline, polaroid, retro } from './arch-c';
import { COPY, copyFor } from './copy';
import { context } from './parts';

export const ARCHETYPES: Archetype[] = [cinema, swiss, editorial, collage, product, stack, glowMinimal, technical, splitScreen, cards, orbit, quote, outline, retro, polaroid, band, endcard];

const byId = new Map(ARCHETYPES.map((a) => [a.id, a]));

export const GEN_PREFIX = 'gen-';

/** Id of a generated design. */
export const generatedId = (a: Archetype, category: TemplateCategory, n: number): string => `${GEN_PREFIX}${a.id}-${category}-${n.toString(36)}`;

export const isGeneratedId = (id: string): boolean => id.startsWith(GEN_PREFIX);

const cache = new Map<string, TemplateDef>();

/** The generated design with this id (undefined for other ids or unknown archetypes). */
export function generatedTemplate(id: string): TemplateDef | undefined {
  if (!isGeneratedId(id)) return undefined;
  const hit = cache.get(id);
  if (hit) return hit;
  const m = /^gen-([a-z]+)-([a-z-]+)-([0-9a-z]+)$/.exec(id);
  if (!m) return undefined;
  const a = byId.get(m[1]);
  const category = m[2] as TemplateCategory;
  const n = parseInt(m[3], 36);
  if (!a || !a.categories.includes(category) || !COPY[category] || !Number.isFinite(n)) return undefined;
  const k = copyFor(category, n);
  const def: TemplateDef = {
    id,
    name: `${a.name} · ${k.label}`,
    category,
    tags: [...a.tags, 'generated', k.label.toLowerCase()],
    duration: a.duration ?? 6,
    poster: a.poster ?? 0.6,
    style: { ...(a.fonts ? { fonts: a.fonts } : {}), ...(a.palettes ? { palettes: a.palettes } : {}) },
    build: (env) => {
      const x = context(env);
      a.build(x, k, category);
      return x.out;
    },
  };
  if (cache.size > 2000) cache.clear();
  cache.set(id, def);
  return def;
}

/** Categories with generated designs. */
export const generatedCategories = (): TemplateCategory[] => [...new Set(ARCHETYPES.flatMap((a) => a.categories))].filter((c) => !!COPY[c]);

/**
 * Generated designs for one page of the gallery: `count` designs, each a different archetype
 * than its neighbours, cycling through the categories asked for. Later pages use new content
 * and new seeds, so the feed never repeats itself.
 */
export function generatedPage(o: { categories: TemplateCategory[]; page: number; count: number; search?: string }): TemplateDef[] {
  const cats = o.categories.filter((c) => !!COPY[c]);
  const eligible = ARCHETYPES.filter((a) => a.categories.some((c) => cats.includes(c)));
  if (!eligible.length) return [];
  const term = o.search?.trim().toLowerCase();
  const rnd = seededRandom(0x6e1 + o.page * 7919);
  const out: TemplateDef[] = [];
  let order: Archetype[] = [];
  let last = '';
  for (let i = 0; out.length < o.count && i < o.count * 40; i++) {
    // Every archetype once (in a shuffled order) before any repeats; never twice in a row.
    if (!order.length) {
      order = [...eligible];
      for (let j = order.length - 1; j > 0; j--) {
        const r = Math.floor(rnd() * (j + 1));
        [order[j], order[r]] = [order[r], order[j]];
      }
      if (order.length > 1 && order[0].id === last) order.push(order.shift()!);
    }
    const a = order.shift()!;
    const mine = a.categories.filter((c) => cats.includes(c));
    const c = mine[(o.page + i + Math.floor(rnd() * mine.length)) % mine.length];
    const n = (o.page * 131 + i * 17 + (hashString(a.id + c) % 97)) % 10007;
    const def = generatedTemplate(generatedId(a, c, n));
    if (!def) continue;
    if (term && !(def.name.toLowerCase().includes(term) || def.category.includes(term) || def.tags.some((t) => t.includes(term)))) continue;
    if (out.some((d) => d.id === def.id)) continue;
    out.push(def);
    last = a.id;
  }
  return out;
}
