/**
 * Building blocks for settings pages, so every section (built-in or from a feature area) looks
 * and behaves the same: groups, label/description rows, radio cards and switches — all keyboard
 * operable with proper ARIA roles.
 */

import { Check } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useA11yId } from '../common/a11y';

export function SettingsGroup({ title, description, children }: { title?: ReactNode; description?: ReactNode; children: ReactNode }): ReactNode {
  const id = useA11yId('set-group');
  return (
    <section className="set-group" aria-labelledby={title ? id : undefined}>
      {title && (
        <h3 className="set-group__title" id={id}>
          {title}
        </h3>
      )}
      {description && <p className="set-group__desc">{description}</p>}
      <div className="set-group__body">{children}</div>
    </section>
  );
}

/** One setting: label + help text on the left, the control on the right. */
export function SettingRow({ label, description, children, htmlFor, stacked }: { label: ReactNode; description?: ReactNode; children: ReactNode; htmlFor?: string; stacked?: boolean }): ReactNode {
  return (
    <div className={`set-row ${stacked ? 'set-row--stacked' : ''}`}>
      <div className="set-row__text">
        {htmlFor ? (
          <label className="set-row__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="set-row__label">{label}</div>
        )}
        {description && <div className="set-row__desc">{description}</div>}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  /** Visual shown above the label (e.g. a theme preview). */
  preview?: ReactNode;
  /** Text for assistive technology when the label is not plain text. */
  ariaLabel?: string;
  lang?: string;
}

/** Radio cards (role="radiogroup", arrow keys move and select). */
export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
  label,
  columns = 3,
  compact,
}: {
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  label: string;
  columns?: number;
  compact?: boolean;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    const next = options[(i + delta + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus());
  };
  return (
    <div ref={ref} className={`choice-cards ${compact ? 'choice-cards--compact' : ''}`} role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} onKeyDown={onKey}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            tabIndex={on ? 0 : -1}
            data-value={o.value}
            lang={o.lang}
            className={`choice-card ${on ? 'is-active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.preview && <span className="choice-card__preview">{o.preview}</span>}
            <span className="choice-card__body">
              <span className="choice-card__label">{o.label}</span>
              {o.description && <span className="choice-card__desc">{o.description}</span>}
            </span>
            <span className="choice-card__check" aria-hidden="true">
              {on && <Check size={12} strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Accessible on / off switch. */
export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }): ReactNode {
  return (
    <button type="button" id={id} role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)} />
  );
}
