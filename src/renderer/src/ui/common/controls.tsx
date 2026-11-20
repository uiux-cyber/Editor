import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useProjectStore } from '@/store/project';
import { useT } from '../i18n';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const round = (v: number, precision: number): number => {
  const k = Math.pow(10, precision);
  return Math.round(v * k) / k;
};

/** Start / end a store gesture so a whole drag is one undo step. */
export function useGesture(): { begin: () => void; end: () => void } {
  const begin = useCallback(() => useProjectStore.getState().begin(), []);
  const end = useCallback(() => useProjectStore.getState().commit(), []);
  return { begin, end };
}

// ---------------------------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------------------------

export function Field({ label, children, title, labelWidth }: { label?: ReactNode; children: ReactNode; title?: string; labelWidth?: number }): ReactNode {
  return (
    <div className="field" title={title}>
      {label !== undefined && (
        <div className="field__label truncate" style={labelWidth ? { width: labelWidth } : undefined}>
          {label}
        </div>
      )}
      <div className="field__control">{children}</div>
    </div>
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
  actions,
  id,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  id?: string;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'is-open' : ''}`} data-section={id}>
      <header className="section__head" onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={13} className="section__chev" />
        <span className="section__title">{title}</span>
        <span className="section__actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      </header>
      {open && <div className="section__body">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

export interface NumberProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Increment for arrow keys and drag-scrubbing. */
  step?: number;
  precision?: number;
  prefix?: ReactNode;
  suffix?: string;
  /** Multiply for display (e.g. 100 to show a 0..1 value as a percentage). */
  scale?: number;
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
  /** Mixed selection: show a dash until edited. */
  mixed?: boolean;
}

/**
 * Compact numeric input: type a value, use the arrow keys, or drag the prefix label left / right.
 * A drag is wrapped in a store gesture so it is a single undo step.
 */
export function NumberInput({ value, onChange, min = -Infinity, max = Infinity, step = 1, precision = 0, prefix, suffix, scale = 1, disabled, style, title, mixed }: NumberProps): ReactNode {
  const shown = round(value * scale, precision);
  const [draft, setDraft] = useState<string | null>(null);
  const gesture = useGesture();
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  const commit = (text: string): void => {
    setDraft(null);
    const parsed = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    const next = clamp(parsed / scale, min, max);
    if (next !== value) onChange(next);
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (disabled || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 3) return;
      d.moved = true;
      gesture.begin();
    }
    const fine = e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
    const next = clamp(d.start + (dx * step * fine) / scale / 2, min, max);
    onChange(round(next * scale, Math.max(precision, 3)) / scale);
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d?.moved) gesture.end();
  };

  return (
    <div className="num" style={style} title={title}>
      {prefix !== undefined && (
        <span className="num__prefix" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {prefix}
        </span>
      )}
      <input
        value={draft ?? (mixed ? '—' : String(shown))}
        disabled={disabled}
        spellCheck={false}
        onFocus={(e) => {
          setDraft(mixed ? '' : String(shown));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            setDraft(null);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const mult = e.shiftKey ? 10 : 1;
            const next = clamp(value + (dir * step * mult) / scale, min, max);
            setDraft(String(round(next * scale, precision)));
            onChange(next);
          }
          e.stopPropagation();
        }}
      />
      {suffix && <span className="num__suffix">{suffix}</span>}
    </div>
  );
}

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Value restored on double-click. */
  defaultValue?: number;
  /** Fill from the centre outwards (for ± ranges). */
  bipolar?: boolean;
  disabled?: boolean;
}

/** Range slider. Each drag is a single undo step; double-click resets. */
export function Slider({ value, onChange, min, max, step = 0.01, defaultValue, bipolar, disabled }: SliderProps): ReactNode {
  const gesture = useGesture();
  const pct = max > min ? ((clamp(value, min, max) - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={`slider ${bipolar ? 'slider--bipolar' : ''}`}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      min={min}
      max={max}
      step={step}
      value={clamp(value, min, max)}
      disabled={disabled}
      onPointerDown={() => gesture.begin()}
      onPointerUp={() => gesture.end()}
      onPointerCancel={() => gesture.end()}
      onBlur={() => gesture.end()}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

/** Label + slider + numeric readout on one row. */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  defaultValue,
  bipolar,
  precision = 0,
  scale = 1,
  suffix,
  lead,
  disabled,
}: SliderProps & { label: ReactNode; precision?: number; scale?: number; suffix?: string; lead?: ReactNode }): ReactNode {
  return (
    <Field label={label}>
      {lead}
      <Slider value={value} onChange={onChange} min={min} max={max} step={step} defaultValue={defaultValue} bipolar={bipolar} disabled={disabled} />
      <NumberInput value={value} onChange={onChange} min={min} max={max} step={(step ?? 0.01) * scale} precision={precision} scale={scale} suffix={suffix} disabled={disabled} style={{ flex: 'none', width: 58 }} />
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------------------------

export function Toggle({ value, onChange, disabled, title }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }): ReactNode {
  return <button type="button" role="switch" aria-checked={value} title={title} disabled={disabled} className={`toggle ${value ? 'is-on' : ''}`} onClick={() => onChange(!value)} />;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  style,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  style?: CSSProperties;
}): ReactNode {
  return (
    <div className="segmented" style={style}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" title={o.title} className={o.value === value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  style,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  style?: CSSProperties;
  disabled?: boolean;
}): ReactNode {
  const numeric = typeof value === 'number';
  return (
    <select className="select" style={style} disabled={disabled} value={String(value)} onChange={(e) => onChange((numeric ? Number(e.target.value) : e.target.value) as T)} onKeyDown={(e) => e.stopPropagation()}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

const normHex = (v: string): string | null => {
  let h = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h))
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h) ? `#${h.toLowerCase()}` : null;
};

export const SWATCHES = ['#ffffff', '#000000', '#f8717a', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#3f6df2', '#7c5cff', '#f472b6'];

/**
 * Colour field: swatch opening the system picker (with eyedropper), a hex box, and an optional
 * opacity value stored as the alpha byte of `#rrggbbaa`.
 */
export function ColorInput({ value, onChange: onChangeRaw, alpha = false, swatches = false }: { value: string; onChange: (v: string) => void; alpha?: boolean; swatches?: boolean }): ReactNode {
  const t = useT();
  // The system picker streams changes while dragging; group a burst into one undo step.
  const burst = useRef<number | null>(null);
  const onChange = (v: string): void => {
    if (burst.current === null) useProjectStore.getState().begin();
    else window.clearTimeout(burst.current);
    burst.current = window.setTimeout(() => {
      burst.current = null;
      useProjectStore.getState().commit();
    }, 450);
    onChangeRaw(v);
  };
  const full = normHex(value) ?? '#ffffff';
  const rgb = full.slice(0, 7);
  const a = full.length === 9 ? parseInt(full.slice(7, 9), 16) / 255 : 1;
  const [draft, setDraft] = useState<string | null>(null);
  const withAlpha = (hex: string, alphaValue: number): string => {
    const aa = Math.round(clamp(alphaValue, 0, 1) * 255);
    return aa >= 255 ? hex : `${hex}${aa.toString(16).padStart(2, '0')}`;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label className="swatch" title={t('Pick a colour')}>
          <span style={{ background: full }} />
          <input
            type="color"
            value={rgb}
            onChange={(e) => onChange(withAlpha(e.target.value, a))}
          />
        </label>
        <input
          className="input mono"
          style={{ flex: 1, minWidth: 0, textTransform: 'uppercase' }}
          value={draft ?? rgb.replace('#', '')}
          spellCheck={false}
          maxLength={9}
          onFocus={(e) => {
            setDraft(rgb.replace('#', ''));
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const parsed = draft !== null ? normHex(draft) : null;
            setDraft(null);
            if (parsed) onChange(parsed.length === 9 ? parsed : withAlpha(parsed, a));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
        />
        {alpha && <NumberInput value={a} onChange={(v) => onChange(withAlpha(rgb, v))} min={0} max={1} step={1} scale={100} suffix="%" style={{ flex: 'none', width: 58 }} title={t('Opacity')} />}
      </div>
      {swatches && (
        <div className="swatch-row">
          {SWATCHES.map((c) => (
            <button key={c} type="button" className="swatch-dot" style={{ background: c }} title={c} onClick={() => onChange(withAlpha(c, a))} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------------------------

/** Keeps a callback fresh without re-subscribing listeners. */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Observe an element's content-box size. */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Horizontal or vertical drag handle between panels. */
export function Resizer({ axis, onDrag, onEnd }: { axis: 'x' | 'y'; onDrag: (delta: number) => void; onEnd?: () => void }): ReactNode {
  const start = useRef<number | null>(null);
  return (
    <div
      className={`resizer resizer--${axis}`}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = axis === 'x' ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const pos = axis === 'x' ? e.clientX : e.clientY;
        onDrag(pos - start.current);
        start.current = pos;
      }}
      onPointerUp={() => {
        start.current = null;
        onEnd?.();
      }}
    />
  );
}
