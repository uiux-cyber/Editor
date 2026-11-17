/**
 * Message formatting for translations (pure; see docs/I18N.md). Supports the commonly used
 * subset of ICU MessageFormat:
 *
 *   {name}                                   plain value (numbers are locale formatted)
 *   {count, number}  {ratio, number, percent} {size, number, integer}
 *   {when, date}  {when, date, short|medium|long|full}  {when, time}
 *   {count, plural, =0 {No clips} one {# clip} other {# clips}}   (# = the formatted number)
 *   {count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}
 *   {kind, select, video {Video} audio {Audio} other {Media}}
 *
 * Literal braces are written as '{' and '}' (apostrophe quoting), and '' is a single apostrophe.
 */

export type MessageValue = string | number | boolean | Date | null | undefined;
export type MessageVars = Record<string, MessageValue>;

type Node =
  | { t: 'text'; v: string }
  | { t: 'pound' }
  | { t: 'arg'; name: string; format?: string; style?: string }
  | { t: 'plural' | 'select' | 'selectordinal'; name: string; offset: number; options: Map<string, Node[]> };

class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(inPlural: boolean, nested: boolean): Node[] {
    const nodes: Node[] = [];
    let text = '';
    const flush = (): void => {
      if (text) nodes.push({ t: 'text', v: text });
      text = '';
    };
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === "'") {
        // '' → ', '{…}' → literal braces
        const next = this.s[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
          continue;
        }
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          const end = this.s.indexOf("'", this.i + 1);
          if (end > 0) {
            text += this.s.slice(this.i + 1, end);
            this.i = end + 1;
            continue;
          }
        }
        text += ch;
        this.i++;
        continue;
      }
      if (ch === '{') {
        flush();
        nodes.push(this.argument());
        continue;
      }
      if (ch === '}') {
        if (nested) break;
        text += ch;
        this.i++;
        continue;
      }
      if (ch === '#' && inPlural) {
        flush();
        nodes.push({ t: 'pound' });
        this.i++;
        continue;
      }
      text += ch;
      this.i++;
    }
    flush();
    return nodes;
  }

  private skipWs(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private word(): string {
    this.skipWs();
    const start = this.i;
    while (this.i < this.s.length && !/[\s,{}]/.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }

  private expect(ch: string): void {
    this.skipWs();
    if (this.s[this.i] !== ch) throw new Error(`Expected "${ch}" at ${this.i} in "${this.s}"`);
    this.i++;
  }

  private argument(): Node {
    this.expect('{');
    const name = this.word();
    this.skipWs();
    if (this.s[this.i] === '}') {
      this.i++;
      return { t: 'arg', name };
    }
    this.expect(',');
    const type = this.word();
    this.skipWs();
    if (type === 'plural' || type === 'select' || type === 'selectordinal') {
      this.expect(',');
      let offset = 0;
      const options = new Map<string, Node[]>();
      for (;;) {
        this.skipWs();
        if (this.s[this.i] === '}') {
          this.i++;
          break;
        }
        const key = this.word();
        if (!key) throw new Error(`Bad option in "${this.s}"`);
        if (key.startsWith('offset:')) {
          offset = Number(key.slice(7)) || 0;
          continue;
        }
        this.expect('{');
        options.set(key, this.parse(type !== 'select', true));
        this.expect('}');
      }
      return { t: type, name, offset, options };
    }
    let style: string | undefined;
    if (this.s[this.i] === ',') {
      this.i++;
      this.skipWs();
      const start = this.i;
      while (this.i < this.s.length && this.s[this.i] !== '}') this.i++;
      style = this.s.slice(start, this.i).trim();
    }
    this.expect('}');
    return { t: 'arg', name, format: type, style };
  }
}

const astCache = new Map<string, Node[]>();

function parseMessage(message: string): Node[] {
  let ast = astCache.get(message);
  if (!ast) {
    try {
      ast = new Parser(message).parse(false, false);
    } catch (err) {
      console.warn('[i18n] could not parse message', message, err);
      ast = [{ t: 'text', v: message }];
    }
    if (astCache.size > 4000) astCache.clear();
    astCache.set(message, ast);
  }
  return ast;
}

// Intl objects are expensive to create: cache them per locale + options.
const intlCache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let v = intlCache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    intlCache.set(key, v);
  }
  return v;
}

export function numberFormat(locale: string, opts: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  return cached(`n|${locale}|${JSON.stringify(opts)}`, () => new Intl.NumberFormat(locale, opts));
}
export function dateFormat(locale: string, opts: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  return cached(`d|${locale}|${JSON.stringify(opts)}`, () => new Intl.DateTimeFormat(locale, opts));
}
export function pluralRules(locale: string, type: Intl.PluralRuleType = 'cardinal'): Intl.PluralRules {
  return cached(`p|${locale}|${type}`, () => new Intl.PluralRules(locale, { type }));
}

function numberOptions(style?: string): Intl.NumberFormatOptions {
  switch (style) {
    case 'percent':
      return { style: 'percent', maximumFractionDigits: 1 };
    case 'integer':
      return { maximumFractionDigits: 0 };
    case undefined:
    case '':
      return { maximumFractionDigits: 2 };
    default: {
      const digits = /^::\.(#+)$/.exec(style);
      return digits ? { maximumFractionDigits: digits[1].length } : {};
    }
  }
}

const DATE_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
  full: { dateStyle: 'full' },
};
const TIME_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  short: { timeStyle: 'short' },
  medium: { timeStyle: 'medium' },
  long: { timeStyle: 'long' },
  full: { timeStyle: 'full' },
};

function toDate(v: MessageValue): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function plain(v: MessageValue, locale: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return numberFormat(locale, numberOptions()).format(v);
  if (v instanceof Date) return dateFormat(locale, DATE_STYLES.medium).format(v);
  return String(v);
}

function render(nodes: Node[], vars: MessageVars, locale: string, pound: string | null): string {
  let out = '';
  for (const node of nodes) {
    switch (node.t) {
      case 'text':
        out += node.v;
        break;
      case 'pound':
        out += pound ?? '#';
        break;
      case 'arg': {
        const v = vars[node.name];
        if (v === undefined) {
          out += `{${node.name}}`;
          break;
        }
        if (node.format === 'number') out += numberFormat(locale, numberOptions(node.style)).format(Number(v));
        else if (node.format === 'date') out += toDate(v) ? dateFormat(locale, DATE_STYLES[node.style ?? 'medium'] ?? DATE_STYLES.medium).format(toDate(v)!) : String(v);
        else if (node.format === 'time') out += toDate(v) ? dateFormat(locale, TIME_STYLES[node.style ?? 'short'] ?? TIME_STYLES.short).format(toDate(v)!) : String(v);
        else out += plain(v, locale);
        break;
      }
      case 'select': {
        const key = String(vars[node.name] ?? 'other');
        const branch = node.options.get(key) ?? node.options.get('other') ?? [];
        out += render(branch, vars, locale, pound);
        break;
      }
      case 'plural':
      case 'selectordinal': {
        const raw = Number(vars[node.name]);
        const n = Number.isFinite(raw) ? raw : 0;
        const exact = node.options.get(`=${n}`);
        const value = n - node.offset;
        const category = pluralRules(locale, node.t === 'plural' ? 'cardinal' : 'ordinal').select(value);
        const branch = exact ?? node.options.get(category) ?? node.options.get('other') ?? [];
        out += render(branch, vars, locale, numberFormat(locale, numberOptions()).format(value));
        break;
      }
    }
  }
  return out;
}

/** Format an ICU-style message for a locale (BCP 47 tag, e.g. 'pt-BR'). */
export function formatMessage(message: string, vars: MessageVars | undefined, locale: string): string {
  if (!vars && !message.includes('{') && !message.includes("'")) return message;
  return render(parseMessage(message), vars ?? {}, locale, null);
}

/** Names of the arguments a message uses (for checking translations keep every placeholder). */
export function messageArguments(message: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]): void => {
    for (const n of nodes) {
      if (n.t === 'arg') names.add(n.name);
      else if (n.t === 'plural' || n.t === 'select' || n.t === 'selectordinal') {
        names.add(n.name);
        n.options.forEach(walk);
      }
    }
  };
  walk(parseMessage(message));
  return [...names].sort();
}

/** "3 min ago", "in 2 days", "yesterday" — Intl.RelativeTimeFormat with sensible units. */
export function formatRelativeTime(timestamp: number, locale: string, now = Date.now()): string {
  const rtf = cached(`r|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
  const diff = (timestamp - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return dateFormat(locale, DATE_STYLES.medium).format(new Date(timestamp));
}

/** "1.5 GB" with locale digits. */
export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, bytes);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${numberFormat(locale, { maximumFractionDigits: u === 0 ? 0 : v < 10 ? 1 : 0 }).format(v)} ${units[u]}`;
}
