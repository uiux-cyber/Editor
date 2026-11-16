import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BUNDLED_FONTS, cssFamily } from '@/library/fonts';

let systemFonts: string[] | null = null;

/** Families installed on this PC (Local Font Access API), minus the ones Kinora bundles. */
async function loadSystemFonts(): Promise<string[]> {
  if (systemFonts) return systemFonts;
  try {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (!query) return (systemFonts = []);
    const fonts = await query();
    const bundled = new Set(BUNDLED_FONTS.map((f) => f.family.toLowerCase()));
    systemFonts = [...new Set(fonts.map((f) => f.family))].filter((f) => !bundled.has(f.toLowerCase())).sort((a, b) => a.localeCompare(b));
  } catch {
    systemFonts = [];
  }
  return systemFonts;
}

export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [system, setSystem] = useState<string[]>(systemFonts ?? []);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (open && !systemFonts) void loadSystemFonts().then(setSystem);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const width = Math.max(r.width, 260);
    const below = window.innerHeight - r.bottom - 12;
    const maxHeight = Math.max(220, Math.min(440, below));
    const top = below < 220 ? Math.max(8, r.top - maxHeight - 4) : r.bottom + 4;
    setPos({ left: Math.min(r.left, window.innerWidth - width - 8), top, width, maxHeight });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const term = search.trim().toLowerCase();
  const bundled = useMemo(() => BUNDLED_FONTS.filter((f) => !term || f.family.toLowerCase().includes(term)), [term]);
  const installed = useMemo(() => system.filter((f) => !term || f.toLowerCase().includes(term)).slice(0, 300), [system, term]);
  const pick = (family: string): void => {
    onChange(family);
    setOpen(false);
  };

  return (
    <>
      <button ref={anchor} type="button" className="font-picker" onClick={() => setOpen((o) => !o)}>
        <span className="truncate" style={{ fontFamily: cssFamily(value) }}>
          {value}
        </span>
        <ChevronDown size={13} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={panel} className="font-panel" style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}>
            <input autoFocus className="input" placeholder="Search fonts" value={search} spellCheck={false} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            <div className="font-panel__list">
              {bundled.length > 0 && <div className="menu__label">Kinora fonts</div>}
              {bundled.map((f) => (
                <button key={f.family} type="button" className={`font-item ${f.family === value ? 'is-active' : ''}`} onClick={() => pick(f.family)}>
                  <span className="truncate" style={{ fontFamily: cssFamily(f.family), fontSize: 15 }}>
                    {f.family}
                  </span>
                  {f.family === value ? <Check size={13} /> : <small>{f.category}</small>}
                </button>
              ))}
              {installed.length > 0 && <div className="menu__label">Installed on this PC</div>}
              {installed.map((f) => (
                <button key={f} type="button" className={`font-item ${f === value ? 'is-active' : ''}`} onClick={() => pick(f)}>
                  <span className="truncate" style={{ fontFamily: `"${f}", sans-serif`, fontSize: 14 }}>
                    {f}
                  </span>
                  {f === value && <Check size={13} />}
                </button>
              ))}
              {bundled.length === 0 && installed.length === 0 && <p className="hint" style={{ padding: 10 }}>No fonts match “{search}”.</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
