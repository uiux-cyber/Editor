import { Blend, FolderOpen, LayoutTemplate, Music, Orbit, Palette, Shapes, Smile, Sparkles, Type, WandSparkles } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useUI, type LibraryTab } from '@/store/ui';
import { tk, tMaybe, useT } from '../i18n';
import { useLibraryVersion } from '../templates/hooks';
import { AudioTab } from './AudioTab';
import { ElementsTab } from './ElementsTab';
import { EffectsTab, FiltersTab, TransitionsTab } from './FxTabs';
import { MediaTab } from './MediaTab';
import { MotionTab } from './MotionTab';
import { StickersTab } from './StickersTab';
import { TemplatesTab } from './TemplatesTab';
import { TextTab } from './TextTab';
import { ToolsTab } from '../tools/ToolsTab';

const TABS: { id: LibraryTab; label: string; icon: ReactNode }[] = [
  { id: 'media', label: tk('Media'), icon: <FolderOpen size={18} /> },
  { id: 'templates', label: tk('Templates'), icon: <LayoutTemplate size={18} /> },
  { id: 'text', label: tk('Text'), icon: <Type size={18} /> },
  { id: 'motion', label: tk('Motion'), icon: <Orbit size={18} /> },
  { id: 'stickers', label: tk('Stickers'), icon: <Smile size={18} /> },
  { id: 'transitions', label: tk('Transitions'), icon: <Blend size={18} /> },
  { id: 'effects', label: tk('Effects'), icon: <Sparkles size={18} /> },
  { id: 'filters', label: tk('Filters'), icon: <Palette size={18} /> },
  { id: 'audio', label: tk('Audio'), icon: <Music size={18} /> },
  { id: 'elements', label: tk('Elements'), icon: <Shapes size={18} /> },
  { id: 'tools', label: tk('Smart'), icon: <WandSparkles size={18} /> },
];

export function LibraryRail(): ReactNode {
  const tab = useUI((s) => s.libraryTab);
  const setTab = useUI((s) => s.setLibraryTab);
  const t = useT();
  return (
    <nav className="rail" aria-label={t('Library')}>
      {TABS.map((item) => (
        <button key={item.id} type="button" className={`rail__btn ${tab === item.id ? 'is-active' : ''}`} onClick={() => setTab(item.id)} data-tab={item.id}>
          {item.icon}
          <span>{tMaybe(item.label)}</span>
        </button>
      ))}
    </nav>
  );
}

export function LibraryPanel(): ReactNode {
  const tab = useUI((s) => s.libraryTab);
  // Content packs register items at runtime: remount the open gallery so its lists refresh.
  const version = useLibraryVersion();
  return <Fragment key={version}>{panelFor(tab)}</Fragment>;
}

function panelFor(tab: LibraryTab): ReactNode {
  switch (tab) {
    case 'media':
      return <MediaTab />;
    case 'templates':
      return <TemplatesTab />;
    case 'text':
      return <TextTab />;
    case 'motion':
      return <MotionTab />;
    case 'stickers':
      return <StickersTab />;
    case 'transitions':
      return <TransitionsTab />;
    case 'effects':
      return <EffectsTab />;
    case 'filters':
      return <FiltersTab />;
    case 'audio':
      return <AudioTab />;
    case 'tools':
      return <ToolsTab />;
    case 'elements':
      return <ElementsTab />;
    default:
      return null;
  }
}
