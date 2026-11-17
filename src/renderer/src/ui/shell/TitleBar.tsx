import { Download, Home as HomeIcon, Search, Settings } from 'lucide-react';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { engine } from '@/engine/engine';
import { updateProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { getCommands } from '../commands';
import { Keys } from '../commands/Keys';
import { bindingsFor, useKeymapVersion, withShortcut } from '../commands/keymapStore';
import { buildMenu, menuOf, visibleMenus, type MenuName } from '../commands/menus';
import { openMenuBelow, useMenu } from '../common/overlays';
import { useT } from '../i18n';
import { openPalette } from '../palette/store';
import { openSettings } from '../settings/store';
import { closeProject } from './commands';

export function Logo({ size = 20 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="kinora-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a995ff" />
          <stop offset="0.55" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#kinora-g)" />
      <path d="M12 9.2v13.6a1 1 0 0 0 1.52.86l10.9-6.8a1 1 0 0 0 0-1.7l-10.9-6.82A1 1 0 0 0 12 9.2z" fill="#fff" />
      <rect x="7" y="9" width="2.6" height="14" rx="1.3" fill="#fff" opacity="0.72" />
    </svg>
  );
}

/** A menu is shown when at least one of its commands can run on the current screen. */
function usableMenus(): MenuName[] {
  const commands = getCommands();
  return visibleMenus().filter((name) => commands.some((c) => menuOf(c) === name && (!c.when || c.when())));
}

/** File / Edit / View / Tools / Help, generated from the command registry. */
function MenuBar(): ReactNode {
  const t = useT();
  useKeymapVersion();
  useUI((s) => s.screen);
  const openMenu = useMenu((s) => s.open);
  const [current, setCurrent] = useState<MenuName | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const names = usableMenus();

  const buttonFor = (name: MenuName): HTMLButtonElement | null => navRef.current?.querySelector<HTMLButtonElement>(`[data-menu="${name}"]`) ?? null;

  const show = (name: MenuName, focusFirst: boolean): void => {
    const el = buttonFor(name);
    if (!el) return;
    setCurrent(name);
    openMenuBelow(el, buildMenu(name), {
      minWidth: 240,
      focusFirst,
      label: t(name, undefined, 'menu'),
      onNavigate: (dir) => {
        const i = names.indexOf(name);
        const next = names[(i + dir + names.length) % names.length];
        useMenu.getState().hide();
        requestAnimationFrame(() => show(next, true));
      },
    });
  };

  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>, name: MenuName): void => {
    const i = names.indexOf(name);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      buttonFor(names[(i + (e.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length])?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show(name, true);
    }
  };

  return (
    <nav ref={navRef} className="titlebar__menu" role="menubar" aria-label={t('Main menu')}>
      {names.map((name, i) => (
        <button
          key={name}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={!!openMenu && current === name}
          data-menu={name}
          tabIndex={i === 0 ? 0 : -1}
          className={openMenu && current === name ? 'is-open' : ''}
          onClick={(e) => show(name, e.detail === 0)}
          onKeyDown={(e) => onKey(e, name)}
        >
          {t(name, undefined, 'menu')}
        </button>
      ))}
    </nav>
  );
}

export function TitleBar(): ReactNode {
  const t = useT();
  useKeymapVersion();
  const screen = useUI((s) => s.screen);
  const name = useProjectStore((s) => s.project.name);
  const dirty = useProjectStore((s) => s.project !== s.savedRef);
  const filePath = useProjectStore((s) => s.filePath);
  const hasContent = useProjectStore((s) => Object.keys(s.project.clips).length > 0);
  const [editing, setEditing] = useState(false);
  const editor = screen === 'editor';
  const paletteKey = bindingsFor('view.palette')[0];

  return (
    <header className="titlebar drag-region">
      <div className="titlebar__left no-drag">
        <button
          type="button"
          className="titlebar__brand"
          title={editor ? t('Back to the start screen') : 'Kinora'}
          aria-label={editor ? t('Back to the start screen') : 'Kinora'}
          onClick={() => editor && void closeProject()}
        >
          <Logo size={20} />
          {!editor && <span>Kinora</span>}
        </button>
        {editor && (
          <button type="button" className="icon-btn" title={t('Start screen')} aria-label={t('Start screen')} onClick={() => void closeProject()}>
            <HomeIcon size={15} />
          </button>
        )}
        <MenuBar />
      </div>

      {editor && (
        <div className="titlebar__center no-drag">
          {editing ? (
            <input
              autoFocus
              className="titlebar__name-input"
              aria-label={t('Project name')}
              defaultValue={name}
              spellCheck={false}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== name) updateProject((p) => void (p.name = next.slice(0, 120)));
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                e.stopPropagation();
              }}
            />
          ) : (
            <button type="button" className="titlebar__name truncate" title={t('Rename project')} onClick={() => setEditing(true)}>
              {name}
            </button>
          )}
          <span className={`titlebar__state ${dirty && (hasContent || filePath) ? 'is-dirty' : ''}`} title={filePath ?? t('Not saved to a file yet')}>
            {dirty && (hasContent || filePath) ? t('Unsaved changes') : filePath ? t('Saved') : ''}
          </span>
        </div>
      )}

      <div className="titlebar__right no-drag">
        <button type="button" className="titlebar__search" onClick={() => openPalette()} title={withShortcut(t('Command palette'), 'view.palette')} aria-label={t('Command palette')} data-action="palette">
          <Search size={13} aria-hidden="true" />
          <span>{t('Search')}</span>
          {paletteKey && <Keys shortcut={paletteKey} size="sm" />}
        </button>
        <button type="button" className="icon-btn" title={withShortcut(t('Settings'), 'app.settings')} aria-label={t('Settings')} onClick={() => openSettings()} data-action="settings">
          <Settings size={16} />
        </button>
        {editor && (
          <button
            type="button"
            className="btn btn--primary"
            title={withShortcut(t('Export'), 'file.export')}
            onClick={() => {
              engine.pause();
              useUI.getState().openModal('export');
            }}
          >
            <Download size={14} /> {t('Export')}
          </button>
        )}
      </div>
    </header>
  );
}
