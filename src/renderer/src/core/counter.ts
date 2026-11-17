/**
 * Count-up numbers (`TextClip.counter`): the value shown at a clip-local time and how it is
 * formatted. Pure functions shared by the text rasteriser (preview and export), the inspector
 * and the tests.
 */

import { Ease, clamp, clamp01 } from './easing';
import type { CounterSettings, TextClip } from './types';

export const DEFAULT_COUNTER: CounterSettings = {
  from: 0,
  to: 1000,
  decimals: 0,
  prefix: '',
  suffix: '',
  separator: true,
  ease: 'easeOutCubic',
};

export const MAX_COUNTER_DECIMALS = 6;

/** Seconds over which the count runs for a clip of `clipDuration` seconds. */
export function counterSpan(c: CounterSettings, clipDuration: number): number {
  const whole = Math.max(0, clipDuration);
  return c.duration !== undefined && c.duration > 0 ? Math.min(c.duration, whole) : whole;
}

/** Linear progress (0..1) of the count at clip-local time `t`. */
export function counterProgress(c: CounterSettings, clipDuration: number, t: number): number {
  const span = counterSpan(c, clipDuration);
  if (!(span > 0)) return 1;
  return clamp01(t / span);
}

/** The (eased) number shown at clip-local time `t`. */
export function counterValueAt(c: CounterSettings, clipDuration: number, t: number): number {
  const ease = Ease[c.ease] ?? Ease.linear;
  const from = Number.isFinite(c.from) ? c.from : 0;
  const to = Number.isFinite(c.to) ? c.to : 0;
  return from + (to - from) * ease(counterProgress(c, clipDuration, t));
}

const decimalsOf = (c: CounterSettings): number => clamp(Math.round(Number.isFinite(c.decimals) ? c.decimals : 0), 0, MAX_COUNTER_DECIMALS);

/** Format a value with the counter's decimals, thousands separators, prefix and suffix. */
export function formatCounter(c: CounterSettings, value: number): string {
  const decimals = decimalsOf(c);
  const v = Number.isFinite(value) ? value : 0;
  const fixed = Math.abs(v).toFixed(decimals);
  const dot = fixed.indexOf('.');
  let int = dot < 0 ? fixed : fixed.slice(0, dot);
  const frac = dot < 0 ? '' : fixed.slice(dot + 1);
  if (c.separator) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Never show "-0" (or "-0.00") for values that round to zero.
  const negative = v < 0 && /[1-9]/.test(fixed);
  return `${c.prefix ?? ''}${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}${c.suffix ?? ''}`;
}

/** Text of a counter clip at clip-local time `t`. */
export function counterTextAt(clip: Pick<TextClip, 'counter' | 'duration'>, t: number): string | null {
  const c = clip.counter;
  if (!c) return null;
  return formatCounter(c, counterValueAt(c, clip.duration, t));
}

/**
 * The longest string the counter can show: the value with the most digits (eases that overshoot,
 * e.g. back / elastic, are sampled) with a minus sign when any value is negative. Digits are drawn
 * in fixed-width cells, so this string's width is the stable width of the counter.
 */
export function counterTemplate(c: CounterSettings): string {
  const ease = Ease[c.ease] ?? Ease.linear;
  const from = Number.isFinite(c.from) ? c.from : 0;
  const to = Number.isFinite(c.to) ? c.to : 0;
  let maxAbs = Math.max(Math.abs(from), Math.abs(to));
  let negative = from < 0 || to < 0;
  for (let i = 1; i < 64; i++) {
    const v = from + (to - from) * ease(i / 64);
    maxAbs = Math.max(maxAbs, Math.abs(v));
    if (v < 0) negative = true;
  }
  const text = formatCounter({ ...c, prefix: '', suffix: '' }, maxAbs).replace(/\d/g, '0');
  return `${c.prefix ?? ''}${negative && maxAbs > 0 ? '-' : ''}${text}${c.suffix ?? ''}`;
}

/**
 * Counter settings that end on the number found in `text` ("87%", "$1,250.50", "12k fans"),
 * keeping the text around it as prefix / suffix. Used when the counter is switched on for a
 * text clip that already shows a number.
 */
export function counterFromText(text: string): CounterSettings {
  const m = /^([^\d-]*?)(-?\d[\d,]*(?:\.\d+)?)([\s\S]*)$/.exec(text.trim());
  if (!m) return { ...DEFAULT_COUNTER };
  const raw = m[2];
  const to = parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(to)) return { ...DEFAULT_COUNTER };
  const dot = raw.indexOf('.');
  return {
    ...DEFAULT_COUNTER,
    to,
    decimals: dot < 0 ? 0 : Math.min(MAX_COUNTER_DECIMALS, raw.length - dot - 1),
    separator: raw.includes(',') || Math.abs(to) >= 10000,
    prefix: m[1],
    suffix: m[3],
  };
}

/** Sanitise counter settings read from a file or typed by the user. */
export function sanitizeCounter(c: Partial<CounterSettings> | undefined): CounterSettings {
  const src = c ?? {};
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const out: CounterSettings = {
    from: num(src.from, DEFAULT_COUNTER.from),
    to: num(src.to, DEFAULT_COUNTER.to),
    decimals: clamp(Math.round(num(src.decimals, 0)), 0, MAX_COUNTER_DECIMALS),
    prefix: typeof src.prefix === 'string' ? src.prefix : '',
    suffix: typeof src.suffix === 'string' ? src.suffix : '',
    separator: src.separator !== false,
    ease: src.ease && src.ease in Ease ? src.ease : DEFAULT_COUNTER.ease,
  };
  if (typeof src.duration === 'number' && src.duration > 0) out.duration = src.duration;
  return out;
}
