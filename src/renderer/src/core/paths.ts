/**
 * Pure file-path helpers for project files. The renderer has no `node:path`, and project files
 * must behave the same on every machine, so these work on plain strings and understand both
 * Windows (`C:\Media\a.mp4`, `\\server\share\a.mp4`) and POSIX (`/home/me/a.mp4`) paths.
 *
 * Project files store media paths *relative to the project file* when the media lives inside the
 * project's folder (e.g. `Media/clip.mp4`, always with forward slashes) so a project folder can be
 * moved or copied to another PC as a whole. Everything else stays absolute.
 */

/** True for `C:\…`, `C:/…`, `\\server\share\…` and `/…`. */
export function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p) || p.startsWith('/');
}

const isWindowsStyle = (p: string): boolean => /^[a-zA-Z]:/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'));

/** Split a path into its root (`C:\`, `\\server\share\`, `/` or '') and its segments. */
function splitPath(p: string): { root: string; parts: string[] } {
  let root = '';
  let rest = p;
  const drive = /^([a-zA-Z]:)[\\/]?/.exec(p);
  const unc = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)[\\/]?/.exec(p);
  if (drive) {
    root = `${drive[1]}\\`;
    rest = p.slice(drive[0].length);
  } else if (unc) {
    root = `\\\\${unc[1]}\\${unc[2]}\\`;
    rest = p.slice(unc[0].length);
  } else if (p.startsWith('/')) {
    root = '/';
    rest = p.slice(1);
  }
  const parts: string[] = [];
  for (const seg of rest.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!root) parts.push('..');
      continue;
    }
    parts.push(seg);
  }
  return { root, parts };
}

/** Normalised absolute path with the platform's separator (backslashes for Windows paths). */
export function normalizePath(p: string): string {
  const { root, parts } = splitPath(p);
  const sep = root === '/' || (!root && !isWindowsStyle(p)) ? '/' : '\\';
  return root + parts.join(sep);
}

/** Folder that contains a file (`C:\a\b.kinora` → `C:\a`). */
export function dirnamePath(p: string): string {
  const { root, parts } = splitPath(p);
  const sep = root === '/' ? '/' : '\\';
  const dir = root + parts.slice(0, -1).join(sep);
  return dir || root;
}

export function basenamePath(p: string): string {
  const { parts } = splitPath(p);
  return parts[parts.length - 1] ?? '';
}

/** Windows paths compare case-insensitively; POSIX paths are case-sensitive. */
const sameSegment = (a: string, b: string, windows: boolean): boolean => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * `target` relative to the folder `base` with forward slashes (`Media/clip.mp4`), or null when
 * `target` is not inside `base` (different drive, or outside the folder).
 */
export function relativeInside(base: string, target: string): string | null {
  if (!isAbsolutePath(base) || !isAbsolutePath(target)) return null;
  const a = splitPath(base);
  const b = splitPath(target);
  const windows = a.root !== '/';
  if (!sameSegment(a.root, b.root, windows)) return null;
  if (b.parts.length <= a.parts.length) return null;
  for (let i = 0; i < a.parts.length; i++) if (!sameSegment(a.parts[i], b.parts[i], windows)) return null;
  return b.parts.slice(a.parts.length).join('/');
}

/** Resolve a stored path against the project folder. Absolute paths are returned unchanged. */
export function resolveFrom(baseDir: string, p: string): string {
  if (!p || isAbsolutePath(p)) return p;
  const { root, parts } = splitPath(baseDir);
  const sep = root === '/' ? '/' : '\\';
  return normalizePath(root + [...parts, ...p.split(/[\\/]+/)].join(sep));
}

/** Make `name` unique among `taken` (case-insensitive): `clip.mp4` → `clip (2).mp4`. */
export function uniqueFileName(name: string, taken: ReadonlySet<string>): string {
  const has = (n: string): boolean => taken.has(n.toLowerCase());
  if (!has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!has(candidate)) return candidate;
  }
}
