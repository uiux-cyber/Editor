import { ChevronDown, WandSparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { SearchBox } from '../library/common';
import { TOOLS, toolGroups } from './index';

/** Library tab listing the smart tools; each card expands into its own panel. */
export function ToolsTab(): ReactNode {
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term ? TOOLS.filter((t) => t.title.toLowerCase().includes(term) || t.description.toLowerCase().includes(term) || t.keywords?.some((k) => k.includes(term))) : TOOLS;
    return toolGroups(list);
  }, [search]);

  return (
    <div className="lib">
      <header className="lib__head">
        <h3>Smart tools</h3>
        <span className="badge">On-device</span>
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder="Search tools" />
      </div>
      <div className="lib__scroll">
        {TOOLS.length === 0 && (
          <div className="empty">
            <span className="empty__icon">
              <WandSparkles size={20} />
            </span>
            <div className="empty__title">No tools installed</div>
          </div>
        )}
        {groups.map(({ group, tools }) => (
          <section key={group} className="tool-group">
            <h4 className="lib__subhead">{group}</h4>
            {tools.map((tool) => {
              const expanded = open === tool.id;
              const Panel = tool.Panel;
              return (
                <div key={tool.id} className={`tool-card ${expanded ? 'is-open' : ''}`} data-tool={tool.id}>
                  <button type="button" className="tool-card__head" onClick={() => setOpen(expanded ? null : tool.id)} aria-expanded={expanded}>
                    <span className="tool-card__icon">{tool.icon}</span>
                    <span className="tool-card__text">
                      <strong>{tool.title}</strong>
                      <small>{tool.description}</small>
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
