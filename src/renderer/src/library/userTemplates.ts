/**
 * User templates: a selection of clips saved as a reusable design ("Save as template…").
 *
 * On disk (userData/templates/<id>/template.json, written by the main process) a template is
 * plain clip JSON with times relative to its start. Media used by the clips becomes placeholders
 * (slots) by default — the user drops new media on them after applying — or, when embedding is
 * chosen, the files are copied to `media/` next to the template and referenced relatively.
 *
 * Pure (no DOM / IPC): shared by the renderer and the unit tests.
 */

import { uid } from '@/core/factory';
import { designSize, fitContain } from '@/core/project';
import type { Clip, ID, MediaAsset, Project, ShapeClip, VisualClip } from '@/core/types';
import { Problems, TEMPLATE_CATEGORIES, isObj, sanitizeClips, scanJson, staticTemplateDef } from './staticTemplates';
import type { TemplateCategory, TemplateDef } from './types';

export const USER_TEMPLATE_FORMAT = 'kinora-template';
export const USER_TEMPLATE_VERSION = 1;
/** Registry ids of user templates start with this prefix. */
export const USER_TEMPLATE_PREFIX = 'user-';
export const USER_ID_RE = /^user-[a-z0-9]{6,40}$/;
const MEDIA_REL_RE = /^media\/[A-Za-z0-9 ._()-]{1,140}$/;

/** A media file embedded in a template, relative to the template folder. */
export interface EmbeddedAsset extends Omit<MediaAsset, 'source'> {
  source: { type: 'file'; path: string } | { type: 'generated'; soundId: string };
}

export interface UserTemplateFile {
  format: typeof USER_TEMPLATE_FORMAT;
  version: typeof USER_TEMPLATE_VERSION;
  /** `user-…` */
  id: string;
  name: string;
  category: TemplateCategory;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** Seconds. */
  duration: number;
  /** Pixel size of the project the template was saved from (its aspect ratio is the design frame). */
  design: { width: number; height: number };
  /** Bottom → top, times relative to the template start, no track / group ids. */
  clips: Clip[];
  /** Media the clips still reference (embedded files and built-in sounds), by asset id. */
  assets: Record<ID, EmbeddedAsset>;
}

export interface SaveOptions {
  name: string;
  category: TemplateCategory;
  tags: string[];
  /** Copy media files into the template instead of turning them into placeholders. */
  embedMedia: boolean;
  /** Folder of the brand logos: media from there becomes a `Logo` placeholder. */
  brandDir?: string;
}

/** A file the main process must copy into the template's `media/` folder. */
export interface EmbedRequest {
  assetId: ID;
  /** Absolute path of the source file. */
  from: string;
  /** File name inside `media/`. */
  file: string;
}

export interface SerializedSelection {
  file: UserTemplateFile;
  embed: EmbedRequest[];
  summary: { layers: number; placeholders: number; embedded: number; skipped: string[] };
}

const isMediaClip = (c: Clip): c is Extract<Clip, { type: 'video' | 'image' }> => c.type === 'video' || c.type === 'image';

/** A file name safe for `media/` (keeps the extension, adds a counter on duplicates). */
function mediaFileName(path: string, used: Set<string>): string {
  const base = path.split(/[\\/]/).pop() ?? 'media';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : 'bin';
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9 ._()-]/g, '_').slice(0, 80) || 'media';
  let name = `${stem}.${ext}`;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem} (${i}).${ext}`;
  used.add(name.toLowerCase());
  return name;
}

/** The on-screen box (scale 1) of a media clip, in design px. */
function mediaBox(clip: VisualClip & { assetId: ID }, asset: MediaAsset | undefined, cw: number, ch: number): { w: number; h: number } {
  const crop = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const keepW = Math.max(0.01, 1 - crop.l - crop.r);
  const keepH = Math.max(0.01, 1 - crop.t - crop.b);
  return fitContain((asset?.width || cw) * keepW, (asset?.height || ch) * keepH, cw, ch);
}

/** A placeholder occupying exactly the box of a media clip (keeps timing, motion and look). */
export function slotForMedia(clip: VisualClip & { assetId: ID }, asset: MediaAsset | undefined, cw: number, ch: number, name: string): ShapeClip {
  const box = mediaBox(clip, asset, cw, ch);
  const radius = clip.cornerRadius ? (clip.cornerRadius * Math.min(box.w, box.h)) / 2 : 0;
  const slot: ShapeClip = {
    id: uid('sh_'),
    trackId: '',
    name,
    start: clip.start,
    duration: clip.duration,
    ...(clip.keyframes ? { keyframes: clip.keyframes } : {}),
    transform: { ...clip.transform },
    blendMode: clip.blendMode,
    ...(clip.flipH ? { flipH: true } : {}),
    ...(clip.flipV ? { flipV: true } : {}),
    ...(clip.mask ? { mask: clip.mask } : {}),
    ...(clip.adjust ? { adjust: clip.adjust } : {}),
    ...(clip.filter ? { filter: clip.filter } : {}),
    effects: clip.effects,
    ...(clip.anim ? { anim: clip.anim } : {}),
    type: 'shape',
    shape: {
      kind: 'rect',
      width: Math.round(box.w * 100) / 100,
      height: Math.round(box.h * 100) / 100,
      fill: { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#3a3f4b' }, { offset: 1, color: '#23262e' }] },
      radius: Math.round(radius * 100) / 100,
      slot: true,
    },
  };
  return slot;
}

/**
 * Turn selected clips into a user template. Clips are ordered bottom → top (the order the
 * template engine expects), shifted so the first one starts at 0, and stripped of track, group
 * and link ids. Media becomes placeholders unless `embedMedia` is set; built-in sounds are kept.
 */
export function serializeSelection(project: Project, ids: ID[], opts: SaveOptions, now = Date.now()): SerializedSelection {
  const { cw, ch } = designSize(project.settings);
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const picked = ids.map((id) => project.clips[id]).filter((c): c is Clip => !!c);
  // Bottom → top: visual tracks are listed top → bottom, so a higher index is lower.
  const visual = picked.filter((c) => c.type !== 'audio').sort((a, b) => (trackIndex.get(b.trackId) ?? 0) - (trackIndex.get(a.trackId) ?? 0) || a.start - b.start);
  const audio = picked.filter((c) => c.type === 'audio').sort((a, b) => a.start - b.start);
  const ordered = [...visual, ...audio];
  const skipped: string[] = [];
  const origin = ordered.length ? Math.min(...ordered.map((c) => c.start)) : 0;
  const clips: Clip[] = [];
  const assets: Record<ID, EmbeddedAsset> = {};
  const embed: EmbedRequest[] = [];
  const usedNames = new Set<string>();
  let placeholders = 0;
  let mediaCount = 0;
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  const brandDir = opts.brandDir ? norm(opts.brandDir).replace(/\/?$/, '/') : null;

  const keepAsset = (asset: MediaAsset): boolean => {
    if (assets[asset.id]) return true;
    if (asset.source.type === 'generated') {
      assets[asset.id] = { ...asset, source: { type: 'generated', soundId: asset.source.soundId } };
      return true;
    }
    if (!opts.embedMedia) return false;
    const file = mediaFileName(asset.source.path, usedNames);
    embed.push({ assetId: asset.id, from: asset.source.path, file });
    const { proxy: _p, transcodedFrom: _t, ...rest } = asset;
    assets[asset.id] = { ...rest, source: { type: 'file', path: `media/${file}` } };
    return true;
  };

  for (const original of ordered) {
    const clip = JSON.parse(JSON.stringify(original)) as Clip;
    clip.start = Math.max(0, Math.round((clip.start - origin) * 1e6) / 1e6);
    clip.trackId = '';
    delete clip.groupId;
    delete clip.linkId;
    if (clip.type === 'compound') {
      skipped.push(`${clip.name} (nested sequence)`);
      continue;
    }
    if (clip.type === 'text' && clip.caption) delete clip.caption;
    if (isMediaClip(clip)) {
      const asset = project.assets[clip.assetId];
      const isBrandLogo = !!asset && asset.source.type === 'file' && !!brandDir && norm(asset.source.path).startsWith(brandDir);
      if (asset && !isBrandLogo && keepAsset(asset)) {
        if (clip.type === 'video') delete clip.speedRamp;
        clips.push(clip);
        continue;
      }
      mediaCount++;
      const name = isBrandLogo ? 'Logo' : `${clip.type === 'video' ? 'Video' : 'Photo'} ${mediaCount}`;
      clips.push(slotForMedia(clip, asset, cw, ch, name));
      placeholders++;
      continue;
    }
    if (clip.type === 'audio') {
      const asset = project.assets[clip.assetId];
      if (asset && keepAsset(asset)) {
        delete clip.speedRamp;
        clips.push(clip);
      } else skipped.push(`${clip.name} (audio file — turn on "Embed media" to keep it)`);
      continue;
    }
    clips.push(clip);
  }
  const duration = clips.length ? Math.max(...clips.map((c) => c.start + c.duration)) : 0;
  const file: UserTemplateFile = {
    format: USER_TEMPLATE_FORMAT,
    version: USER_TEMPLATE_VERSION,
    id: newUserTemplateId(),
    name: opts.name.trim().slice(0, 80) || 'My template',
    category: opts.category,
    tags: [...new Set(opts.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20),
    createdAt: now,
    updatedAt: now,
    duration: Math.round(duration * 1000) / 1000,
    design: { width: project.settings.width, height: project.settings.height },
    clips,
    assets,
  };
  return { file, embed, summary: { layers: clips.length, placeholders, embedded: embed.length, skipped } };
}

export function newUserTemplateId(): string {
  const rnd = Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  return `${USER_TEMPLATE_PREFIX}${Date.now().toString(36)}${rnd}`;
}

/** Join a folder and a relative `media/…` path with the folder's own separator. */
function joinPath(dir: string, rel: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`;
}

export interface ParsedUserTemplate {
  file: UserTemplateFile;
  /** Assets with absolute paths, ready to be added to a project. */
  assets: MediaAsset[];
  warnings: string[];
}

/**
 * Validate a template read from disk. `dir` is the template folder (absolute); embedded media
 * paths must stay inside its `media/` folder. Returns null with errors when unusable.
 */
export function parseUserTemplate(raw: unknown, dir: string): { ok: true; value: ParsedUserTemplate } | { ok: false; errors: string[] } {
  const p = new Problems(40);
  if (!isObj(raw)) return { ok: false, errors: ['template: must be a JSON object'] };
  const scan = scanJson(raw);
  if (scan) return { ok: false, errors: [`template: ${scan}`] };
  if (raw.format !== USER_TEMPLATE_FORMAT) p.error('format', `must be "${USER_TEMPLATE_FORMAT}"`);
  if (raw.version !== USER_TEMPLATE_VERSION) p.error('version', `must be ${USER_TEMPLATE_VERSION}`);
  if (typeof raw.id !== 'string' || !USER_ID_RE.test(raw.id)) p.error('id', 'is not a user template id');
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : null;
  if (!name) p.error('name', 'is required');
  const category = TEMPLATE_CATEGORIES.includes(raw.category as TemplateCategory) ? (raw.category as TemplateCategory) : null;
  if (!category) p.error('category', 'is not a template category');
  const duration = typeof raw.duration === 'number' && raw.duration > 0 && raw.duration <= 3600 ? raw.duration : null;
  if (!duration) p.error('duration', 'must be 0..3600 seconds');
  const design = isObj(raw.design) ? raw.design : {};
  const width = typeof design.width === 'number' && design.width >= 16 && design.width <= 8192 ? design.width : null;
  const height = typeof design.height === 'number' && design.height >= 16 && design.height <= 8192 ? design.height : null;
  if (!width || !height) p.error('design', 'must be { width, height } in pixels');
  if (!p.ok) return { ok: false, errors: p.errors };

  // Assets: only files inside media/ and built-in sounds.
  const assets: Record<ID, MediaAsset> = {};
  const embedded: Record<ID, EmbeddedAsset> = {};
  const rawAssets = isObj(raw.assets) ? raw.assets : {};
  for (const [id, a] of Object.entries(rawAssets)) {
    if (!isObj(a) || !isObj(a.source) || typeof a.id !== 'string' || a.id !== id) {
      p.error(`assets.${id}`, 'is not a media asset');
      continue;
    }
    const kind = a.kind;
    if (kind !== 'video' && kind !== 'image' && kind !== 'audio' && kind !== 'animation') {
      p.error(`assets.${id}.kind`, 'is not a media kind');
      continue;
    }
    const src = a.source;
    const n = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
    const base = {
      id,
      kind,
      name: typeof a.name === 'string' ? a.name.slice(0, 200) : 'Media',
      duration: n(a.duration),
      width: Math.round(n(a.width)),
      height: Math.round(n(a.height)),
      fps: n(a.fps),
      hasVideo: a.hasVideo === true,
      hasAudio: a.hasAudio === true,
      size: n(a.size),
      addedAt: n(a.addedAt),
      ...(typeof a.videoCodec === 'string' ? { videoCodec: a.videoCodec.slice(0, 40) } : {}),
      ...(typeof a.audioCodec === 'string' ? { audioCodec: a.audioCodec.slice(0, 40) } : {}),
      ...(a.format === 'gif' || a.format === 'webp' || a.format === 'apng' || a.format === 'lottie' ? { format: a.format } : {}),
    } as Omit<MediaAsset, 'source'>;
    if (src.type === 'generated' && typeof src.soundId === 'string') {
      embedded[id] = { ...base, source: { type: 'generated', soundId: src.soundId } };
      assets[id] = { ...base, source: { type: 'generated', soundId: src.soundId } };
    } else if (src.type === 'file' && typeof src.path === 'string' && MEDIA_REL_RE.test(src.path) && !src.path.includes('..')) {
      embedded[id] = { ...base, source: { type: 'file', path: src.path } };
      assets[id] = { ...base, source: { type: 'file', path: joinPath(dir, src.path) } };
    } else p.error(`assets.${id}.source`, 'must be a file inside media/ or a built-in sound');
  }
  const clips = sanitizeClips(p, 'clips', raw.clips, { assets, anyFont: true });
  if (!p.ok) return { ok: false, errors: p.errors };
  const file: UserTemplateFile = {
    format: USER_TEMPLATE_FORMAT,
    version: USER_TEMPLATE_VERSION,
    id: raw.id as string,
    name: name!,
    category: category!,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 40)).slice(0, 20) : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    duration: duration!,
    design: { width: width!, height: height! },
    clips,
    assets: embedded,
  };
  return { ok: true, value: { file, assets: Object.values(assets), warnings: p.warnings } };
}

/** The template engine definition of a parsed user template. */
export function userTemplateDef(t: ParsedUserTemplate): TemplateDef {
  return staticTemplateDef({
    id: t.file.id,
    name: t.file.name,
    category: t.file.category,
    tags: t.file.tags,
    duration: Math.max(0.1, t.file.duration),
    design: t.file.design,
    clips: t.file.clips,
    assets: t.assets,
    origin: { kind: 'user', id: t.file.id },
  });
}
