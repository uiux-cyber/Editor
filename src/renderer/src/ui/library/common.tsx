import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): ReactNode {
  const t = useT();
  return (
    <div className="search">
      <Search size={13} />
      <input value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      {value && (
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => onChange('')} title={t('Clear')}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      className="lib__chips"
      ref={ref}
      onWheel={(e) => {
        // Vertical wheel scrolls the chip row sideways.
        if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY;
      }}
    >
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip ${o.value === value ? 'is-active' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Title-case a kebab-case id such as "lower-third". */
export const labelOf = (id: string): string =>
  id
    .split('-')
    .map((w) => (w.length <= 2 && w !== 'ui' ? w.toUpperCase() : w === 'ui' ? 'UI' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

/**
 * Render long lists incrementally: returns how many items to show and a sentinel to place after
 * them. More items are revealed as the sentinel scrolls into view.
 */
export function useIncremental(total: number, pageSize: number, resetKey: string): { count: number; sentinel: ReactNode } {
  const [count, setCount] = useState(pageSize);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setCount(pageSize), [resetKey, pageSize]);
  useEffect(() => {
    const el = ref.current;
    if (!el || count >= total) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(total, c + pageSize));
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count, total, pageSize]);
  return { count: Math.min(count, total), sentinel: count < total ? <div ref={ref} style={{ height: 1 }} /> : null };
}

export function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}
