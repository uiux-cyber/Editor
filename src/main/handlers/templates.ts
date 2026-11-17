/**
 * Templates & branding: the files behind user templates, the brand kit and content packs.
 * Everything lives in app-owned folders under userData:
 *
 *   templates/<id>/template.json   a saved user template (clip JSON)
 *   templates/<id>/poster.png      its rendered poster
 *   templates/<id>/media/…         media embedded in the template (optional)
 *   brand/brand.json               the brand kit
 *   brand/logos/<id>.<ext>         copies of the brand logos
 *   packs/<id>.kinorapack          installed content packs (data only, validated by the renderer)
 *
 * The renderer never names a destination path: ids are validated here and folders are derived
 * from them. Source files are only read when the user picked them in a native dialog (logos,
 * packs) or when they are media of the open project (embedding into a template).
 */

import { dialog, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { IMAGE_EXTS, MEDIA_EXTS, extOf } from '@shared/ipc';
import type { MainContext } from '../context';

const TEMPLATE_ID = /^user-[a-z0-9]{6,40}$/;
const PACK_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const MEDIA_FILE = /^[A-Za-z0-9 ._()-]{1,140}$/;
const MAX_TEMPLATE_JSON = 4 * 1024 * 1024;
const MAX_POSTER = 8 * 1024 * 1024;
const MAX_PACK = 8 * 1024 * 1024;
const MAX_LOGO = 25 * 1024 * 1024;
const MAX_BRAND_JSON = 256 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  await fsp.rename(tmp, file);
}

async function readText(file: string, max: number): Promise<string | null> {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile() || st.size > max) return null;
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

const exists = async (p: string): Promise<boolean> => !!(await fsp.stat(p).catch(() => null));

/** Move to the OS recycle bin when possible (user data is never destroyed outright). */
async function discard(p: string, permanently: boolean): Promise<void> {
  try {
    if (permanently) throw new Error('skip the recycle bin');
    await shell.trashItem(p);
  } catch {
    await fsp.rm(p, { recursive: true, force: true });
  }
}

export interface StoredTemplate {
  /** Absolute template folder. */
  dir: string;
  /** Parsed template.json (validated by the renderer). */
  json: unknown;
  /** Absolute path of the poster, if any. */
  poster: string | null;
}

export default function register(ctx: MainContext): void {
  const root = (...parts: string[]): string => path.join(ctx.userData(), ...parts);
  const templateDir = (id: string): string => {
    if (typeof id !== 'string' || !TEMPLATE_ID.test(id)) throw new Error('Invalid template id.');
    return root('templates', id);
  };

  async function readTemplate(dir: string): Promise<StoredTemplate | null> {
    const text = await readText(path.join(dir, 'template.json'), MAX_TEMPLATE_JSON);
    if (!text) return null;
    try {
      const json = JSON.parse(text) as unknown;
      const poster = path.join(dir, 'poster.png');
      return { dir, json, poster: (await exists(poster)) ? poster : null };
    } catch {
      return null;
    }
  }

  // ---- User templates ------------------------------------------------------------------------

  ctx.handle('x:templates:list', async (): Promise<StoredTemplate[]> => {
    let names: string[] = [];
    try {
      names = await fsp.readdir(root('templates'));
    } catch {
      return [];
    }
    const out: StoredTemplate[] = [];
    for (const name of names.filter((n) => TEMPLATE_ID.test(n))) {
      const t = await readTemplate(root('templates', name));
      if (t) out.push(t);
    }
    return out;
  });

  ctx.handle('x:templates:save', async (json: unknown, poster: Uint8Array | null, embed: { assetId: string; from: string; file: string }[]): Promise<StoredTemplate> => {
    if (!isObj(json) || typeof json.id !== 'string') throw new Error('Invalid template.');
    const dir = templateDir(json.id);
    if (await exists(dir)) throw new Error('A template with this id already exists.');
    const text = JSON.stringify(json);
    if (text.length > MAX_TEMPLATE_JSON) throw new Error('The template is too large.');
    if (poster && poster.byteLength > MAX_POSTER) throw new Error('The poster image is too large.');
    try {
      await fsp.mkdir(dir, { recursive: true });
      // Media copies first, so a template never references files that are missing.
      for (const e of Array.isArray(embed) ? embed : []) {
        if (!isObj(e) || typeof e.from !== 'string' || typeof e.file !== 'string' || !MEDIA_FILE.test(e.file) || e.file.includes('..')) throw new Error('Invalid media file name.');
        if (!path.isAbsolute(e.from) || !MEDIA_EXTS.includes(extOf(e.from)) || extOf(e.file) !== extOf(e.from)) throw new Error(`"${path.basename(e.from)}" cannot be embedded.`);
        const st = await fsp.stat(e.from).catch(() => null);
        if (!st || !st.isFile()) throw new Error(`"${path.basename(e.from)}" could not be found.`);
        await fsp.mkdir(path.join(dir, 'media'), { recursive: true });
        await fsp.copyFile(e.from, path.join(dir, 'media', e.file));
      }
      if (poster && poster.byteLength > 0) await writeAtomic(path.join(dir, 'poster.png'), poster);
      await writeAtomic(path.join(dir, 'template.json'), text);
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
    return (await readTemplate(dir))!;
  });

  ctx.handle('x:templates:update', async (id: string, patch: { name?: unknown; category?: unknown; tags?: unknown }): Promise<StoredTemplate> => {
    const dir = templateDir(id);
    const current = await readTemplate(dir);
    if (!current || !isObj(current.json)) throw new Error('The template could not be found.');
    const next: Record<string, unknown> = { ...current.json, updatedAt: Date.now() };
    if (typeof patch?.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 80);
    if (typeof patch?.category === 'string') next.category = patch.category.slice(0, 40);
    if (Array.isArray(patch?.tags)) next.tags = patch.tags.filter((t) => typeof t === 'string').map((t) => (t as string).slice(0, 40)).slice(0, 20);
    await writeAtomic(path.join(dir, 'template.json'), JSON.stringify(next));
    return (await readTemplate(dir))!;
  });

  ctx.handle('x:templates:duplicate', async (id: string, newId: string, newName: string): Promise<StoredTemplate> => {
    const from = templateDir(id);
    const to = templateDir(newId);
    const current = await readTemplate(from);
    if (!current || !isObj(current.json)) throw new Error('The template could not be found.');
    if (await exists(to)) throw new Error('A template with this id already exists.');
    try {
      await fsp.cp(from, to, { recursive: true, errorOnExist: true });
      const now = Date.now();
      const json = { ...current.json, id: newId, name: String(newName || current.json.name).slice(0, 80), createdAt: now, updatedAt: now };
      await writeAtomic(path.join(to, 'template.json'), JSON.stringify(json));
    } catch (err) {
      await fsp.rm(to, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
    return (await readTemplate(to))!;
  });

  ctx.handle('x:templates:delete', async (id: string): Promise<void> => {
    const dir = templateDir(id);
    if (await exists(dir)) await discard(dir, !!ctx.e2eDir);
  });

  // ---- Brand kit -----------------------------------------------------------------------------

  const logosDir = (): string => root('brand', 'logos');

  ctx.handle('x:brand:get', async (): Promise<{ kit: unknown; logosDir: string }> => {
    const text = await readText(root('brand', 'brand.json'), MAX_BRAND_JSON);
    let kit: unknown = null;
    try {
      kit = text ? JSON.parse(text) : null;
    } catch {
      kit = null;
    }
    return { kit, logosDir: logosDir() };
  });

  ctx.handle('x:brand:set', async (kit: unknown): Promise<void> => {
    if (!isObj(kit)) throw new Error('Invalid brand kit.');
    const text = JSON.stringify(kit);
    if (text.length > MAX_BRAND_JSON) throw new Error('The brand kit is too large.');
    await writeAtomic(root('brand', 'brand.json'), text);
  });

  /** Pick an image in a native dialog and keep a copy as a brand logo. */
  ctx.handle('x:brand:importLogo', async (): Promise<{ id: string; name: string; path: string; size: number } | null> => {
    let source: string | null = null;
    if (ctx.e2eDir) {
      // Automated tests: the "picked" file is a fixed name in the test folder.
      const candidate = path.join(ctx.e2eDir, 'e2e-pick-logo.png');
      source = (await exists(candidate)) ? candidate : null;
    } else {
      const win = ctx.window();
      const opts = { title: 'Add a logo', properties: ['openFile' as const], filters: [{ name: 'Images', extensions: IMAGE_EXTS.filter((e) => e !== 'gif') }] };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      source = res.canceled ? null : (res.filePaths[0] ?? null);
    }
    if (!source) return null;
    const ext = extOf(source);
    if (!IMAGE_EXTS.includes(ext)) throw new Error('Logos must be image files (PNG, SVG, WebP, JPEG…).');
    const st = await fsp.stat(source);
    if (!st.isFile() || st.size > MAX_LOGO) throw new Error('The logo file is too large (25 MB max).');
    const id = `logo-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const dest = path.join(logosDir(), `${id}.${ext}`);
    await fsp.mkdir(logosDir(), { recursive: true });
    await fsp.copyFile(source, dest);
    return { id, name: path.basename(source), path: dest, size: st.size };
  });

  ctx.handle('x:brand:removeLogo', async (file: string): Promise<void> => {
    if (typeof file !== 'string') return;
    const resolved = path.resolve(file);
    if (path.dirname(resolved).toLowerCase() !== path.resolve(logosDir()).toLowerCase()) throw new Error('Not a brand logo.');
    await fsp.rm(resolved, { force: true });
  });

  // ---- Content packs -------------------------------------------------------------------------

  ctx.handle('x:packs:list', async (): Promise<{ file: string; text: string }[]> => {
    let names: string[] = [];
    try {
      names = await fsp.readdir(root('packs'));
    } catch {
      return [];
    }
    const out: { file: string; text: string }[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.kinorapack') || !PACK_ID.test(name.slice(0, -'.kinorapack'.length))) continue;
      const file = root('packs', name);
      const text = await readText(file, MAX_PACK);
      if (text !== null) out.push({ file, text });
    }
    return out;
  });

  /** Pick a pack file in a native dialog and return its text (validated by the renderer). */
  ctx.handle('x:packs:pick', async (): Promise<{ name: string; text: string } | null> => {
    let source: string | null = null;
    if (ctx.e2eDir) {
      const candidate = path.join(ctx.e2eDir, 'e2e-pick.kinorapack');
      source = (await exists(candidate)) ? candidate : null;
    } else {
      const win = ctx.window();
      const opts = { title: 'Install content pack', properties: ['openFile' as const], filters: [{ name: 'Kinora content pack', extensions: ['kinorapack'] }] };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      source = res.canceled ? null : (res.filePaths[0] ?? null);
    }
    if (!source) return null;
    const st = await fsp.stat(source);
    if (!st.isFile()) throw new Error('The pack could not be read.');
    if (st.size > MAX_PACK) throw new Error('The pack is too large (8 MB max).');
    return { name: path.basename(source), text: await fsp.readFile(source, 'utf8') };
  });

  ctx.handle('x:packs:install', async (id: string, text: string): Promise<string> => {
    if (typeof id !== 'string' || !PACK_ID.test(id)) throw new Error('Invalid pack id.');
    if (typeof text !== 'string' || text.length > MAX_PACK) throw new Error('Invalid pack.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('The pack is not valid JSON.');
    }
    if (!isObj(parsed) || parsed.format !== 'kinora-pack' || parsed.id !== id) throw new Error('This file is not a Kinora content pack.');
    const file = root('packs', `${id}.kinorapack`);
    await writeAtomic(file, text);
    return file;
  });

  ctx.handle('x:packs:remove', async (id: string): Promise<void> => {
    if (typeof id !== 'string' || !PACK_ID.test(id)) throw new Error('Invalid pack id.');
    const file = root('packs', `${id}.kinorapack`);
    if (await exists(file)) await discard(file, !!ctx.e2eDir);
  });
}
