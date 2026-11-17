/** Timeline toolbar additions for the editing tools, plus the live drag readout. */

import { History } from 'lucide-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/store/project';
import { useUI, type Tool } from '@/store/ui';
import { toggleMagneticMain } from '../actions';
import { formatDelta, useEditReadout } from './editGestures';
import { useHistoryPanel } from './HistoryPanel';
import { MainMagnetIcon, RippleIcon, RollIcon, SlideIcon, SlipIcon } from './icons';
import { useKeymapVersion, withShortcut } from '../commands/keymapStore';

const TRIM_TOOLS: { tool: Tool; key: string; title: string; icon: ReactNode }[] = [
  { tool: 'ripple', key: 'E', title: 'Ripple tool — drag a clip edge; later clips move to keep the gap closed. Tip: hold Shift while trimming with the Select tool.', icon: <RippleIcon /> },
  { tool: 'roll', key: 'R', title: 'Roll tool — drag a cut between two clips: one gets longer, the other shorter.', icon: <RollIcon /> },
  { tool: 'slip', key: 'Y', title: 'Slip tool — drag a clip to change which part of its media plays, keeping its place and length.', icon: <SlipIcon /> },
  { tool: 'slide', key: 'U', title: 'Slide tool — drag a clip between its neighbours; they trim to make room.', icon: <SlideIcon /> },
];

/** "Name — description" with the tool's current shortcut after the name. */
function tipFor(tool: Tool, title: string): string {
  const [name, ...rest] = title.split(' — ');
  return [withShortcut(name, `timeline.tool.${tool}`), ...rest].join(' — ');
}

/** Ripple / roll / slip / slide tool buttons. */
export function TrimToolButtons(): ReactNode {
  const tool = useUI((s) => s.tool);
  useKeymapVersion();
  return (
    <>
      {TRIM_TOOLS.map((t) => (
        <button key={t.tool} type="button" data-tool={t.tool} className={`icon-btn ${tool === t.tool ? 'is-active' : ''}`} title={tipFor(t.tool, t.title)} onClick={() => useUI.getState().setTool(tool === t.tool ? 'select' : t.tool)}>
          {t.icon}
        </button>
      ))}
    </>
  );
}

/** Magnetic main track toggle. */
export function MagneticButton(): ReactNode {
  const on = useProjectStore((s) => !!s.project.magneticMain);
  return (
    <button
      type="button"
      data-magnetic-toggle
      className={`icon-btn ${on ? 'is-active' : ''}`}
      title={on ? 'Magnetic main track is on — clips on Main stay together with no gaps. Click to turn off.' : 'Magnetic main track is off — click so clips on the bottom track stay together with no gaps.'}
      onClick={toggleMagneticMain}
    >
      <MainMagnetIcon />
    </button>
  );
}

/** Opens the History popover. */
export function HistoryButton(): ReactNode {
  const open = useHistoryPanel((s) => s.open);
  useKeymapVersion();
  return (
    <button type="button" data-history-button className={`icon-btn ${open ? 'is-active' : ''}`} title={`${withShortcut('History', 'view.history')} — every change, click one to go back to it`} onClick={(e) => useHistoryPanel.getState().toggle(e.currentTarget)}>
      <History size={15} />
    </button>
  );
}

/** Floating readout next to the pointer while an edit is dragged. */
export function EditReadout(): ReactNode {
  const r = useEditReadout((s) => s.readout);
  if (!r) return null;
  const { tc, frames } = formatDelta(r.delta, r.fps);
  const left = Math.min(window.innerWidth - 220, r.x + 16);
  const top = Math.max(8, r.y - 54);
  return createPortal(
    <div className={`edit-readout ${r.limited ? 'is-limited' : ''}`} style={{ left, top }} data-edit-readout>
      <span className="edit-readout__title">{r.title}</span>
      <span className="edit-readout__delta mono">{tc}</span>
      <span className="edit-readout__frames mono">{frames}</span>
      {r.note && <span className="edit-readout__note">{r.note}</span>}
      {r.limited && <span className="edit-readout__limit" title="The media, a neighbouring clip or the minimum length stops the edit here">Limit</span>}
    </div>,
    document.body,
  );
}
