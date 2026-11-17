/**
 * The media protocol serves local files by path. JSON and .lottie files are only served when
 * they really are Lottie animations, so the renderer cannot use the protocol to read arbitrary
 * JSON documents (settings, credentials…) from disk. Results are cached per path + mtime + size.
 */

import * as fsp from 'node:fs/promises';

const MAX_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, { key: string; ok: boolean }>();

/** Bodymovin document: numeric frame rate, in / out points, size and a layer list. */
function looksLikeLottie(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return false;
  const d = doc as Record<string, unknown>;
  const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
  return num(d.fr) && num(d.ip) && num(d.op) && num(d.w) && num(d.h) && Array.isArray(d.layers);
}

/** dotLottie archive: a ZIP whose central directory lists a manifest or an animation JSON. */
function looksLikeDotLottie(buf: Buffer): boolean {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return false;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return false;
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/^\.?\//, '');
    if (name === 'manifest.json' || /^(animations|a)\/[^/]+\.json$/i.test(name)) return true;
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return false;
}

export async function isLottieFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return false;
    const key = `${stat.mtimeMs}:${stat.size}`;
    const hit = cache.get(filePath);
    if (hit && hit.key === key) return hit.ok;
    const buf = await fsp.readFile(filePath);
    let ok = false;
    if (filePath.toLowerCase().endsWith('.lottie')) ok = looksLikeDotLottie(buf);
    else {
      try {
        ok = looksLikeLottie(JSON.parse(buf.toString('utf8').replace(/^﻿/, '')));
      } catch {
        ok = false;
      }
    }
    if (cache.size > 256) cache.clear();
    cache.set(filePath, { key, ok });
    return ok;
  } catch {
    return false;
  }
}
