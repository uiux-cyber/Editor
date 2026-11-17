/**
 * Templates & branding commands (command palette, menus, shortcuts).
 */

import { getProject } from '@/store/project';
import { useUI } from '@/store/ui';
import type { Command } from '../index';
import { applyBrandToSelection } from '../../templates/apply';
import { setIncludeMusic, setUseBrand, useTemplates } from '../../templates/store';
import { openTemplatesWindow } from '../../templates/windows';

const inEditor = (): boolean => useUI.getState().screen === 'editor';
const hasSelection = (): boolean => inEditor() && useUI.getState().selection.some((id) => !!getProject().clips[id]);

const commands: Command[] = [
  {
    id: 'templates.saveSelection',
    title: 'Save selection as template…',
    group: 'Templates',
    keywords: ['template', 'save', 'reuse', 'my templates', 'preset'],
    when: hasSelection,
    run: () => openTemplatesWindow({ kind: 'save' }),
  },
  {
    id: 'templates.brandKit',
    title: 'Brand kit…',
    group: 'Templates',
    keywords: ['brand', 'logo', 'colours', 'colors', 'fonts', 'identity'],
    run: () => openTemplatesWindow({ kind: 'brand' }),
  },
  {
    id: 'templates.applyBrand',
    title: 'Apply brand to selection',
    group: 'Templates',
    keywords: ['brand', 'restyle', 'colours', 'fonts', 'on brand'],
    when: () => hasSelection() && useTemplates.getState().brandSet,
    run: () => applyBrandToSelection(),
  },
  {
    id: 'templates.toggleBrand',
    title: 'Use my brand in templates',
    group: 'Templates',
    keywords: ['brand', 'templates', 'palette', 'toggle'],
    run: () => {
      const s = useTemplates.getState();
      if (!s.brandSet) {
        setUseBrand(true);
        openTemplatesWindow({ kind: 'brand' });
        return;
      }
      setUseBrand(!s.useBrand);
    },
  },
  {
    id: 'templates.toggleMusic',
    title: 'Include music when applying templates',
    group: 'Templates',
    keywords: ['music', 'sound', 'templates', 'toggle'],
    run: () => setIncludeMusic(!useTemplates.getState().includeMusic),
  },
  {
    id: 'templates.showMine',
    title: 'Show my templates',
    group: 'Templates',
    keywords: ['my templates', 'saved', 'user'],
    when: () => inEditor() && useTemplates.getState().templates.length > 0,
    run: () => {
      useTemplates.setState({ galleryCategory: 'mine' });
      useUI.getState().setLibraryTab('templates');
    },
  },
  {
    id: 'templates.installPack',
    title: 'Install content pack…',
    group: 'Templates',
    keywords: ['pack', 'kinorapack', 'install', 'content', 'add-on', 'import'],
    run: () => openTemplatesWindow({ kind: 'packs', install: true }),
  },
  {
    id: 'templates.managePacks',
    title: 'Manage content packs…',
    group: 'Templates',
    keywords: ['pack', 'kinorapack', 'remove', 'content'],
    run: () => openTemplatesWindow({ kind: 'packs' }),
  },
];

export default commands;
