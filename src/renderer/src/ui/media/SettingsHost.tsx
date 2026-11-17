/**
 * Opens the performance & media settings. They are regular sections of the Settings window
 * (ui/settings/defs/media.tsx); when no Settings window is available in this build, the same
 * sections are shown in a dialog of their own so the preferences stay reachable.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import { useUI } from '@/store/ui';
import { Modal } from '../common/overlays';
import mediaSections from '../settings/defs/media';

const useHost = create<{ open: boolean; focus: string | null }>()(() => ({ open: false, focus: null }));

/** Open the Settings window (falls back to a dialog with the media sections). */
export function openMediaSettings(section?: string): void {
  const ui = useUI.getState();
  if (ui.modal === null) ui.openModal('settings');
  // Give the Settings window two frames to appear; otherwise show our own host.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (document.querySelector('.modal')) return;
      if (useUI.getState().modal === 'settings') useUI.getState().openModal(null);
      useHost.setState({ open: true, focus: section ?? null });
    }),
  );
}

export function closeMediaSettings(): void {
  useHost.setState({ open: false, focus: null });
}

export function MediaSettingsHost(): ReactNode {
  const open = useHost((s) => s.open);
  const focus = useHost((s) => s.focus);
  if (!open) return null;
  const list = focus ? mediaSections.filter((s) => s.id === focus) : mediaSections;
  return (
    <div className="mx-settings-host">
      <Modal title="Performance & media" subtitle="Proxies, background rendering and FFmpeg conversion" onClose={closeMediaSettings} width={620}>
        {list.map((s) => (
          <section key={s.id} data-settings-host-section={s.id}>
            <h3>{s.title}</h3>
            <s.Component />
          </section>
        ))}
      </Modal>
    </div>
  );
}
