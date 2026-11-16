import { useSyncExternalStore } from 'react';
import { getLibraryVersion, onLibraryChange } from '@/library';

/** Re-render when content packs or user templates are registered / removed. */
export function useLibraryVersion(): number {
  return useSyncExternalStore(onLibraryChange, getLibraryVersion);
}
