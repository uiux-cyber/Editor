/**
 * Names for undo steps that were committed without an explicit label (inspector edits, gestures
 * from other panels…), derived by comparing the project before and after. Immer's structural
 * sharing keeps this cheap: unchanged clips and fields are the same objects.
 */

import type { Clip, Project } from '@/core/types';

const TYPE_NAMES: Record<Clip['type'], string> = {
  video: 'video',
  image: 'image',
  audio: 'audio',
  text: 'text',
  sticker: 'sticker',
  shape: 'shape',
  generator: 'background',
  adjustment: 'adjustment layer',
  compound: 'compound clip',
};

/** Friendly names for clip fields; anything else is turned from camelCase into words. */
const FIELD_NAMES: Record<string, string> = {
  blendMode: 'blend mode',
  adjust: 'colour adjustments',
  filter: 'filter',
  effects: 'effects',
  anim: 'animation',
  textAnim: 'text animation',
  keyframes: 'keyframes',
  volume: 'volume',
  muted: 'mute',
  fadeIn: 'fade in',
  fadeOut: 'fade out',
  speed: 'speed',
  speedRamp: 'speed ramp',
  crop: 'crop',
  mask: 'mask',
  chromaKey: 'chroma key',
  cornerRadius: 'roundness',
  flipH: 'flip',
  flipV: 'flip',
  groupId: 'group',
  linkId: 'link',
  name: 'clip name',
  size: 'sticker size',
  colors: 'sticker colours',
  params: 'background settings',
  lut: 'LUT',
  cutout: 'background removal',
  eq: 'equaliser',
  compressor: 'compressor',
  counter: 'counter',
  caption: 'caption',
};

const SUB_NAMES: Record<string, string> = {
  x: 'position',
  y: 'position',
  scaleX: 'scale',
  scaleY: 'scale',
  rotation: 'rotation',
  opacity: 'opacity',
  content: 'text',
  fontFamily: 'font',
  fontSize: 'font size',
  fontWeight: 'font weight',
  fill: 'colour',
  boxWidth: 'text box width',
  kind: 'shape',
};

const words = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function changedKeys(a: object, b: object): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) out.push(k);
  return out;
}

function nameOf(field: string, before: Clip, after: Clip): string {
  const a = (before as unknown as Record<string, unknown>)[field];
  const b = (after as unknown as Record<string, unknown>)[field];
  if ((field === 'transform' || field === 'text' || field === 'shape') && a && b && typeof a === 'object' && typeof b === 'object') {
    const subs = [...new Set(changedKeys(a, b).map((k) => SUB_NAMES[k] ?? words(k)))];
    if (subs.length === 1) return subs[0];
    return field === 'transform' ? 'transform' : field === 'text' ? 'text style' : 'shape';
  }
  if (field === 'adjust' && a && b && typeof a === 'object' && typeof b === 'object') {
    const subs = changedKeys(a, b);
    if (subs.length === 1) return words(subs[0]);
  }
  return FIELD_NAMES[field] ?? words(field);
}

function describeClips(prev: Project, next: Project): string | null {
  const added: Clip[] = [];
  const removed: Clip[] = [];
  const changed: [Clip, Clip][] = [];
  for (const [id, clip] of Object.entries(next.clips)) {
    const old = prev.clips[id];
    if (!old) added.push(clip);
    else if (old !== clip) changed.push([old, clip]);
  }
  for (const [id, clip] of Object.entries(prev.clips)) if (!next.clips[id]) removed.push(clip);

  const one = (list: Clip[]): string => (list.length === 1 ? TYPE_NAMES[list[0].type] : `${list.length} clips`);
  if (added.length && removed.length) return added.length === 1 && removed.length === 1 ? 'Replace clip' : 'Edit clips';
  if (added.length) return `Add ${one(added)}`;
  if (removed.length) return `Delete ${one(removed)}`;
  if (!changed.length) return null;

  const fields = new Set<string>();
  for (const [a, b] of changed) for (const k of changedKeys(a, b)) fields.add(k);
  const timing = ['start', 'duration', 'trimIn', 'trackId'];
  if ([...fields].every((f) => timing.includes(f))) {
    if (fields.has('duration')) return changed.length > 1 ? 'Trim clips' : 'Trim clip';
    if (fields.has('trimIn')) return 'Slip clip';
    return changed.length > 1 ? 'Move clips' : 'Move clip';
  }
  const names = [...new Set([...fields].filter((f) => !timing.includes(f)).map((f) => nameOf(f, changed[0][0], changed[0][1])))];
  if (names.length === 1) {
    const n = names[0];
    if (n === 'keyframes') return 'Edit keyframes';
    if (n === 'text') return 'Edit text';
    if (n === 'flip') return 'Flip';
    if (n === 'mute') return 'Mute clip';
    return `Change ${n}`;
  }
  return changed.length > 1 ? 'Edit clips' : `Edit ${TYPE_NAMES[changed[0][1].type]}`;
}

/** A short, human label for the change from `prev` to `next`. */
export function describeChange(prev: Project | null, next: Project): string {
  if (!prev) return 'Edit';
  if (prev.clips !== next.clips) {
    const label = describeClips(prev, next);
    if (label) return label;
  }
  if (prev.transitions !== next.transitions) {
    const a = Object.keys(prev.transitions).length;
    const b = Object.keys(next.transitions).length;
    return b > a ? 'Add transition' : b < a ? 'Remove transition' : 'Edit transition';
  }
  if (prev.tracks !== next.tracks) {
    if (next.tracks.length > prev.tracks.length) return 'Add track';
    if (next.tracks.length < prev.tracks.length) return 'Delete track';
    for (let i = 0; i < next.tracks.length; i++) {
      const a = prev.tracks[i];
      const b = next.tracks[i];
      if (a === b) continue;
      if (a.id !== b.id) return 'Reorder tracks';
      if (a.hidden !== b.hidden) return b.hidden ? 'Hide track' : 'Show track';
      if (a.muted !== b.muted) return b.muted ? 'Mute track' : 'Unmute track';
      if (a.locked !== b.locked) return b.locked ? 'Lock track' : 'Unlock track';
      if (a.name !== b.name) return 'Rename track';
      if (a.height !== b.height) return 'Resize track';
    }
    return 'Edit tracks';
  }
  if (prev.markers !== next.markers) {
    return next.markers.length > prev.markers.length ? 'Add marker' : next.markers.length < prev.markers.length ? 'Remove marker' : 'Edit marker';
  }
  if (prev.magneticMain !== next.magneticMain) return next.magneticMain ? 'Magnetic main track on' : 'Magnetic main track off';
  if (prev.settings !== next.settings) return 'Project settings';
  if (prev.name !== next.name) return 'Rename project';
  if (prev.assets !== next.assets) {
    return Object.keys(next.assets).length >= Object.keys(prev.assets).length ? 'Import media' : 'Remove media';
  }
  if (prev.inPoint !== next.inPoint || prev.outPoint !== next.outPoint) return 'Set in / out';
  return capital('edit');
}
