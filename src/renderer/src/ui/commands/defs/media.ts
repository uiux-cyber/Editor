/**
 * Commands of the performance & media area (command palette, menus, shortcuts).
 */

import { cancelRender, clearRenderCache, renderPreview, useRenderCache } from '@/engine/cache/renderCache';
import { detectFfmpeg } from '@/engine/media/ffmpeg';
import { useMediaPrefs } from '@/engine/media/prefs';
import { autoProxy, cancelAllProxies, deleteProxy, requestProxy, setUseProxies, useProxyJobs } from '@/engine/media/proxies';
import { getProject } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { openMediaSettings } from '../../media/SettingsHost';
import type { Command } from '../index';

const editor = (): boolean => useUI.getState().screen === 'editor';

/** Video assets of the selected clips (or every video asset when nothing is selected). */
function targetVideoAssets(): string[] {
  const p = getProject();
  const sel = useUI.getState().selection.map((id) => p.clips[id]).filter((c) => c && c.type === 'video');
  const ids = sel.length ? sel.map((c) => (c as { assetId: string }).assetId) : Object.values(p.assets).filter((a) => a.kind === 'video').map((a) => a.id);
  return [...new Set(ids)].filter((id) => p.assets[id]?.source.type === 'file');
}

const commands: Command[] = [
  {
    id: 'view.useProxies',
    title: 'Use proxies in the preview',
    group: 'View',
    menuSection: 'Preview',
    menuTitle: 'Use proxies',
    checked: () => useMediaPrefs.getState().useProxies,
    keywords: ['proxy', 'proxies', 'performance', 'optimized media', 'playback'],
    when: editor,
    run: () => {
      const on = !useMediaPrefs.getState().useProxies;
      setUseProxies(on);
      toast('info', on ? 'Proxies on' : 'Proxies off', on ? 'The preview plays lightweight copies where they exist.' : 'The preview plays the original files.');
    },
  },
  {
    id: 'media.createProxies',
    title: 'Create proxies for selected media',
    group: 'Clip',
    keywords: ['proxy', 'optimize', 'performance', '4k'],
    when: editor,
    run: () => {
      const ids = targetVideoAssets();
      const n = ids.filter((id) => requestProxy(id, { reason: 'Requested' })).length;
      toast('info', n ? `Creating ${n} prox${n === 1 ? 'y' : 'ies'}` : 'Proxies already exist', n ? 'Progress shows on the media tiles and below the preview.' : undefined);
    },
  },
  {
    id: 'media.createProxiesHeavy',
    title: 'Create proxies for heavy media',
    group: 'Clip',
    keywords: ['proxy', 'auto', 'performance', '4k', 'hevc'],
    when: editor,
    run: () => void autoProxy(Object.values(getProject().assets).filter((a) => a.kind === 'video' && !a.proxy)),
  },
  {
    id: 'media.deleteProxies',
    title: 'Delete proxies of selected media',
    group: 'Clip',
    keywords: ['proxy', 'remove'],
    when: () => editor() && targetVideoAssets().some((id) => !!getProject().assets[id]?.proxy),
    run: () => targetVideoAssets().forEach((id) => void deleteProxy(id)),
  },
  {
    id: 'media.cancelProxies',
    title: 'Cancel all proxy creation',
    group: 'Clip',
    keywords: ['proxy', 'stop'],
    when: () => Object.keys(useProxyJobs.getState().jobs).length > 0,
    run: cancelAllProxies,
  },
  {
    id: 'timeline.renderPreview',
    title: 'Render preview (in/out, selection or timeline)',
    group: 'Timeline',
    menu: 'View',
    menuSection: 'Preview',
    menuTitle: 'Render preview',
    keywords: ['render', 'cache', 'smooth playback', 'performance', 'pre-render'],
    shortcut: 'Enter',
    when: () => editor() && !useRenderCache.getState().job,
    run: () => void renderPreview(),
  },
  {
    id: 'timeline.stopRender',
    title: 'Stop rendering preview',
    group: 'Timeline',
    keywords: ['render', 'cancel'],
    when: () => !!useRenderCache.getState().job,
    run: cancelRender,
  },
  {
    id: 'timeline.deleteRenderFiles',
    title: 'Delete render files',
    group: 'Timeline',
    keywords: ['render', 'cache', 'clear', 'disk'],
    when: editor,
    run: () => void clearRenderCache().then((n) => toast('success', 'Render files deleted', `${n} file${n === 1 ? '' : 's'} removed.`)),
  },
  {
    id: 'settings.performance',
    title: 'Performance & media settings…',
    group: 'File',
    keywords: ['settings', 'proxies', 'render cache', 'ffmpeg', 'preferences'],
    run: () => openMediaSettings(),
  },
  {
    id: 'media.findFfmpeg',
    title: 'Find FFmpeg…',
    group: 'File',
    keywords: ['ffmpeg', 'convert', 'prores', 'dnxhd'],
    run: () => {
      void detectFfmpeg(true);
      openMediaSettings('ffmpeg');
    },
  },
];

export default commands;
