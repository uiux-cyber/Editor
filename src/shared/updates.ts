/**
 * Automatic updates: the state the main process reports to the renderer, plus pure helpers.
 * Keep this file free of runtime imports so every side (and the unit tests) can include it.
 *
 * Updates come from the GitHub releases of the public repository. A release is published by
 * pushing a version tag (see .github/workflows/release.yml and docs/RELEASING.md).
 */

export const RELEASES_URL = 'https://github.com/uiux-cyber/Editor/releases';

/** First automatic check after start-up, then the interval between checks. */
export const FIRST_CHECK_DELAY_MS = 20_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Settings key: check for and download updates automatically (default true). */
export const AUTO_UPDATE_SETTING = 'updates.auto';

export type UpdateStatus =
  /** Updates are not available in this build (development or automated tests). */
  | { state: 'unsupported' }
  /** Nothing checked yet in this session. */
  | { state: 'idle' }
  | { state: 'checking'; manual: boolean }
  /** This is the latest version. */
  | { state: 'none'; manual: boolean; checkedAt: number }
  | { state: 'downloading'; manual: boolean; version: string; percent: number }
  /** Downloaded and verified; installs on restart (or when Kinora is closed). */
  | { state: 'ready'; version: string; notes: string; url: string }
  | { state: 'error'; manual: boolean; code: UpdateErrorCode; detail: string };

export function releasePageUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version.replace(/^v/, '')}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Release notes arrive as HTML rendered by GitHub (or as a list of notes per version). Turn
 * them into plain text for display: the renderer never inserts remote HTML.
 */
export function releaseNotesToText(notes: unknown, maxLength = 4000): string {
  let html = '';
  if (typeof notes === 'string') html = notes;
  else if (Array.isArray(notes)) {
    html = notes
      .map((n) => (n && typeof n === 'object' ? `<h2>${String((n as { version?: unknown }).version ?? '')}</h2>${String((n as { note?: unknown }).note ?? '')}` : ''))
      .join('\n');
  }
  const text = decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      // Line breaks in HTML source are just spaces; the tags decide where lines break.
      .replace(/\s+/g, ' ')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|ul|ol|pre|blockquote|table)>/gi, '\n\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

export type UpdateErrorCode = 'offline' | 'unpublished' | 'integrity' | 'busy' | 'other';

/**
 * Sort a failed check into a reason the interface can explain (and translate), plus the first
 * line of the technical message for the curious (no stack traces or long HTTP dumps).
 */
export function classifyUpdateError(err: unknown): { code: UpdateErrorCode; detail: string } {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const first = raw.split('\n')[0].trim();
  const detail = first.length > 160 ? `${first.slice(0, 160)}…` : first;
  let code: UpdateErrorCode = 'other';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|net::/i.test(raw)) code = 'offline';
  else if (/latest\.yml|Cannot find .* in the latest release|No published versions|HttpError: 404/i.test(raw)) code = 'unpublished';
  else if (/sha512|checksum|signature/i.test(raw)) code = 'integrity';
  else if (/\b(403|429)\b|rate limit/i.test(raw)) code = 'busy';
  return { code, detail };
}
