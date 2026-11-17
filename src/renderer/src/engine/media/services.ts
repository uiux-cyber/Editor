/**
 * Starts the performance & media services once the renderer is up: preferences, proxies,
 * the background render cache, FFmpeg events and the HDR registry, plus the debug handle used
 * by the automated tests (`window.__kinoraMedia`).
 */

import { hasBridge } from '@/platform/api';
import { getProject, useProjectStore } from '@/store/project';
import { clearRenderCache, defaultRenderRange, renderPreview, cancelRender, reloadCacheIndex, segmentStatus, statusRuns, useRenderCache } from '../cache/renderCache';
import { playbackStats, resetPlaybackStats } from '../cache/player';
import { onAssetsImported, onProjectAssetsPrepared } from './assets';
import { exposeDebug } from './debug';
import { convertAndImport, detectFfmpeg, startFfmpegService, useFfmpeg } from './ffmpeg';
import { hdrInfoById, hdrPassthrough, probeHdrPipeline, setHdrInfo } from './hdr';
import { loadMediaPrefs, useMediaPrefs } from './prefs';
import { autoProxy, cancelProxy, clearAllProxies, deleteProxy, eligibility, requestProxy, setUseProxies, startProxyService, useProxyJobs, verifyProxies } from './proxies';
import { startRenderCache } from '../cache/renderCache';

let started = false;

export function startMediaServices(): void {
  if (started || !hasBridge) return;
  started = true;
  void loadMediaPrefs();
  startProxyService();
  startFfmpegService();
  startRenderCache();
  onAssetsImported((assets) => {
    for (const a of assets) if (a.hdr) setHdrInfo(a.id, null);
    void loadMediaPrefs().then(() => autoProxy(assets));
  });
  onProjectAssetsPrepared((project) => void loadMediaPrefs().then(() => verifyProxies(project)));
  // Register HDR assets of whatever project is open (also covers undo of a removal).
  useProjectStore.subscribe((s, prev) => {
    if (s.project.assets === prev.project.assets) return;
    for (const a of Object.values(s.project.assets)) if (a.hdr && !hdrInfoById(a.id)) setHdrInfo(a.id, null);
  });

  exposeDebug({
    prefs: useMediaPrefs,
    proxies: { requestProxy, cancelProxy, deleteProxy, clearAllProxies, eligibility, setUseProxies, jobs: useProxyJobs },
    cache: { renderPreview, cancelRender, clearRenderCache, reloadCacheIndex, defaultRenderRange, statusRuns, segmentStatus, state: useRenderCache, playbackStats, resetPlaybackStats },
    ffmpeg: { detectFfmpeg, convertAndImport, state: useFfmpeg },
    hdr: { hdrInfoById, hdrPassthrough, probeHdrPipeline },
    getProject,
  });
}
