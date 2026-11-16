import { Blend, FolderOpen, LayoutTemplate, Music, Palette, Shapes, Smile, Sparkles, Type, WandSparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUI, type LibraryTab } from '@/store/ui';
import { AudioTab } from './AudioTab';
import { ElementsTab } from './ElementsTab';
import { EffectsTab, FiltersTab, TransitionsTab } from './FxTabs';
import { MediaTab } from './MediaTab';
import { StickersTab } from './StickersTab';
import { TemplatesTab } from './TemplatesTab';
import { TextTab } from './TextTab';
import { ToolsTab } from '../tools/ToolsTab';

const TABS: { id: LibraryTab; label: string; icon: ReactNode }[] = [
  { id: 'media', label: 'Media', icon: <FolderOpen size={18} /> },
  { id: 'templates', label: 'Templates', icon: <LayoutTemplate size={18} /> },
  { id: 'text', label: 'Text', icon: <Type size={18} /> },
  { id: 'stickers', label: 'Stickers', icon: <Smile size={18} /> },
  { id: 'transitions', label: 'Transitions', icon: <Blend size={18} /> },
  { id: 'effects', label: 'Effects', icon: <Sparkles size={18} /> },
  { id: 'filters', label: 'Filters', icon: <Palette size={18} /> },
  { id: 'audio', label: 'Audio', icon: <Music size={18} /> },
  { id: 'elements', label: 'Elements', icon: <Shapes size={18} /> },
  { id: 'tools', label: 'Smart', icon: <WandSparkles size={18} /> },
];

export function LibraryRail(): ReactNode {
  const tab = useUI((s) => s.libraryTab);
  const setTab = useUI((s) => s.setLibraryTab);
  return (
    <nav className="rail" aria-label="Library">
      {TABS.map((t) => (
        <button key={t.id} type="button" className={`rail__btn ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)} data-tab={t.id}>
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function LibraryPanel(): ReactNode {
  const tab = useUI((s) => s.libraryTab);
  switch (tab) {
    case 'media':
      return <MediaTab />;
    case 'templates':
      return <TemplatesTab />;
    case 'text':
      return <TextTab />;
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
