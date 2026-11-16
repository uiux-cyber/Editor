/** Timeline tool icons, drawn in the same 24-unit, 2-px-stroke style as lucide. */

import type { ReactNode } from 'react';

function Glyph({ size = 15, children }: { size?: number; children: ReactNode }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Ripple: a clip edge that pushes everything after it. */
export const RippleIcon = ({ size }: { size?: number }): ReactNode => (
  <Glyph size={size}>
    <path d="M4 5v14M4 5h3M4 19h3" />
    <rect x="9" y="8" width="5" height="8" rx="1" />
    <path d="M17 12h4M19 10l2 2-2 2" />
  </Glyph>
);

/** Roll: a cut that moves both ways. */
export const RollIcon = ({ size }: { size?: number }): ReactNode => (
  <Glyph size={size}>
    <path d="M12 4v16" />
    <path d="M9 7H6v10h3M15 7h3v10h-3" />
    <path d="M2 12h1.5M22 12h-1.5" />
  </Glyph>
);

/** Slip: fixed clip edges, the picture moving inside. */
export const SlipIcon = ({ size }: { size?: number }): ReactNode => (
  <Glyph size={size}>
    <path d="M4 5v14M20 5v14" />
    <path d="M8 12h8M10 9.5 7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5" />
  </Glyph>
);

/** Slide: a clip moving between its neighbours. */
export const SlideIcon = ({ size }: { size?: number }): ReactNode => (
  <Glyph size={size}>
    <rect x="8" y="7" width="8" height="10" rx="1.5" />
    <path d="M2 12h3.5M3.5 10.5 2 12l1.5 1.5M22 12h-3.5M20.5 10.5 22 12l-1.5 1.5" />
  </Glyph>
);

/** Magnetic main track: a magnet holding a track. */
export const MainMagnetIcon = ({ size }: { size?: number }): ReactNode => (
  <Glyph size={size}>
    <path d="M7 3v6a5 5 0 0 0 10 0V3" />
    <path d="M7 6h3M14 6h3" />
    <path d="M3 20h18" />
    <path d="M12 16.5v1.5" />
  </Glyph>
);

/** Group badge. */
export const GroupBadgeIcon = ({ size = 10 }: { size?: number }): ReactNode => (
  <Glyph size={size}>
    <rect x="3" y="3" width="11" height="11" rx="2" />
    <rect x="10" y="10" width="11" height="11" rx="2" />
  </Glyph>
);
