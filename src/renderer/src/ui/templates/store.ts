/**
 * Templates & branding runtime: the user's saved templates, the brand kit, installed content
 * packs and the gallery preferences ("Use my brand", "Include music").
 *
 * Files are read and written only through the main-process handlers in
 * src/main/handlers/templates.ts; everything read back is validated before it is registered with
 * the library (`registerContent`).
 */

import { create } from 'zustand';
import type { ID, MediaAsset } from '@/core/types';
import { loadImageBitmap } from '@/engine/media/assets';
import { getTemplate, registerContent } from '@/library';
import { BRAND_PALETTE_ID, DEFAULT_BRAND, brandFontPair, brandPalette, pickLogo, sanitizeBrandKit, type BrandKit, type BrandLogo } from '@/library/brand';
import { packContent, packSummary, validatePack, type ContentPack, type PackValidation } from '@/library/packs';
import { setTemplateBrand } from '@/library/templateEngine';
import type { TemplateCategory, TemplateDef } from '@/library/types';
import { newUserTemplateId, parseUserTemplate, userTemplateDef, type ParsedUserTemplate, type UserTemplateFile } from '@/library/userTemplates';
import { api } from '@/platform/api';
import { toast } from '@/store/ui';
import { compilePackShader } from './shaderCheck';
import { ensureThumbImage, ensureThumbImages, forgetThumbImage } from './thumbImages';

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

export interface UserTemplateEntry {
  id: string;
  file: UserTemplateFile;
  /** Absolute template folder. */
  dir: string;
  /** Absolute path of the rendered poster. */
  poster: string | null;
  assets: MediaAsset[];
  def: TemplateDef;
}

export interface InstalledPack {
  id: string;
  name: string;
  file: string;
  author?: string;
  packVersion?: string;
  description?: string;
  /** "3 palettes, 1 filter…" */
  summary: string;
  /** Set when the pack is installed but could not be loaded. */
  errors: string[];
  loaded: boolean;
}

interface TemplatesState {
  /** Everything has been loaded from disk. */
  ready: boolean;
  templates: UserTemplateEntry[];
  brand: BrandKit;
  /** True once the user saved a brand kit. */
  brandSet: boolean;
  logosDir: string;
  /** Bumped when brand logo pictures finish decoding (thumbnail cache key). */
  logoEpoch: number;
  /** The brand logo is still being decoded (brand thumbnails wait for it). */
  logoPending: boolean;
  packs: InstalledPack[];
  /** Render templates with the brand kit. */
  useBrand: boolean;
  /** Add the template's music bed when applying it. */
  includeMusic: boolean;
  /** Category chip selected in the Templates tab (kept across tab switches). */
  galleryCategory: TemplateCategory | 'all' | 'mine';
}

export const useTemplates = create<TemplatesState>()(() => ({
  ready: false,
  templates: [],
  brand: DEFAULT_BRAND,
  brandSet: false,
  logosDir: '',
  logoEpoch: 0,
  logoPending: false,
  packs: [],
  useBrand: false,
  includeMusic: true,
  galleryCategory: 'all',
}));

const get = useTemplates.getState;
const set = useTemplates.setState;

/** Error message of an IPC failure without Electron's "Error invoking remote method" prefix. */
export const errorText = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

export function setUseBrand(on: boolean): void {
  set({ useBrand: on });
  void api.settings.set('templates.useBrand', on);
}

export function setIncludeMusic(on: boolean): void {
  set({ includeMusic: on });
  void api.settings.set('templates.includeMusic', on);
}

// ---------------------------------------------------------------------------------------------
// Brand kit
// ---------------------------------------------------------------------------------------------

/** The project asset used for a brand logo (stable id per logo file). */
export function logoAsset(logo: BrandLogo): MediaAsset {
  return {
    id: `as_${logo.id.replace(/[^a-z0-9]/gi, '')}`,
    kind: 'image',
    name: logo.name,
    source: { type: 'file', path: logo.path },
    duration: 0,
    width: logo.width,
    height: logo.height,
    fps: 0,
    hasVideo: false,
    hasAudio: false,
    size: 0,
    addedAt: 0,
  };
}

/** The logo templates use with the current kit (best contrast with the brand background). */
export function currentLogo(kit: BrandKit = get().brand): BrandLogo | null {
  return pickLogo(kit, kit.colors.background);
}

function installBrand(kit: BrandKit): void {
  const logo = currentLogo(kit);
  const asset = logo ? logoAsset(logo) : null;
  setTemplateBrand({ revision: kit.revision, palette: brandPalette(kit), fonts: brandFontPair(kit), logo: asset });
  if (!asset) {
    set({ logoPending: false });
    return;
  }
  set({ logoPending: true });
  void ensureThumbImage(asset).then(() => {
    // Only the logo of the latest kit decides when brand thumbnails may render.
    if (currentLogo(get().brand)?.id === logo!.id) set((s) => ({ logoEpoch: s.logoEpoch + 1, logoPending: false }));
  });
}

let saveTimer = 0;

/** Change the brand kit (saved to disk shortly after; templates re-render with it). */
export function updateBrand(recipe: (kit: BrandKit) => BrandKit | void): void {
  const current = get().brand;
  const draft = JSON.parse(JSON.stringify(current)) as BrandKit;
  const next = sanitizeBrandKit(recipe(draft) ?? draft);
  // Only changes that alter how templates look invalidate thumbnails (not e.g. the brand name).
  const looks = (k: BrandKit): string => JSON.stringify([k.colors, k.heading, k.body, k.logos, k.primaryLogo]);
  next.revision = looks(next) === looks(current) ? current.revision : current.revision + 1;
  set({ brand: next, brandSet: true });
  installBrand(next);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    api.call('x:brand:set', get().brand).catch((err) => toast('error', 'Could not save the brand kit', errorText(err)));
  }, 350);
}

/** Average relative luminance of the opaque pixels of a picture. */
function averageLuma(bitmap: ImageBitmap): number {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0.5;
  ctx.drawImage(bitmap, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;
  let sum = 0;
  let n = 0;
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    n++;
  }
  return n ? sum / n : 0.5;
}

/** Ask for a logo file, keep a copy in the brand folder and add it to the kit. */
export async function addBrandLogo(): Promise<BrandLogo | null> {
  try {
    const res = await api.call<{ id: string; name: string; path: string; size: number } | null>('x:brand:importLogo');
    if (!res) return null;
    const bitmap = await loadImageBitmap(api.media.toUrl(res.path));
    const logo: BrandLogo = { id: res.id, name: res.name, path: res.path, width: bitmap.width, height: bitmap.height, luma: Math.round(averageLuma(bitmap) * 1000) / 1000 };
    bitmap.close();
    updateBrand((k) => {
      k.logos.push(logo);
      if (!k.primaryLogo) k.primaryLogo = logo.id;
    });
    return logo;
  } catch (err) {
    toast('error', 'Could not add the logo', errorText(err));
    return null;
  }
}

export async function removeBrandLogo(id: string): Promise<void> {
  const logo = get().brand.logos.find((l) => l.id === id);
  if (!logo) return;
  updateBrand((k) => {
    k.logos = k.logos.filter((l) => l.id !== id);
    if (k.primaryLogo === id) k.primaryLogo = k.logos[0]?.id;
  });
  forgetThumbImage(logoAsset(logo).id);
  // The file stays on disk while projects may still use it; only the kit forgets it.
}

// ---------------------------------------------------------------------------------------------
// User templates
// ---------------------------------------------------------------------------------------------

interface StoredTemplate {
  dir: string;
  json: unknown;
  poster: string | null;
}

const registrations = new Map<string, () => void>();

/** Validate a stored template and register it with the library. */
async function adoptTemplate(stored: StoredTemplate): Promise<UserTemplateEntry | null> {
  const parsed = parseUserTemplate(stored.json, stored.dir);
  if (!parsed.ok) {
    console.warn('[templates] skipped an invalid user template', stored.dir, parsed.errors.slice(0, 5));
    return null;
  }
  return registerUserTemplate(parsed.value, stored);
}

async function registerUserTemplate(t: ParsedUserTemplate, stored: StoredTemplate): Promise<UserTemplateEntry> {
  await ensureThumbImages(t.assets.filter((a) => a.kind !== 'audio'));
  const def = userTemplateDef(t);
  registrations.get(def.id)?.();
  const reg = registerContent('user', { templates: [def] });
  registrations.set(def.id, reg.unregister);
  return { id: def.id, file: t.file, dir: stored.dir, poster: stored.poster, assets: t.assets, def };
}

function replaceEntry(entry: UserTemplateEntry): void {
  set((s) => {
    const i = s.templates.findIndex((t) => t.id === entry.id);
    const templates = [...s.templates];
    if (i >= 0) templates[i] = entry;
    else templates.push(entry);
    return { templates };
  });
}

/** Store a serialised template (with its poster and embedded media) and add it to the gallery. */
export async function storeUserTemplate(file: UserTemplateFile, poster: Uint8Array | null, embed: { assetId: ID; from: string; file: string }[]): Promise<UserTemplateEntry> {
  const stored = await api.call<StoredTemplate>('x:templates:save', file, poster, embed);
  const entry = await adoptTemplate(stored);
  if (!entry) throw new Error('The saved template could not be read back.');
  replaceEntry(entry);
  return entry;
}

export async function renameUserTemplate(id: string, patch: { name?: string; category?: string; tags?: string[] }): Promise<void> {
  try {
    const stored = await api.call<StoredTemplate>('x:templates:update', id, patch);
    const entry = await adoptTemplate(stored);
    if (entry) replaceEntry(entry);
  } catch (err) {
    toast('error', 'Could not rename the template', errorText(err));
  }
}

export async function duplicateUserTemplate(id: string): Promise<UserTemplateEntry | null> {
  const src = get().templates.find((t) => t.id === id);
  if (!src) return null;
  try {
    const stored = await api.call<StoredTemplate>('x:templates:duplicate', id, newUserTemplateId(), `${src.file.name} copy`.slice(0, 80));
    const entry = await adoptTemplate(stored);
    if (entry) replaceEntry(entry);
    return entry;
  } catch (err) {
    toast('error', 'Could not duplicate the template', errorText(err));
    return null;
  }
}

export async function deleteUserTemplate(id: string): Promise<void> {
  try {
    await api.call('x:templates:delete', id);
    registrations.get(id)?.();
    registrations.delete(id);
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  } catch (err) {
    toast('error', 'Could not delete the template', errorText(err));
  }
}

export const userTemplate = (id: string): UserTemplateEntry | undefined => get().templates.find((t) => t.id === id);

// ---------------------------------------------------------------------------------------------
// Content packs
// ---------------------------------------------------------------------------------------------

const packRegistrations = new Map<string, () => void>();

/** Validate pack text, compiling every shader in a throw-away WebGL2 context. */
export function checkPack(text: string, replacing?: string): PackValidation {
  return validatePack(text, { compile: compilePackShader, replacing });
}

function packEntry(pack: ContentPack, file: string, errors: string[] = [], loaded = true): InstalledPack {
  return { id: pack.id, name: pack.name, file, author: pack.author, packVersion: pack.packVersion, description: pack.description, summary: packSummary(pack), errors, loaded };
}

function registerPack(pack: ContentPack): void {
  packRegistrations.get(pack.id)?.();
  const reg = registerContent(`pack:${pack.id}`, packContent(pack));
  packRegistrations.set(pack.id, reg.unregister);
}

export interface InstallResult {
  ok: boolean;
  /** Validation problems (when not ok). */
  errors: string[];
  warnings: string[];
  pack?: InstalledPack;
  replaced?: boolean;
}

/** Validate and install pack text (from a picked file). */
export async function installPackText(text: string): Promise<InstallResult> {
  // A pack with the same id replaces the installed one (an update): its own ids are not collisions.
  let id: string | undefined;
  try {
    const raw = JSON.parse(text) as { id?: unknown };
    if (typeof raw?.id === 'string') id = raw.id;
  } catch {
    /* reported by the validator */
  }
  const replacing = id && get().packs.some((p) => p.id === id) ? id : undefined;
  const res = checkPack(text, replacing);
  if (!res.ok || !res.pack) return { ok: false, errors: res.errors, warnings: res.warnings };
  try {
    const file = await api.call<string>('x:packs:install', res.pack.id, text);
    registerPack(res.pack);
    const entry = packEntry(res.pack, file);
    set((s) => ({ packs: [...s.packs.filter((p) => p.id !== entry.id), entry].sort((a, b) => a.name.localeCompare(b.name)) }));
    return { ok: true, errors: [], warnings: res.warnings, pack: entry, replaced: !!replacing };
  } catch (err) {
    return { ok: false, errors: [errorText(err)], warnings: [] };
  }
}

/** Ask for a `.kinorapack` file. Returns null when cancelled. */
export async function pickPackFile(): Promise<{ name: string; text: string } | null> {
  return api.call<{ name: string; text: string } | null>('x:packs:pick');
}

export async function removePack(id: string): Promise<void> {
  try {
    await api.call('x:packs:remove', id);
    packRegistrations.get(id)?.();
    packRegistrations.delete(id);
    set((s) => ({ packs: s.packs.filter((p) => p.id !== id) }));
  } catch (err) {
    toast('error', 'Could not remove the pack', errorText(err));
  }
}

// ---------------------------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------------------------

let booted: Promise<void> | null = null;

/** Load preferences, the brand kit, user templates and installed packs (once). */
export function bootTemplates(): Promise<void> {
  booted ??= (async () => {
    try {
      const [useBrand, includeMusic] = await Promise.all([api.settings.get<boolean>('templates.useBrand'), api.settings.get<boolean>('templates.includeMusic')]);
      set({ useBrand: useBrand === true, includeMusic: includeMusic !== false });
    } catch {
      /* defaults */
    }
    // Packs first: user templates may use pack effects.
    try {
      const files = await api.call<{ file: string; text: string }[]>('x:packs:list');
      const packs: InstalledPack[] = [];
      for (const f of files) {
        const res = checkPack(f.text);
        if (res.ok && res.pack) {
          registerPack(res.pack);
          packs.push(packEntry(res.pack, f.file));
        } else {
          const name = f.file.split(/[\\/]/).pop() ?? f.file;
          packs.push({ id: name.replace(/\.kinorapack$/, ''), name, file: f.file, summary: '', errors: res.errors, loaded: false });
        }
      }
      set({ packs });
      const broken = packs.filter((p) => !p.loaded);
      if (broken.length) toast('warning', `${broken.length === 1 ? 'A content pack' : `${broken.length} content packs`} could not be loaded`, `${broken.map((b) => b.name).join(', ')} — see Settings › Content packs.`);
    } catch (err) {
      console.warn('[packs] could not list packs', err);
    }
    try {
      const { kit, logosDir } = await api.call<{ kit: unknown; logosDir: string }>('x:brand:get');
      const brand = kit ? sanitizeBrandKit(kit) : DEFAULT_BRAND;
      set({ brand, brandSet: !!kit, logosDir });
      installBrand(brand);
    } catch (err) {
      console.warn('[brand] could not load the brand kit', err);
      installBrand(DEFAULT_BRAND);
    }
    try {
      const stored = await api.call<StoredTemplate[]>('x:templates:list');
      const created = (s: StoredTemplate): number => Number((s.json as { createdAt?: unknown })?.createdAt) || 0;
      stored.sort((a, b) => created(a) - created(b));
      const entries: UserTemplateEntry[] = [];
      for (const s of stored) {
        const e = await adoptTemplate(s);
        if (e) entries.push(e);
      }
      entries.sort((a, b) => a.file.createdAt - b.file.createdAt);
      set({ templates: entries });
    } catch (err) {
      console.warn('[templates] could not list user templates', err);
    }
    set({ ready: true });
  })();
  return booted;
}

/** True when a template id belongs to the user's saved templates. */
export const isUserTemplateId = (id: string): boolean => getTemplate(id)?.origin?.kind === 'user';

export { BRAND_PALETTE_ID };
