import { app, nativeTheme } from 'electron';
import type { MainContext } from '../context';

/**
 * Window chrome for the colour theme (renderer: ui/theme.ts).
 *
 *  - `x:theme:source` (system | dark | light) sets `nativeTheme.themeSource`, which also drives the
 *    renderer's `prefers-color-scheme`, native dialogs and form controls. Returns whether dark
 *    colours are in effect.
 *  - `x:theme:chrome` ({ color, symbolColor }) recolours the native title-bar buttons overlay and
 *    the window background to match the title bar.
 *
 * The last colours are remembered per theme so the window opens in the right colours (no flash).
 */

type Source = 'system' | 'dark' | 'light';
interface Chrome {
  color: string;
  symbolColor: string;
}

const FALLBACK: Record<'dark' | 'light', Chrome> = {
  dark: { color: '#07080b', symbolColor: '#c9ced9' },
  light: { color: '#eceef3', symbolColor: '#2c3240' },
};

const isColor = (v: unknown): v is string => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(v.trim());

export default function register(ctx: MainContext): void {
  const saved = ctx.settings.get<string>('user.appearance.theme');
  nativeTheme.themeSource = saved === 'light' || saved === 'system' ? saved : 'dark';

  const chromeFor = (dark: boolean): Chrome => {
    const key = dark ? 'dark' : 'light';
    const stored = ctx.settings.get<Chrome>(`theme.chrome.${key}`);
    return stored && isColor(stored.color) && isColor(stored.symbolColor) ? stored : FALLBACK[key];
  };

  const paint = (chrome: Chrome): void => {
    const win = ctx.window();
    if (!win || win.isDestroyed()) return;
    win.setBackgroundColor(chrome.color);
    try {
      win.setTitleBarOverlay({ color: chrome.color, symbolColor: chrome.symbolColor, height: 40 });
    } catch {
      /* no overlay on this platform */
    }
  };

  // Open the window in the saved theme's colours.
  app.on('browser-window-created', (_e, win) => {
    const chrome = chromeFor(nativeTheme.shouldUseDarkColors);
    win.setBackgroundColor(chrome.color);
    try {
      win.setTitleBarOverlay({ color: chrome.color, symbolColor: chrome.symbolColor, height: 40 });
    } catch {
      /* no overlay on this platform */
    }
  });

  // Following the OS: repaint the native buttons right away (the renderer recolours itself).
  nativeTheme.on('updated', () => {
    if (nativeTheme.themeSource === 'system') paint(chromeFor(nativeTheme.shouldUseDarkColors));
  });

  ctx.handle('x:theme:source', (source: Source): boolean => {
    if (source === 'system' || source === 'dark' || source === 'light') nativeTheme.themeSource = source;
    return nativeTheme.shouldUseDarkColors;
  });

  ctx.handle('x:theme:chrome', (chrome: Chrome) => {
    if (!chrome || !isColor(chrome.color) || !isColor(chrome.symbolColor)) return;
    const next = { color: chrome.color.trim(), symbolColor: chrome.symbolColor.trim() };
    ctx.settings.set(`theme.chrome.${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}`, next);
    paint(next);
  });
}
