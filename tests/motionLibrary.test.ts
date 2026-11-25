import { describe, expect, it } from 'vitest';
import type { MotionPresetDef } from '@/library/motionPresets';
import {
  MOTION_BRAND_ID,
  MOTION_BRAND_PAGES,
  MOTION_OWN_ID,
  backdropFor,
  matchingPresets,
  motionHasMore,
  motionPage,
  resolveVariation,
  shuffleMotion,
  themeValues,
  variationOf,
  variationValues,
  type MotionLibrary,
} from '@/library/motionVariations';
import type { FontPair, Palette } from '@/library/types';
import { motionFontFamily } from '@shared/motion';

const palette = (id: string, bg: string, text: string): Palette => ({
  id,
  name: id,
  dark: true,
  bg,
  bg2: '#222222',
  surface: '#333333',
  primary: '#ff0000',
  secondary: '#00ff00',
  accent: '#0000ff',
  text,
  textMuted: '#888888',
  onPrimary: '#ffffff',
});
const fonts = (id: string, heading: string, body: string): FontPair => ({ id, name: id, heading: { family: heading as FontPair['heading']['family'], weight: 800 }, body: { family: body as FontPair['body']['family'], weight: 400 } });

const title: MotionPresetDef = {
  id: 'title-test',
  name: 'Test title',
  category: 'titles',
  about: 'A title for tests.',
  duration: 4,
  code: 'export default function setup(k) { return () => {}; }',
  tags: ['kinetic', 'headline'],
  params: [
    { id: 'title', type: 'text', label: 'Title', default: 'HELLO', brand: 'name' },
    { id: 'color', type: 'color', label: 'Text', default: '#ffffff', brand: 'text' },
    { id: 'panel', type: 'color', label: 'Panel', default: '#000000', brand: 'surface' },
    { id: 'ink', type: 'color', label: 'On panel', default: '#eeeeee', brand: 'on-primary' },
    { id: 'font', type: 'font', label: 'Font', default: 'Inter Variable', brand: 'heading' },
    { id: 'style', type: 'select', label: 'Style', default: 'Solid', options: ['Solid', 'Outline', 'Glow'] },
    { id: 'align', type: 'select', label: 'Align', default: 'Center', options: ['Left', 'Center', 'Right'] },
  ],
  looks: [{ style: 'Outline' }, { style: 'Glow', align: 'Left' }],
  copy: [{ title: 'SUMMER SALE' }, { title: 'EPISODE 12' }],
};
const chart: MotionPresetDef = { ...title, id: 'data-test', name: 'Chart', category: 'data', tags: ['bars'], looks: undefined, copy: undefined, vary: ['align'] };
const bg: MotionPresetDef = { ...title, id: 'bg-test', name: 'Background', category: 'backgrounds', fullFrame: true, tags: [] };

const lib: MotionLibrary = {
  presets: [title, chart, bg],
  palettes: [palette('night', '#000000', '#ffffff'), palette('paper', '#f5f0e6', '#111111'), palette('sea', '#002233', '#ddeeff')],
  fontPairs: [fonts('modern', 'Montserrat', 'Inter'), fonts('editorial', 'Playfair Display', 'Inter')],
  fontFor: motionFontFamily,
};

describe('Motion library versions', () => {
  it('shows every design as made on the first page', () => {
    const page = motionPage(lib, {}, 0);
    expect(page).toHaveLength(3);
    for (const v of page) {
      expect(v.paletteId).toBe(MOTION_OWN_ID);
      expect(v.look).toBe(0);
      expect(v.copy).toBe(0);
      const r = resolveVariation(lib, v)!;
      expect(r.changed).toEqual({});
      expect(r.seed).toBe(1);
    }
  });

  it('restyles later pages with palettes, fonts, looks and words', () => {
    const v = variationOf(lib, title, 3);
    expect(v.paletteId).not.toBe(MOTION_OWN_ID);
    const r = resolveVariation(lib, v)!;
    const p = lib.palettes.find((x) => x.id === v.paletteId)!;
    expect(r.values.color).toBe(p.text);
    expect(r.values.panel).toBe(p.surface);
    expect(r.values.ink).toBe(p.onPrimary);
    expect(String(r.values.font)).toMatch(/Variable|Display/);
    expect(r.seed).toBe(v.seed);
  });

  it('is stable: the same version gives the same values', () => {
    const a = resolveVariation(lib, variationOf(lib, title, 7))!;
    const b = resolveVariation(lib, variationOf(lib, title, 7))!;
    expect(a.values).toEqual(b.values);
    expect(variationOf(lib, title, 7).key).toBe(variationOf(lib, title, 7).key);
  });

  it('walks through looks and sample words', () => {
    const styles = new Set<unknown>();
    const words = new Set<unknown>();
    for (let n = 1; n < 12; n++) {
      const r = resolveVariation(lib, variationOf(lib, title, n))!;
      styles.add(r.values.style);
      words.add(r.values.title);
    }
    expect(styles.size).toBeGreaterThan(1);
    expect(words).toContain('SUMMER SALE');
    expect(words).toContain('EPISODE 12');
  });

  it('only randomises the settings it may', () => {
    for (let n = 1; n < 20; n++) {
      const r = variationValues(chart, { look: 0, copy: 0, seed: 1000 + n, random: true }, null, motionFontFamily);
      expect(r.style).toBe('Solid');
      expect(['Left', 'Center', 'Right']).toContain(r.align);
    }
  });

  it('fills settings from a theme by role', () => {
    const v = themeValues(title.params, { palette: lib.palettes[1], fonts: lib.fontPairs[1], name: '  Acme Co ' }, motionFontFamily);
    expect(v).toMatchObject({ title: 'Acme Co', color: '#111111', panel: '#333333', ink: '#ffffff' });
  });

  it('uses the brand kit for a few pages, then stops', () => {
    const brand = { theme: { palette: lib.palettes[2], fonts: lib.fontPairs[0], name: 'Wave' }, revision: 3 };
    const v = variationOf(lib, title, 1, brand);
    expect(v.paletteId).toBe(MOTION_BRAND_ID);
    const r = resolveVariation(lib, v, brand)!;
    expect(r.values.title).toBe('Wave');
    expect(r.values.color).toBe('#ddeeff');
    expect(motionHasMore({ brand }, MOTION_BRAND_PAGES)).toBe(false);
    expect(motionPage(lib, { brand }, MOTION_BRAND_PAGES)).toEqual([]);
    expect(motionHasMore({}, 50)).toBe(true);
  });

  it('searches names, categories and tags, and filters by category', () => {
    expect(matchingPresets(lib, { search: 'bars' }).map((p) => p.id)).toEqual(['data-test']);
    expect(matchingPresets(lib, { search: 'kinetic headline' }).map((p) => p.id)).toEqual(['title-test']);
    expect(matchingPresets(lib, { category: 'backgrounds' }).map((p) => p.id)).toEqual(['bg-test']);
  });

  it('gives every page a new arrangement and new versions', () => {
    const p1 = motionPage(lib, {}, 1).map((v) => v.key);
    const p2 = motionPage(lib, {}, 2).map((v) => v.key);
    expect(new Set([...p1, ...p2]).size).toBe(6);
  });

  it('shuffles to another version of the same design', () => {
    const v = variationOf(lib, title, 2);
    const s = shuffleMotion(lib, v);
    expect(s.presetId).toBe(title.id);
    expect(s.key).not.toBe(v.key);
  });

  it('draws transparent designs over the palette background', () => {
    const v = variationOf(lib, title, 4);
    const p = lib.palettes.find((x) => x.id === v.paletteId)!;
    expect(backdropFor(lib, v)).toEqual({ bg: p.bg, bg2: p.bg2 });
    expect(backdropFor(lib, variationOf(lib, title, 0)).bg).toMatch(/^#/);
  });
});
