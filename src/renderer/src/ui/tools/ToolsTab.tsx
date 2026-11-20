import { ChevronDown, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useUI } from '@/store/ui';
import { tMaybe, useLocale, useT } from '../i18n';
import { SearchBox } from '../library/common';
import { TOOLS, toolGroups } from './index';

// Commands (palette, shortcuts) can open a tool card: `openTool(id)` switches to the Smart tab
// and expands that card, even when the tab was not showing yet.
let pendingTool: string | null = null;
export function openTool(id: string): void {
  pendingTool = id;
  useUI.getState().setLibraryTab('tools');
  window.dispatchEvent(new CustomEvent('kinora:open-tool', { detail: id }));
}

/** Library tab listing the smart tools; each card expands into its own panel. */
export function ToolsTab(): ReactNode {
  const t = useT();
  const [open, setOpen] = useState<string | null>(() => {
    const id = pendingTool;
    pendingTool = null;
    return id;
  });
  useEffect(() => {
    const onOpen = (e: Event): void => {
      pendingTool = null;
      setOpen((e as CustomEvent<string>).detail);
    };
    window.addEventListener('kinora:open-tool', onOpen);
    return () => window.removeEventListener('kinora:open-tool', onOpen);
  }, []);
  useEffect(() => {
    if (open) document.querySelector(`[data-tool="${CSS.escape(open)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  const [search, setSearch] = useState('');
  const locale = useLocale();
  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    // Match the English text and keywords as well as the translated title and description.
    const matches = (s: string): boolean => s.toLowerCase().includes(term) || tMaybe(s).toLowerCase().includes(term);
    const list = term ? TOOLS.filter((tool) => matches(tool.title) || matches(tool.description) || tool.keywords?.some((k) => k.includes(term))) : TOOLS;
    return toolGroups(list);
  }, [search, locale]);

  return (
    <div className="lib">
      <header className="lib__head">
        <h3>{t('Smart tools')}</h3>
        <span className="badge">{t('On-device')}</span>
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder={t('Search tools')} />
      </div>
      <div className="lib__scroll">
        {TOOLS.length === 0 && (
          <div className="empty">
            <span className="empty__icon">
              <WandSparkles size={20} />
            </span>
            <div className="empty__title">{t('No tools installed')}</div>
          </div>
        )}
        {groups.map(({ group, tools }) => (
          <section key={group} className="tool-group">
            <h4 className="lib__subhead">{tMaybe(group)}</h4>
            {tools.map((tool) => {
              const expanded = open === tool.id;
              const Panel = tool.Panel;
              return (
                <div key={tool.id} className={`tool-card ${expanded ? 'is-open' : ''}`} data-tool={tool.id}>
                  <button type="button" className="tool-card__head" onClick={() => setOpen(expanded ? null : tool.id)} aria-expanded={expanded}>
                    <span className="tool-card__icon">{tool.icon}</span>
                    <span className="tool-card__text">
                      <strong>{tMaybe(tool.title)}</strong>
                      <small>{tMaybe(tool.description)}</small>
                    </span>
                    <ChevronDown size={14} className="tool-card__chev" />
                  </button>
                  {expanded && (
                    <div className="tool-card__body">
                      <Panel close={() => setOpen(null)} />
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
