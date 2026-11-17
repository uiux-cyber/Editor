/**
 * Content registries. Packs are discovered by folder: every `*.ts` file in a pack folder
 * default-exports an array of definitions. Adding content never requires touching this file.
 * Content packs and user templates join the same registries at runtime (`registerContent`).
 */

import type {
  AnimationDef,
  EffectDef,
  FilterDef,
  FontPair,
  GeneratorDef,
  Palette,
  SoundDef,
  StickerDef,
  TemplateDef,
  TextAnimDef,
  TextPresetDef,
  TransitionDef,
} from './types';

type Mod<T> = Record<string, T[] | undefined>;

function collect<T extends { id: string }>(mods: Mod<T>, label: string): { list: T[]; map: Map<string, T> } {
  const list: T[] = [];
  const map = new Map<string, T>();
  for (const file of Object.keys(mods).sort()) {
    const items = mods[file];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item.id !== 'string') continue;
      if (map.has(item.id)) {
        console.warn(`[library] duplicate ${label} id "${item.id}" in ${file} ignored`);
        continue;
      }
      map.set(item.id, item);
      list.push(item);
    }
  }
  return { list, map };
}


const transitions = collect(import.meta.glob('./transitions/*.ts', { eager: true, import: 'default' }) as Mod<TransitionDef>, 'transition');
const effects = collect(import.meta.glob('./effects/*.ts', { eager: true, import: 'default' }) as Mod<EffectDef>, 'effect');
const generators = collect(import.meta.glob('./generators/*.ts', { eager: true, import: 'default' }) as Mod<GeneratorDef>, 'generator');
const filters = collect(import.meta.glob('./filters/*.ts', { eager: true, import: 'default' }) as Mod<FilterDef>, 'filter');
const animations = collect(import.meta.glob('./animations/*.ts', { eager: true, import: 'default' }) as Mod<AnimationDef>, 'animation');
const textAnimations = collect(import.meta.glob('./textAnimations/*.ts', { eager: true, import: 'default' }) as Mod<TextAnimDef>, 'text animation');
const textPresets = collect(import.meta.glob('./textPresets/*.ts', { eager: true, import: 'default' }) as Mod<TextPresetDef>, 'text preset');
const stickers = collect(import.meta.glob('./stickers/*.ts', { eager: true, import: 'default' }) as Mod<StickerDef>, 'sticker');
const sounds = collect(import.meta.glob('./sounds/*.ts', { eager: true, import: 'default' }) as Mod<SoundDef>, 'sound');
const templates = collect(import.meta.glob('./templates/*.ts', { eager: true, import: 'default' }) as Mod<TemplateDef>, 'template');
const palettes = collect(import.meta.glob('./palettes/*.ts', { eager: true, import: 'default' }) as Mod<Palette>, 'palette');
const fontPairs = collect(import.meta.glob('./fontPairs/*.ts', { eager: true, import: 'default' }) as Mod<FontPair>, 'font pair');

export const TRANSITIONS = transitions.list;
export const EFFECTS = effects.list;
export const GENERATORS = generators.list;
export const FILTERS = filters.list;
export const ANIMATIONS = animations.list;
export const TEXT_ANIMATIONS = textAnimations.list;
export const TEXT_PRESETS = textPresets.list;
export const STICKERS = stickers.list;
export const SOUNDS = sounds.list;
export const TEMPLATES = templates.list;
export const PALETTES = palettes.list;
export const FONT_PAIRS = fontPairs.list;

export const getTransition = (id: string): TransitionDef | undefined => transitions.map.get(id);
export const getEffect = (id: string): EffectDef | undefined => effects.map.get(id);
export const getGenerator = (id: string): GeneratorDef | undefined => generators.map.get(id);
export const getFilter = (id: string): FilterDef | undefined => filters.map.get(id);
export const getAnimation = (id: string): AnimationDef | undefined => animations.map.get(id);
export const getTextAnimation = (id: string): TextAnimDef | undefined => textAnimations.map.get(id);
export const getTextPreset = (id: string): TextPresetDef | undefined => textPresets.map.get(id);
export const getSticker = (id: string): StickerDef | undefined => stickers.map.get(id);
export const getSound = (id: string): SoundDef | undefined => sounds.map.get(id);
export const getTemplate = (id: string): TemplateDef | undefined => templates.map.get(id);
export const getPalette = (id: string): Palette | undefined => palettes.map.get(id);
export const getFontPair = (id: string): FontPair | undefined => fontPairs.map.get(id);

export const LIBRARY_COUNTS = {
  transitions: TRANSITIONS.length,
  effects: EFFECTS.length,
  generators: GENERATORS.length,
  filters: FILTERS.length,
  animations: ANIMATIONS.length,
  textAnimations: TEXT_ANIMATIONS.length,
  textPresets: TEXT_PRESETS.length,
  stickers: STICKERS.length,
  sounds: SOUNDS.length,
  templates: TEMPLATES.length,
  palettes: PALETTES.length,
  fontPairs: FONT_PAIRS.length,
};

// ---------------------------------------------------------------------------------------------
// Runtime registration (content packs, user templates)
// ---------------------------------------------------------------------------------------------
// Items registered here join the same exported arrays and getters as the built-in content, so
// every gallery, the compositor and the template engine see them. The arrays are mutated in
// place (their identity never changes) and listeners are told so galleries can refresh.

/** Content that can be added while the app runs. */
export interface RuntimeContent {
  transitions?: TransitionDef[];
  effects?: EffectDef[];
  generators?: GeneratorDef[];
  filters?: FilterDef[];
  textPresets?: TextPresetDef[];
  palettes?: Palette[];
  fontPairs?: FontPair[];
  templates?: TemplateDef[];
}

export type RuntimeKind = keyof RuntimeContent;

type AnyRegistry = { list: { id: string }[]; map: Map<string, { id: string }> };
const runtimeRegistries: Record<RuntimeKind, AnyRegistry> = {
  transitions,
  effects,
  generators,
  filters,
  textPresets,
  palettes,
  fontPairs,
  templates,
};

/** `kind:id` → source, for runtime-registered items only (built-ins are absent). */
const runtimeSources = new Map<string, string>();
const srcKey = (kind: RuntimeKind, id: string): string => `${kind}:${id}`;

let libraryVersion = 0;
const libraryListeners = new Set<() => void>();

function libraryChanged(): void {
  libraryVersion++;
  LIBRARY_COUNTS.transitions = TRANSITIONS.length;
  LIBRARY_COUNTS.effects = EFFECTS.length;
  LIBRARY_COUNTS.generators = GENERATORS.length;
  LIBRARY_COUNTS.filters = FILTERS.length;
  LIBRARY_COUNTS.textPresets = TEXT_PRESETS.length;
  LIBRARY_COUNTS.templates = TEMPLATES.length;
  LIBRARY_COUNTS.palettes = PALETTES.length;
  LIBRARY_COUNTS.fontPairs = FONT_PAIRS.length;
  libraryListeners.forEach((cb) => cb());
}

/** Bumped on every runtime registration change. */
export const getLibraryVersion = (): number => libraryVersion;

/** Subscribe to runtime registration changes. Returns an unsubscribe function. */
export function onLibraryChange(cb: () => void): () => void {
  libraryListeners.add(cb);
  return () => libraryListeners.delete(cb);
}

/** True when an id is already used by a built-in or registered item of that kind. */
export const hasLibraryId = (kind: RuntimeKind, id: string): boolean => runtimeRegistries[kind].map.has(id);

/** Owner of a runtime-registered item (e.g. `pack:my-pack`, `user`); undefined for built-ins. */
export const librarySource = (kind: RuntimeKind, id: string): string | undefined => runtimeSources.get(srcKey(kind, id));

export interface Registration {
  /** Items added, per kind. */
  added: { kind: RuntimeKind; id: string }[];
  /** Items skipped because their id is already taken. */
  skipped: { kind: RuntimeKind; id: string }[];
  /** Remove everything this registration added (idempotent). */
  unregister: () => void;
}

/**
 * Register content at runtime. `source` names the owner (`pack:<id>`, `user`…). Items whose id is
 * already taken are skipped, never replaced. Returns what was added and a function removing it.
 */
export function registerContent(source: string, content: RuntimeContent): Registration {
  const added: Registration['added'] = [];
  const skipped: Registration['skipped'] = [];
  for (const kind of Object.keys(runtimeRegistries) as RuntimeKind[]) {
    const reg = runtimeRegistries[kind];
    for (const item of (content[kind] ?? []) as { id: string }[]) {
      if (!item || typeof item.id !== 'string' || reg.map.has(item.id)) {
        skipped.push({ kind, id: String(item?.id) });
        continue;
      }
      reg.map.set(item.id, item);
      reg.list.push(item);
      runtimeSources.set(srcKey(kind, item.id), source);
      added.push({ kind, id: item.id });
    }
  }
  if (added.length) libraryChanged();
  let done = false;
  return {
    added,
    skipped,
    unregister: () => {
      if (done) return;
      done = true;
      for (const { kind, id } of added) {
        const reg = runtimeRegistries[kind];
        const item = reg.map.get(id);
        if (!item || runtimeSources.get(srcKey(kind, id)) !== source) continue;
        reg.map.delete(id);
        const i = reg.list.indexOf(item);
        if (i >= 0) reg.list.splice(i, 1);
        runtimeSources.delete(srcKey(kind, id));
      }
      if (added.length) libraryChanged();
    },
  };
}
