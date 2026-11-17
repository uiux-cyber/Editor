/**
 * Fuzzy matching for the command palette (pure).
 *
 * A query matches a text when its characters appear in order. The score rewards what people
 * expect from editors' palettes: exact and prefix matches, matches at word starts ("sp" →
 * **S**plit at **p**layhead), consecutive runs, and short texts; it penalises gaps.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices of matched characters in the text (for highlighting). */
  indices: number[];
}

const isWordStart = (text: string, i: number): boolean => {
  if (i === 0) return true;
  const prev = text[i - 1];
  const ch = text[i];
  if (/[\s\-_./:·(),&]/.test(prev)) return true;
  // camelCase / PascalCase boundary
  return prev === prev.toLowerCase() && ch !== ch.toLowerCase() && /[a-z]/i.test(prev);
};

/**
 * Lower-case and strip accents so "regle" finds "Réglages". Folds one UTF-16 unit at a time so
 * the result has exactly the same length as the input (indices stay valid for highlighting).
 */
export function foldText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const base = ch.charCodeAt(0) < 128 ? ch : ch.normalize('NFD')[0] ?? ch;
    const lower = base.toLowerCase();
    out += lower.length === 1 ? lower : base;
  }
  return out;
}

/**
 * Best match of `query` in `text`, or null. Uses dynamic programming over positions so it finds
 * the highest scoring alignment, not just the first one.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = foldText(query).replace(/\s+/g, '');
  if (!q) return { score: 0, indices: [] };
  const t = foldText(text);
  if (q.length > t.length) return null;

  // Quick reject: every character must appear in order.
  let probe = 0;
  for (let i = 0; i < t.length && probe < q.length; i++) if (t[i] === q[probe]) probe++;
  if (probe < q.length) return null;

  const n = q.length;
  const m = t.length;
  // best[i][j]: best score with q[0..i] matched and q[i] at text position j. -Infinity = impossible.
  const NEG = -1e9;
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    best.push(new Float64Array(m).fill(NEG));
    from.push(new Int32Array(m).fill(-1));
  }
  const charScore = (j: number): number => {
    let s = 1;
    if (isWordStart(text, j)) s += 8;
    if (j === 0) s += 6;
    return s;
  };
  for (let j = 0; j < m; j++) {
    if (t[j] !== q[0]) continue;
    best[0][j] = charScore(j) - Math.min(j, 12) * 0.2;
  }
  for (let i = 1; i < n; i++) {
    let runBest = NEG;
    let runFrom = -1;
    for (let j = 1; j < m; j++) {
      // runBest holds the best best[i-1][k] - gapPenalty for k < j - 1.
      const k = j - 2;
      if (k >= 0 && best[i - 1][k] > NEG) {
        const v = best[i - 1][k];
        // gap penalty grows with distance; approximated by decaying the running best.
        if (v > runBest) {
          runBest = v;
          runFrom = k;
        }
      }
      if (runBest > NEG) runBest -= 0.35;
      if (t[j] !== q[i]) continue;
      let score = NEG;
      let src = -1;
      // Consecutive with the previous matched char.
      if (best[i - 1][j - 1] > NEG) {
        score = best[i - 1][j - 1] + charScore(j) + 5;
        src = j - 1;
      }
      if (runBest > NEG) {
        const gapped = runBest + charScore(j) - 1.5;
        if (gapped > score) {
          score = gapped;
          src = runFrom;
        }
      }
      best[i][j] = score;
      from[i][j] = src;
    }
  }
  let endJ = -1;
  let top = NEG;
  for (let j = 0; j < m; j++) {
    if (best[n - 1][j] > top) {
      top = best[n - 1][j];
      endJ = j;
    }
  }
  if (endJ < 0) return null;
  const indices: number[] = new Array(n);
  for (let i = n - 1, j = endJ; i >= 0; i--) {
    indices[i] = j;
    j = from[i][j];
  }
  let score = top;
  if (t === q) score += 40;
  else if (t.startsWith(q)) score += 20;
  // Prefer shorter texts slightly (more of the text is matched).
  score += (n / m) * 6;
  return { score, indices };
}

export interface SearchField {
  text: string;
  /** Relative importance (title 1, keywords ~0.75, group ~0.6). */
  weight: number;
}

export interface FieldsMatch {
  score: number;
  /** Highlight indices per field index. */
  highlights: Map<number, number[]>;
}

/**
 * Match a (possibly multi-word) query against several fields of one item. Every word must match
 * some field; a whole-query match on one field is preferred over a word split.
 */
export function matchFields(query: string, fields: readonly SearchField[]): FieldsMatch | null {
  const trimmed = query.trim();
  if (!trimmed) return { score: 0, highlights: new Map() };
  // Whole query against each field.
  let whole: FieldsMatch | null = null;
  fields.forEach((f, idx) => {
    const m = fuzzyMatch(trimmed, f.text);
    if (m && (!whole || m.score * f.weight > whole.score)) whole = { score: m.score * f.weight, highlights: new Map([[idx, m.indices]]) };
  });
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return whole;
  // Word by word: each word scores against its best field.
  let total = 0;
  const highlights = new Map<number, number[]>();
  for (const w of words) {
    let bestScore = -Infinity;
    let bestIdx = -1;
    let bestIndices: number[] = [];
    fields.forEach((f, idx) => {
      const m = fuzzyMatch(w, f.text);
      if (m && m.score * f.weight > bestScore) {
        bestScore = m.score * f.weight;
        bestIdx = idx;
        bestIndices = m.indices;
      }
    });
    if (bestIdx < 0) return whole;
    total += bestScore;
    highlights.set(bestIdx, [...(highlights.get(bestIdx) ?? []), ...bestIndices]);
  }
  const split: FieldsMatch = { score: total * 0.9, highlights };
  return whole && (whole as FieldsMatch).score >= split.score ? whole : split;
}

export interface Rankable {
  key: string;
  fields: SearchField[];
  /** Added to the score (e.g. commands over library items). */
  boost?: number;
}

export interface Ranked<T extends Rankable> {
  item: T;
  score: number;
  highlights: Map<number, number[]>;
}

/**
 * Rank items for a query. `recent` lists keys most recent first; they get a bonus that decays
 * with age, so a just-used command wins ties but never beats a clearly better match.
 */
export function rankItems<T extends Rankable>(query: string, items: readonly T[], recent: readonly string[] = [], limit = Infinity): Ranked<T>[] {
  const recency = new Map(recent.map((k, i) => [k, i]));
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const m = matchFields(query, item.fields);
    if (!m) continue;
    const r = recency.get(item.key);
    const recentBonus = r === undefined ? 0 : 14 * Math.pow(0.82, r);
    out.push({ item, score: m.score + (item.boost ?? 0) + recentBonus, highlights: m.highlights });
  }
  out.sort((a, b) => b.score - a.score || a.item.fields[0].text.localeCompare(b.item.fields[0].text));
  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

/** Split text into highlighted / plain runs for rendering. */
export function highlightRuns(text: string, indices: readonly number[] | undefined): { text: string; hit: boolean }[] {
  if (!indices || indices.length === 0) return [{ text, hit: false }];
  const set = new Set(indices);
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i], hit });
  }
  return runs;
}
