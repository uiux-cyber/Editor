/**
 * dotLottie (.lottie) reader: a ZIP archive holding `manifest.json`, the animation JSON under
 * `animations/` (v1) or `a/` (v2) and its images under `images/` / `i/`. Unzipped with the
 * browser's DecompressionStream (no extra dependency); images are inlined as data URLs so the
 * animation renders without any further file access.
 */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

const td = new TextDecoder();

function readEntries(buf: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // End of central directory: scan backwards over the (optional) comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/^\.?\//, '');
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('corrupt zip entry');
    const offset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.set(name, { name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array> {
  const raw = new Uint8Array(buf, e.offset, e.compressedSize);
  if (e.method === 0) return raw.slice();
  if (e.method !== 8) throw new Error(`unsupported zip compression (${e.method})`);
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

/** The first animation of a .lottie archive as a parsed Lottie document (images inlined). */
export async function readDotLottie(buf: ArrayBuffer): Promise<unknown> {
  const entries = readEntries(buf);
  let animId: string | null = null;
  const manifest = entries.get('manifest.json');
  if (manifest) {
    try {
      const m = JSON.parse(td.decode(await inflate(buf, manifest))) as { animations?: { id?: string }[]; initial?: { animation?: string } };
      animId = m.initial?.animation ?? m.animations?.[0]?.id ?? null;
    } catch {
      /* fall back to the first animation file */
    }
  }
  const names = [...entries.keys()];
  const animName =
    (animId && [`animations/${animId}.json`, `a/${animId}.json`].find((n) => entries.has(n))) ||
    names.find((n) => /^(animations|a)\/[^/]+\.json$/i.test(n)) ||
    null;
  if (!animName) throw new Error('the archive contains no animation');
  const doc = JSON.parse(td.decode(await inflate(buf, entries.get(animName)!))) as { assets?: { p?: string; u?: string; e?: number }[] };
  for (const asset of doc.assets ?? []) {
    if (!asset || typeof asset.p !== 'string' || asset.e === 1 || asset.p.startsWith('data:')) continue;
    const file = asset.p.split('/').pop()!;
    const entry = entries.get(`images/${file}`) ?? entries.get(`i/${file}`) ?? entries.get(`${(asset.u ?? '').replace(/^\/+/, '')}${asset.p}`);
    if (!entry) continue;
    const ext = file.split('.').pop()?.toLowerCase() ?? 'png';
    asset.p = `data:${IMAGE_MIME[ext] ?? 'image/png'};base64,${base64(await inflate(buf, entry))}`;
    asset.u = '';
    asset.e = 1;
  }
  return doc;
}
