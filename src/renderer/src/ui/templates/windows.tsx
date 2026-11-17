/**
 * Windows of the templates & branding feature (Save as template, Brand Kit, Content packs,
 * rename / delete). They render in their own small React root so they can be opened from
 * anywhere (commands, the Templates tab, the Home screen, settings) without touching the app
 * shell. While one is open, editor shortcuts are held back so typing or pressing Delete never
 * edits the timeline behind the dialog.
 */

import { Component, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from 'zustand';
import { toast, useUI } from '@/store/ui';
import { BrandKitWindow } from './BrandKit';
import { ConfirmDeleteDialog, RenameTemplateDialog } from './ManageDialogs';
import { PacksWindow } from './Packs';
import { SaveTemplateDialog } from './SaveTemplateDialog';
import './templates.css';

export type TemplatesWindow = { kind: 'save' } | { kind: 'brand' } | { kind: 'packs'; install?: boolean } | { kind: 'rename'; id: string } | { kind: 'delete'; id: string };

const useWindow = create<{ open: TemplatesWindow | null }>(() => ({ open: null }));

let root: Root | null = null;

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error): void {
    console.error('[templates] window crashed', error);
    toast('error', 'The window closed unexpectedly', error.message);
    useWindow.setState({ open: null });
    this.setState({ failed: false });
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

const isField = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node?.tagName) return false;
  if (node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable) return true;
  return node.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes((node as HTMLInputElement).type);
};

function Host(): ReactNode {
  const open = useWindow((s) => s.open);
  const close = (): void => useWindow.setState({ open: null });

  // Hold back editor shortcuts while a window is open (Escape still closes it; fields keep
  // receiving their keys).
  useEffect(() => {
    if (!open) return;
    const guard = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || isField(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(e.key.toLowerCase())) return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', guard, true);
    return () => window.removeEventListener('keydown', guard, true);
  }, [open]);

  // Closing the editor (back to Home) closes editor-only windows.
  useEffect(() => useUI.subscribe((s, prev) => s.screen !== prev.screen && useWindow.getState().open?.kind === 'save' && close()), []);

  if (!open) return null;
  switch (open.kind) {
    case 'save':
      return <SaveTemplateDialog onClose={close} />;
    case 'brand':
      return <BrandKitWindow onClose={close} />;
    case 'packs':
      return <PacksWindow onClose={close} installOnOpen={open.install} />;
    case 'rename':
      return <RenameTemplateDialog id={open.id} onClose={close} />;
    case 'delete':
      return <ConfirmDeleteDialog id={open.id} onClose={close} />;
    default:
      return null;
  }
}

/** Open one of the feature's windows (replacing any other one). */
export function openTemplatesWindow(w: TemplatesWindow): void {
  if (!root) {
    const el = document.createElement('div');
    el.id = 'kinora-templates-windows';
    document.body.appendChild(el);
    root = createRoot(el);
    root.render(
      <Boundary>
        <Host />
      </Boundary>,
    );
  }
  useWindow.setState({ open: w });
}

export const closeTemplatesWindow = (): void => useWindow.setState({ open: null });
export const templatesWindowOpen = (): TemplatesWindow | null => useWindow.getState().open;
