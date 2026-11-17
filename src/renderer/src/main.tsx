import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts';
import './styles/base.css';
import './styles/app.css';
import './styles/workflow.css';
import { App } from './App';
import { engine, usePlayback } from './engine/engine';
import { preloadBundledFonts } from './engine/sources/text';
import { LIBRARY_COUNTS } from './library';
import { hasBridge } from './platform/api';
import { useProjectStore } from './store/project';
import { useUI } from './store/ui';
import * as exporter from './engine/export/exporter';
import * as assets from './engine/media/assets';
import * as actions from './ui/actions';
import * as projectIO from './ui/projectIO';
import * as collect from './ui/collect/collect';
import * as commands from './ui/commands';
import * as keymapStore from './ui/commands/keymapStore';
import * as i18n from './ui/i18n';
import * as paletteStore from './ui/palette/store';
import * as theme from './ui/theme';
import { initI18n } from './ui/i18n';
import { initKeymap } from './ui/commands/keymapStore';
import { initPalette } from './ui/palette/store';
import { initTheme } from './ui/theme';

/** Last line of defence: keep the window usable if a component throws while rendering. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal">
        <h1>{i18n.t('Something went wrong')}</h1>
        <p>{i18n.t('The editor hit an unexpected error. Your project was autosaved and can be recovered from the start screen.')}</p>
        <pre>{this.state.error.message}</pre>
        <button type="button" className="btn btn--primary btn--lg" onClick={() => location.reload()}>
          {i18n.t('Reload Kinora')}
        </button>
      </div>
    );
  }
}

const root = document.getElementById('root')!;

// Fonts are local files: loading them all up front takes a moment and makes template layouts
// (which measure text) exact. Never block startup for long.
const fontsReady = Promise.race([preloadBundledFonts(), new Promise((r) => setTimeout(r, 2500))]);

// Theme and language apply before the first paint (cached locally, then confirmed from settings).
void initTheme();

if (!hasBridge) {
  root.innerHTML = '<div class="fatal"><h1>Kinora</h1><p>This page is the Kinora editor interface. Start it with the Kinora desktop app.</p></div>';
} else {
  void initI18n();
  void initKeymap();
  void initPalette();
  // Handles for automated tests and debugging from DevTools.
  (window as unknown as Record<string, unknown>).__kinora = {
    engine,
    actions,
    projectIO,
    exporter,
    assets,
    useProjectStore,
    useUI,
    usePlayback,
    LIBRARY_COUNTS,
    workflow: { commands, keymap: keymapStore, i18n, theme, palette: paletteStore, collect },
  };
  void fontsReady.then(() =>
    createRoot(root).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    ),
  );
}
