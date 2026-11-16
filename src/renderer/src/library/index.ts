/**
 * Content registries. Packs are discovered by folder: every `*.ts` file in a pack folder
 * default-exports an array of definitions. Adding content never requires touching this file.
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
