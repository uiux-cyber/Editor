import type { Marker } from '@/core/types';

/** Beat markers are ordinary project markers in two reserved colours. */
export const BEAT_COLOR = '#22d3ee';
export const DOWNBEAT_COLOR = '#f472b6';

export const isBeatMarker = (m: Pick<Marker, 'color' | 'label'>): boolean =>
  (m.color === BEAT_COLOR && m.label === 'Beat') || (m.color === DOWNBEAT_COLOR && /^Bar \d+$/.test(m.label));
