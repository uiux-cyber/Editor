import { describe, expect, it } from 'vitest';
import samplePack from '../resources/packs/sample.kinorapack?raw';
import { linear, makeAudio, makeImage, makeShape, makeText, makeTrack, makeVideo } from '@/core/factory';
import { createProject } from '@/core/project';
import type { Clip, ImageClip, MediaAsset, Project, ShapeClip, TextClip } from '@/core/types';
import { TEMPLATES, getTemplate, registerContent, hasLibraryId, getLibraryVersion, PALETTES, LIBRARY_COUNTS, getSound } from '@/library';
import { BRAND_PALETTE_ID, DEFAULT_BRAND, brandContrastChecks, brandFontPair, brandPalette, pickLogo, sanitizeBrandKit, type BrandKit } from '@/library/brand';
import { applyBrandStyle } from '@/library/brandStyle';
import { MAX_LOOP_ITERATIONS, glslSafetyProblems, packContent, validatePack } from '@/library/packs';
import { adaptClips, resolveTokens, sanitizeClips, Problems } from '@/library/staticTemplates';
import { buildTemplate, fillLogoSlots, isLogoSlot, setTemplateBrand, variationFor, variationPage } from '@/library/templateEngine';
import { contrast } from '@/library/templates/_lib/kit';
import { parseUserTemplate, serializeSelection, userTemplateDef } from '@/library/userTemplates';


// Built-in designs measure text with a 2D canvas; tests run in Node, so provide a simple metric
// (fixed advance per character) — layouts only need to be plausible, not pixel exact.
class FakeCtx {
  font = '10px sans-serif';
  letterSpacing = '0px';
  fontKerning = 'normal';
  textBaseline = 'alphabetic';
  textAlign = 'left';
  measureText(s: string): Partial<TextMetrics> {
    const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? '10');
    const w = s.length * px * 0.56;
    return { width: w, actualBoundingBoxAscent: px * 0.72, actualBoundingBoxDescent: px * 0.22, fontBoundingBoxAscent: px * 0.92, fontBoundingBoxDescent: px * 0.24, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w };
  }
}
const g = globalThis as unknown as { OffscreenCanvas?: unknown };
g.OffscreenCanvas ??= class {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): FakeCtx {
    return new FakeCtx();
  }
};

const imageAsset: MediaAsset = {
  id: 'as_photo',
  kind: 'image',
  name: 'photo.png',
  source: { type: 'file', path: 'C:/media/photo.png' },
  duration: 0,
  width: 1600,
  height: 900,
  fps: 0,
  hasVideo: false,
  hasAudio: false,
  size: 1000,
  addedAt: 0,
};
const videoAsset: MediaAsset = { ...imageAsset, id: 'as_video', kind: 'video', name: 'clip.mp4', source: { type: 'file', path: 'C:/media/clip.mp4' }, duration: 12, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true };
const soundAsset: MediaAsset = { ...imageAsset, id: 'as_sound', kind: 'audio', name: 'Ding', source: { type: 'generated', soundId: 'ding' }, duration: 1, width: 0, height: 0 };
const fileAudio: MediaAsset = { ...imageAsset, id: 'as_song', kind: 'audio', name: 'song.mp3', source: { type: 'file', path: 'C:/media/song.mp3' }, duration: 60, width: 0, height: 0 };

/** A 16:9 project with two visual tracks and an audio track. */
function projectWithSelection(): { project: Project; ids: string[] } {
  const project = createProject({ width: 1920, height: 1080, fps: 30 });
  project.tracks = [makeTrack('visual', 'Top'), makeTrack('visual', 'Base'), makeTrack('audio', 'Audio')];
  const [top, base, audio] = project.tracks;
  for (const a of [imageAsset, videoAsset, soundAsset, fileAudio]) project.assets[a.id] = a;
  const video = { ...makeVideo(videoAsset, { start: 10, duration: 4 }), trackId: base.id, groupId: 'grp_x' };
  video.transform.scaleX = video.transform.scaleY = 0.5;
  video.transform.x = 300;
  video.cornerRadius = 0.2;
  video.anim = { in: { id: 'fade-in', duration: 0.5 } };
  const title = { ...makeText('Big summer sale', { start: 10.5, duration: 3 }), trackId: top.id };
  const photo = { ...makeImage(imageAsset, { start: 11, duration: 2 }), trackId: top.id };
  const ding = { ...makeAudio(soundAsset, { start: 10.2 }), trackId: audio.id };
  const song = { ...makeAudio(fileAudio, { start: 10, duration: 4 }), trackId: audio.id };
  for (const c of [video, title, photo, ding, song] as Clip[]) project.clips[c.id] = c;
  return { project, ids: [title.id, video.id, photo.id, ding.id, song.id] };
}

const saveOpts = { name: '  Sale opener ', category: 'promo' as const, tags: ['Sale', ' bold ', '', 'sale'], embedMedia: false };

// -------------------------------------------------------------------------------------------
// User templates
// -------------------------------------------------------------------------------------------

describe('user templates', () => {
  it('serialises a selection with relative times and bottom → top order', () => {
    const { project, ids } = projectWithSelection();
    const { file, summary } = serializeSelection(project, ids, saveOpts, 1234);
    expect(file.format).toBe('kinora-template');
    expect(file.id).toMatch(/^user-[a-z0-9]+$/);
    expect(file.name).toBe('Sale opener');
    expect(file.tags).toEqual(['sale', 'bold']);
    expect(file.createdAt).toBe(1234);
    expect(file.design).toEqual({ width: 1920, height: 1080 });
    expect(Math.min(...file.clips.map((c) => c.start))).toBe(0);
    expect(file.duration).toBeCloseTo(4, 5);
    // Base track first (bottom), then the top track, then audio.
    expect(file.clips[0].type).toBe('shape');
    expect(file.clips.every((c) => c.trackId === '' && c.groupId === undefined)).toBe(true);
    expect(summary.placeholders).toBe(2);
    expect(summary.skipped.join()).toMatch(/song\.mp3/);
  });

  it('turns media into placeholders of the same on-screen box', () => {
    const { project, ids } = projectWithSelection();
    const { file } = serializeSelection(project, ids, saveOpts);
    const slot = file.clips[0] as ShapeClip;
    expect(slot.shape.slot).toBe(true);
    expect(slot.name).toBe('Video 1');
    // A 1920×1080 video fits a 1920×1080 frame at scale 1; the slot keeps the 0.5 scale.
    expect(slot.shape.width).toBeCloseTo(1920, 1);
    expect(slot.shape.height).toBeCloseTo(1080, 1);
    expect(slot.transform.scaleX).toBe(0.5);
    expect(slot.transform.x).toBe(300);
    expect(slot.shape.radius).toBeCloseTo(0.2 * 540, 1);
    expect(slot.anim?.in?.id).toBe('fade-in');
    expect(slot.start).toBe(0);
    expect(slot.duration).toBe(4);
    // No media references remain, only the built-in sound.
    expect(Object.values(file.assets).map((a) => a.source.type)).toEqual(['generated']);
    expect(file.clips.some((c) => c.type === 'video' || c.type === 'image')).toBe(false);
  });

  it('embeds media with paths relative to the template folder', () => {
    const { project, ids } = projectWithSelection();
    const { file, embed, summary } = serializeSelection(project, ids, { ...saveOpts, embedMedia: true });
    expect(summary.placeholders).toBe(0);
    expect(embed.map((e) => e.file).sort()).toEqual(['clip.mp4', 'photo.png', 'song.mp3']);
    expect(embed.find((e) => e.file === 'clip.mp4')?.from).toBe('C:/media/clip.mp4');
    for (const a of Object.values(file.assets)) if (a.source.type === 'file') expect(a.source.path).toMatch(/^media\//);
    expect(file.clips.filter((c) => c.type === 'audio')).toHaveLength(2);
  });

  it('turns the brand logo into a Logo placeholder', () => {
    const { project, ids } = projectWithSelection();
    project.assets[imageAsset.id] = { ...imageAsset, source: { type: 'file', path: 'C:\\Users\\me\\AppData\\Kinora\\brand\\logos\\logo-1.png' } };
    const { file } = serializeSelection(project, ids, { ...saveOpts, embedMedia: true, brandDir: 'C:/Users/me/AppData/Kinora/brand/logos' });
    expect(file.clips.filter((c) => c.type === 'shape' && c.shape.slot && c.name === 'Logo')).toHaveLength(1);
  });

  it('round-trips through JSON and rebuilds for another aspect ratio', () => {
    const { project, ids } = projectWithSelection();
    const { file } = serializeSelection(project, ids, { ...saveOpts, embedMedia: true });
    const parsed = parseUserTemplate(JSON.parse(JSON.stringify(file)), 'C:\\Users\\me\\Kinora\\templates\\' + file.id);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.file.clips).toHaveLength(file.clips.length);
    const photo = parsed.value.assets.find((a) => a.name === 'photo.png')!;
    expect(photo.source).toEqual({ type: 'file', path: `C:\\Users\\me\\Kinora\\templates\\${file.id}\\media\\photo.png` });
    const def = userTemplateDef(parsed.value);
    expect(def.fixed).toBe(true);
    expect(def.origin).toEqual({ kind: 'user', id: file.id });
    const reg = registerContent('user', { templates: [def] });
    try {
      const built = buildTemplate(variationFor(def, 0), 1080, 1920);
      expect(built).not.toBeNull();
      expect(built!.clips).toHaveLength(file.clips.length);
      expect(built!.assets.length).toBeGreaterThan(0);
      for (const c of built!.clips) if (c.type !== 'audio') expect(Math.abs(c.transform.x)).toBeLessThanOrEqual(1080);
      // Fixed designs appear once: on the first page of the gallery only.
      const page0 = variationPage({ aspect: '16:9', category: 'mine' }, 0);
      expect(page0.map((v) => v.templateId)).toEqual([def.id]);
      expect(variationPage({ aspect: '16:9', category: 'mine' }, 1)).toEqual([]);
      expect(variationPage({ aspect: '16:9', category: 'all' }, 0)[0].templateId).toBe(def.id);
    } finally {
      reg.unregister();
    }
  });

  it('rejects tampered template files', () => {
    const { project, ids } = projectWithSelection();
    const { file } = serializeSelection(project, ids, { ...saveOpts, embedMedia: true });
    const traversal = JSON.parse(JSON.stringify(file));
    const media = Object.values(traversal.assets).find((a) => (a as MediaAsset).source.type === 'file') as MediaAsset & { source: { path: string } };
    media.source.path = 'media/../../../Windows/win.ini';
    expect(parseUserTemplate(traversal, 'C:/t').ok).toBe(false);
    const absolute = JSON.parse(JSON.stringify(file));
    (Object.values(absolute.assets).find((a) => (a as MediaAsset).source.type === 'file') as { source: { path: string } }).source.path = 'C:/Windows/system32/x.png';
    expect(parseUserTemplate(absolute, 'C:/t').ok).toBe(false);
    expect(parseUserTemplate({ ...file, id: '../evil' }, 'C:/t').ok).toBe(false);
    expect(parseUserTemplate(JSON.parse(`{"format":"kinora-template","__proto__":{"polluted":true}}`), 'C:/t').ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const badClip = JSON.parse(JSON.stringify(file));
    badClip.clips[0] = { type: 'compound', start: 0, duration: 1 };
    expect(parseUserTemplate(badClip, 'C:/t').ok).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// Brand kit
// -------------------------------------------------------------------------------------------

const kit = (colors: Partial<BrandKit['colors']>): BrandKit => ({ ...DEFAULT_BRAND, colors: { ...DEFAULT_BRAND.colors, ...colors } });

describe('brand kit', () => {
  it('derives a complete, legible palette from the five brand colours', () => {
    const k = kit({ primary: '#e63946', secondary: '#457b9d', accent: '#f1c40f', background: '#0b132b', text: '#f1faee' });
    const p = brandPalette(k);
    expect(p.id).toBe(BRAND_PALETTE_ID);
    expect(p.dark).toBe(true);
    expect(p.bg).toBe('#0b132b');
    expect(p.primary).toBe('#e63946');
    for (const key of ['bg2', 'surface', 'textMuted', 'onPrimary'] as const) expect(p[key]).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.surface).not.toBe(p.bg);
    expect(contrast(p.textMuted, p.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textMuted, p.bg)).toBeLessThan(contrast(p.text, p.bg));
    expect(contrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(contrast('#ffffff', p.primary) - 0.06);
  });

  it('handles light brands and fixes unreadable text', () => {
    const p = brandPalette(kit({ background: '#fdfcf8', text: '#f5f5f5', primary: '#ffd60a' }));
    expect(p.dark).toBe(false);
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.onPrimary, '#ffd60a')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textMuted, p.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('reports WCAG contrast for the pairings templates use', () => {
    const checks = brandContrastChecks(kit({ background: '#ffffff', text: '#777777', primary: '#ffff00' }));
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId.text.ratio).toBeCloseTo(4.48, 1);
    expect(byId.text.ok).toBe(false);
    expect(byId.text.level).toBe('AA large');
    expect(byId.primary.level).toBe('fail');
    const good = brandContrastChecks(kit({ background: '#000000', text: '#ffffff' }));
    expect(good.find((c) => c.id === 'text')!.level).toBe('AAA');
  });

  it('sanitises kits read from disk', () => {
    const k = sanitizeBrandKit({ name: 42, colors: { primary: '#ABC', text: 'red', background: '#11223344' }, heading: { family: 'Oswald', weight: 1234 }, logos: [{ id: 'l1', path: 'C:/x.png', name: 'x', width: 'big' }, { nope: true }], primaryLogo: 'missing' });
    expect(k.name).toBe('');
    expect(k.colors.primary).toBe('#aabbcc');
    expect(k.colors.text).toBe(DEFAULT_BRAND.colors.text);
    expect(k.colors.background).toBe('#112233');
    expect(k.heading).toEqual({ family: 'Oswald', weight: 900 });
    expect(k.logos).toHaveLength(1);
    expect(k.primaryLogo).toBeUndefined();
  });

  it('picks the logo that reads on the background', () => {
    const logos = [
      { id: 'dark', name: 'd', path: 'd.png', width: 10, height: 10, luma: 0.02 },
      { id: 'light', name: 'l', path: 'l.png', width: 10, height: 10, luma: 0.9 },
    ];
    expect(pickLogo({ logos, primaryLogo: 'dark' }, '#0b0b0b')?.id).toBe('light');
    expect(pickLogo({ logos, primaryLogo: 'dark' }, '#ffffff')?.id).toBe('dark');
    expect(pickLogo({ logos: [] }, '#fff')).toBeNull();
  });

  it('renders templates with the brand palette, fonts and logo', () => {
    const k: BrandKit = { ...kit({ primary: '#123456', background: '#fafafa', text: '#101010' }), heading: { family: 'Oswald', weight: 700 }, body: { family: 'Rubik', weight: 400 }, revision: 3 };
    const logo: MediaAsset = { ...imageAsset, id: 'as_logo', width: 400, height: 200 };
    setTemplateBrand({ revision: k.revision, palette: brandPalette(k), fonts: brandFontPair(k), logo });
    try {
      const def = getTemplate('b-business-logo-reveal')!;
      const v = variationFor(def, 0, true);
      expect(v.paletteId).toBe(BRAND_PALETTE_ID);
      expect(v.key).toContain('brand3');
      const built = buildTemplate(v, 1920, 1080)!;
      const logoClip = built.clips.find((c) => c.type === 'image');
      expect(logoClip && logoClip.type === 'image' && logoClip.assetId).toBe('as_logo');
      expect(built.clips.some(isLogoSlot)).toBe(false);
      expect(built.assets.map((a) => a.id)).toContain('as_logo');
      const texts = built.clips.filter((c): c is TextClip => c.type === 'text');
      expect(texts.some((t) => t.text.fontFamily === 'Oswald')).toBe(true);
      expect(texts.some((t) => t.text.fontFamily === 'Rubik')).toBe(true);
      // Brand-mode pages never fall back to random palettes.
      expect(variationPage({ aspect: '16:9', brand: true }, 2).every((x) => x.paletteId === BRAND_PALETTE_ID)).toBe(true);
    } finally {
      setTemplateBrand(null);
    }
  });

  it('fits the logo inside its placeholder without cropping', () => {
    const slot = makeShape('ellipse', { name: 'Logo', width: 300, height: 300, x: 50, y: -20, duration: 3 });
    slot.shape.slot = true;
    const logo: MediaAsset = { ...imageAsset, id: 'as_wide', width: 1000, height: 250 };
    const [img] = fillLogoSlots([slot], logo, 1920, 1080) as ImageClip[];
    expect(img.type).toBe('image');
    // 1000×250 contain-fits 1920×1080 at 1920×480; the logo must fit 70 % of the round slot.
    expect(1920 * img.transform.scaleX).toBeLessThanOrEqual(300 * 0.7 + 0.01);
    expect(480 * img.transform.scaleY).toBeLessThanOrEqual(300 * 0.7 + 0.01);
    expect(img.transform.x).toBe(50);
  });

  it('applies the brand to existing layers by colour role', () => {
    const p = brandPalette(kit({ primary: '#ff0055', secondary: '#00aaff', accent: '#ffcc00', background: '#101014', text: '#fafafa' }));
    const fonts = brandFontPair({ heading: { family: 'Anton', weight: 400 }, body: { family: 'Inter', weight: 500 } });
    const big = makeText('Title', { style: { fontSize: 140, fill: { type: 'solid', color: '#22aa44' } } });
    const small = makeText('Caption', { style: { fontSize: 40, fill: { type: 'solid', color: '#ffffffcc' } } });
    const bar = makeShape('rect', { width: 100, height: 10, fill: linear(0, '#22aa44', '#8833ff') });
    const slot = makeShape('rect', { width: 100, height: 100, fill: '#333333' });
    slot.shape.slot = true;
    const res = applyBrandStyle([big, small, bar, slot], p, fonts);
    expect(res.changed).toBe(3);
    expect(big.text.fontFamily).toBe('Anton');
    expect(small.text.fontFamily).toBe('Inter');
    expect(big.text.fill).toEqual({ type: 'solid', color: '#ff0055' });
    // A light neutral stays light (brand text colour) and keeps its alpha.
    expect(small.text.fill).toEqual({ type: 'solid', color: `${p.text}cc` });
    // The same source hue maps to the same brand colour; a new hue gets the secondary.
    expect(bar.shape.fill.type === 'linear' && bar.shape.fill.stops.map((s) => s.color)).toEqual(['#ff0055', '#00aaff']);
    expect(slot.shape.fill).toEqual({ type: 'solid', color: '#333333' });
  });
});

// -------------------------------------------------------------------------------------------
// Content packs
// -------------------------------------------------------------------------------------------

const minimalPack = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 'kinora-pack',
  version: 1,
  id: 'test-pack',
  name: 'Test pack',
  palettes: [{ id: 'test-pal', name: 'Test', dark: true, bg: '#000000', bg2: '#111111', surface: '#222222', primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff', text: '#ffffff', textMuted: '#aaaaaa', onPrimary: '#ffffff' }],
  ...extra,
});
const effect = (glsl: string, id = 'test-fx'): Record<string, unknown> => ({ id, name: 'Fx', category: 'color', glsl, params: [{ key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0, max: 1 }] });
const errorsOf = (input: unknown): string => validatePack(input).errors.join('\n');

describe('content packs', () => {
  it('accepts the sample pack and registers every item', () => {
    let compiled = 0;
    const res = validatePack(samplePack, { compile: () => (compiled++, null) });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(compiled).toBe(3);
    expect(res.counts).toEqual({ palettes: 3, fontPairs: 1, filters: 2, textPresets: 1, transitions: 1, effects: 1, generators: 1, templates: 1 });
    const before = { palettes: PALETTES.length, version: getLibraryVersion(), templates: LIBRARY_COUNTS.templates };
    const reg = registerContent(`pack:${res.pack!.id}`, packContent(res.pack!));
    try {
      expect(reg.skipped).toEqual([]);
      expect(PALETTES.length).toBe(before.palettes + 3);
      expect(LIBRARY_COUNTS.templates).toBe(before.templates + 1);
      expect(getLibraryVersion()).toBeGreaterThan(before.version);
      expect(hasLibraryId('transitions', 'kinora-sample-diagonal-blinds')).toBe(true);
      // The pack template follows the palette through its $tokens and supports every aspect.
      const def = getTemplate('kinora-sample-spotlight-card')!;
      expect(def.fixed).toBe(false);
      expect(def.music?.soundId).toBe('music-upbeat-pop');
      for (const [cw, ch] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
        const built = buildTemplate({ key: 'k', templateId: def.id, paletteId: 'kinora-sample-neon-night', fontPairId: 'kinora-sample-editorial', seed: 1 }, cw, ch)!;
        expect(built.clips.length).toBe(9);
        const headline = built.clips.find((c): c is TextClip => c.type === 'text' && c.name === 'Headline')!;
        expect(headline.text.fontFamily).toBe('Playfair Display');
        expect(headline.text.fill).toEqual({ type: 'solid', color: '#f4f7ff' });
        const card = built.clips.find((c): c is ShapeClip => c.name === 'Card')!;
        expect(card.shape.fill).toEqual({ type: 'solid', color: '#171733e0' });
        expect(JSON.stringify(built.clips)).not.toContain('$');
      }
    } finally {
      reg.unregister();
    }
    expect(PALETTES.length).toBe(before.palettes);
    expect(hasLibraryId('transitions', 'kinora-sample-diagonal-blinds')).toBe(false);
  });

  it('rejects input that is not a pack', () => {
    expect(errorsOf('{ not json')).toMatch(/not valid JSON/);
    expect(errorsOf('[]')).toMatch(/JSON object/);
    expect(errorsOf({ ...minimalPack(), format: 'zip' })).toMatch(/format/);
    expect(errorsOf({ ...minimalPack(), version: 99 })).toMatch(/newer version/);
    expect(errorsOf({ ...minimalPack(), id: '../../evil' })).toMatch(/^id:/m);
    expect(errorsOf({ format: 'kinora-pack', version: 1, id: 'empty-pack', name: 'Empty' })).toMatch(/no items/);
    expect(errorsOf('x'.repeat(9 * 1024 * 1024))).toMatch(/larger than/);
    expect(validatePack(minimalPack()).ok).toBe(true);
  });

  it('blocks prototype pollution and deeply nested data', () => {
    const polluted = `{"format":"kinora-pack","version":1,"id":"evil-pack","name":"Evil","palettes":[{"__proto__":{"isAdmin":true},"id":"x1"}]}`;
    expect(errorsOf(polluted)).toMatch(/forbidden key "__proto__"/);
    expect(errorsOf({ ...minimalPack(), constructor: { prototype: {} } })).toMatch(/forbidden key/);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    let deep: unknown = 1;
    for (let i = 0; i < 60; i++) deep = [deep];
    expect(errorsOf({ ...minimalPack(), description: deep })).toMatch(/too deep/);
  });

  it('refuses ids that collide with built-in content or repeat', () => {
    expect(errorsOf(minimalPack({ transitions: [{ id: 'fade', name: 'Fade', category: 'basic', glsl: 'vec4 transition(vec2 uv){ return mix(getFromColor(uv), getToColor(uv), progress); }' }] }))).toMatch(/already used by a built-in/);
    expect(errorsOf(minimalPack({ palettes: [minimalPack().palettes, minimalPack().palettes].flat() }))).toMatch(/used twice/);
    expect(errorsOf(minimalPack({ filters: [{ id: 'Bad Id!', name: 'x', category: 'mood', grade: { fade: 0.1 } }] }))).toMatch(/lower-case/);
  });

  it('checks fonts, values and library references', () => {
    expect(errorsOf(minimalPack({ fontPairs: [{ id: 'fp-x', name: 'X', heading: { family: 'Comic Sans MS', weight: 400 }, body: { family: 'Inter', weight: 500 } }] }))).toMatch(/not bundled/);
    expect(errorsOf(minimalPack({ fontPairs: [{ id: 'fp-y', name: 'Y', heading: { family: 'Anton', weight: 900 }, body: { family: 'Inter', weight: 500 } }] }))).toMatch(/no weight 900/);
    expect(errorsOf(minimalPack({ filters: [{ id: 'f-x', name: 'X', category: 'mood', grade: { exposure: 50 } }] }))).toMatch(/outside -2..2/);
    expect(errorsOf(minimalPack({ filters: [{ id: 'f-y', name: 'Y', category: 'mood', grade: { evil: 1 } }] }))).toMatch(/unknown grade field/);
    expect(errorsOf(minimalPack({ palettes: [{ ...(minimalPack().palettes as object[])[0], primary: 'javascript:alert(1)' }] }))).toMatch(/#rrggbb/);
    expect(errorsOf(minimalPack({ textPresets: [{ id: 'tp-x', name: 'X', category: 'title', sample: 'Hi', style: { fontFamily: 'Inter' }, anim: { in: { id: 'no-such-anim', duration: 1 } } }] }))).toMatch(/unknown animation/);
  });

  it('rejects unsafe or broken shaders before compiling them', () => {
    const fx = (glsl: string): string => errorsOf(minimalPack({ effects: [effect(glsl)] }));
    expect(fx('vec4 effect(vec2 uv){ while(true){} return tex(uv); }')).toMatch(/while/);
    expect(fx('vec4 effect(vec2 uv){ vec4 c; do { c = tex(uv); } while(false); return c; }')).toMatch(/do/);
    expect(fx('#define LOOP for(;;)\nvec4 effect(vec2 uv){ return tex(uv); }')).toMatch(/preprocessor/);
    expect(fx('vec4 effect(vec2 uv){ vec4 c = vec4(0.0); for (int i = 0; i < 100000; i++) c += tex(uv); return c; }')).toMatch(/runs 100000 times/);
    expect(fx('vec4 effect(vec2 uv){ vec4 c = vec4(0.0); for (int i = 0; i < int(amount * 1e9); i++) c += tex(uv); return c; }')).toMatch(/literal bounds/);
    expect(fx('vec4 effect(vec2 uv){ vec4 c = vec4(0.0); for (int i = 0; i < 8; i--) c += tex(uv); return c; }')).toMatch(/never ends/);
    expect(fx('vec4 effect(vec2 uv){ vec4 c = vec4(0.0); for (int i = 0; i < 8; i++) { i = 0; c += tex(uv); } return c; }')).toMatch(/must not be changed/);
    expect(fx('uniform float x; vec4 effect(vec2 uv){ return tex(uv); }')).toMatch(/uniform/);
    expect(fx('vec4 nope(vec2 uv){ return vec4(1.0); }')).toMatch(/must define effect\(\)/);
    expect(fx('void main(){} vec4 effect(vec2 uv){ return tex(uv); }')).toMatch(/main/);
    expect(errorsOf(minimalPack({ effects: [{ ...effect('vec4 effect(vec2 uv){ return tex(uv); }'), params: [{ key: 'u_time', label: 'x', type: 'float', default: 0 }] }] }))).toMatch(/reserved prefix/);
    // A bounded loop is fine.
    expect(glslSafetyProblems(`vec4 effect(vec2 uv){ vec4 c = vec4(0.0); for (int i = 0; i < ${MAX_LOOP_ITERATIONS}; i++) c += tex(uv); return c; }`, 'effect')).toEqual([]);
    // Compiler errors are reported.
    const res = validatePack(minimalPack({ effects: [effect('vec4 effect(vec2 uv){ return tex(uv) }')] }), { compile: () => "ERROR: 0:1: '}' : syntax error" });
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/does not compile/);
  });

  it('validates static template clips strictly', () => {
    const tpl = (clips: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => minimalPack({ templates: [{ id: 'tpl-x', name: 'X', category: 'promo', duration: 4, design: { width: 1920, height: 1080 }, clips, ...extra }] });
    const okText = { type: 'text', start: 0, duration: 2, text: { content: 'Hi', fontFamily: '$heading', fill: '$primary' } };
    expect(validatePack(tpl([okText])).ok).toBe(true);
    expect(errorsOf(tpl([{ type: 'video', assetId: 'x', start: 0, duration: 1 }]))).toMatch(/placeholder/);
    expect(errorsOf(tpl([{ type: 'html', start: 0, duration: 1 }]))).toMatch(/unsupported clip type/);
    expect(errorsOf(tpl([{ ...okText, duration: 9 }]))).toMatch(/after the template duration/);
    expect(errorsOf(tpl([{ ...okText, start: -1 }]))).toMatch(/outside/);
    expect(errorsOf(tpl([{ ...okText, text: { content: 'x', fontFamily: 'Wingdings' } }]))).toMatch(/not bundled/);
    expect(errorsOf(tpl([{ type: 'sticker', stickerId: 'nope', start: 0, duration: 1 }]))).toMatch(/unknown sticker/);
    expect(errorsOf(tpl([{ type: 'generator', generatorId: 'aurora', start: 0, duration: 1, params: { colorA: '$nope' } }]))).toMatch(/not a colour/);
    expect(errorsOf(tpl([okText], { music: { soundId: 'ding' } }))).toMatch(/not a music bed/);
    expect(errorsOf(tpl([]))).toMatch(/non-empty array/);
    // Templates may use the pack's own effects.
    expect(validatePack(minimalPack({ effects: [effect('vec4 effect(vec2 uv){ return tex(uv) * amount; }', 'own-fx')], templates: [{ id: 'tpl-y', name: 'Y', category: 'promo', duration: 4, design: { width: 1920, height: 1080 }, clips: [{ ...okText, effects: [{ effectId: 'own-fx', params: { amount: 0.5 } }] }] }] })).ok).toBe(true);
    expect(hasLibraryId('effects', 'own-fx')).toBe(false);
  });

  it('sanitises clips, dropping unknown fields', () => {
    const p = new Problems();
    const [clip] = sanitizeClips(p, 'c', [{ type: 'shape', start: 1, duration: 2, onclick: 'alert(1)', shape: { kind: 'rect', width: 10, height: 10, fill: '#fff', script: 'x' } }]);
    expect(p.errors).toEqual([]);
    expect(clip).not.toHaveProperty('onclick');
    expect((clip as ShapeClip).shape).not.toHaveProperty('script');
    expect(clip.trackId).toBe('');
  });

  it('resolves tokens with alpha and adapts layouts to other frames', () => {
    const p = new Problems();
    const clips = sanitizeClips(p, 'c', [
      { type: 'shape', start: 0, duration: 1, shape: { kind: 'rect', width: 1920, height: 1080, fill: '$bg' } },
      { type: 'shape', start: 0, duration: 1, transform: { x: 600, y: 0 }, shape: { kind: 'ellipse', width: 200, height: 200, fill: '$accent/50' } },
    ], { tokens: true });
    expect(p.errors).toEqual([]);
    resolveTokens(clips, PALETTES[0], { id: 'x', name: 'x', heading: { family: 'Inter', weight: 800 }, body: { family: 'Inter', weight: 400 } });
    expect((clips[0] as ShapeClip).shape.fill).toEqual({ type: 'solid', color: PALETTES[0].bg });
    expect(((clips[1] as ShapeClip).shape.fill as { color: string }).color).toBe(`${PALETTES[0].accent}80`);
    const out = adaptClips(clips, { cw: 1920, ch: 1080 }, { cw: 1080, ch: 1920 });
    const bg = out[0] as ShapeClip;
    expect(bg.shape.width).toBeCloseTo(1080, 3);
    expect(bg.shape.height).toBeCloseTo(1920, 3);
    expect(out[1].type !== 'audio' && out[1].transform.x).toBeCloseTo(600 * (1080 / 1920), 3);
  });
});

// -------------------------------------------------------------------------------------------
// Template music
// -------------------------------------------------------------------------------------------

describe('template music', () => {
  it('assigns existing music beds to about 25 templates', () => {
    const withMusic = TEMPLATES.filter((t) => t.music);
    expect(withMusic.length).toBeGreaterThanOrEqual(22);
    for (const t of withMusic) {
      const sound = getSound(t.music!.soundId);
      expect(sound?.category, `${t.id} → ${t.music!.soundId}`).toBe('music');
    }
  });

  it('marks logo placeholders in 10+ templates', () => {
    const withLogo = TEMPLATES.filter((t) => {
      const built = buildTemplate({ key: 'k', templateId: t.id, paletteId: PALETTES[0].id, fontPairId: 'x', seed: 7 }, 1920, 1080);
      return !!built?.clips.some(isLogoSlot);
    });
    expect(withLogo.length).toBeGreaterThanOrEqual(13);
  });
});
