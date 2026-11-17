/**
 * What the command palette can find: every registered command plus library content (templates,
 * effects, transitions, filters, text styles, stickers, sounds, animated backgrounds) that is
 * applied / added when picked.
 */

import { designSize } from '@/core/project';
import { EFFECTS, FILTERS, GENERATORS, SOUNDS, STICKERS, TEMPLATES, TEXT_PRESETS, TRANSITIONS } from '@/library';
import { aspectIdFor, supportsAspect, variationPage, type TemplateVariation } from '@/library/templateEngine';
import type { AspectId } from '@/library/types';
import { getProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { addGenerator, addSound, addSticker, addText, addTransition, applyEffect, applyFilter, applyTemplate } from '../actions';
import { getCommands, type Command } from '../commands';
import { t } from '../i18n';
import { labelOf } from '../library/common';
import { newProject } from '../projectIO';
import { getSetting } from '../settings/store';
import type { Rankable } from './fuzzy';

export type EntryKind = 'command' | 'template' | 'effect' | 'transition' | 'filter' | 'text' | 'sticker' | 'sound' | 'background';

export interface PaletteEntry extends Rankable {
  kind: EntryKind;
  title: string;
  /** Secondary text: command group or content category. */
  detail: string;
  commandId?: string;
  checked?: boolean;
  run: () => unknown;
}

export const KIND_LABELS: Record<EntryKind, string> = {
  command: 'Command',
  template: 'Template',
  effect: 'Effect',
  transition: 'Transition',
  filter: 'Filter',
  text: 'Text style',
  sticker: 'Sticker',
  sound: 'Sound',
  background: 'Background',
};

/** Commands available right now (hidden when their `when` says so). */
export function commandEntries(): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const cmd of getCommands()) {
    let enabled = true;
    try {
      enabled = !cmd.when || cmd.when();
    } catch {
      enabled = false;
    }
    if (!enabled) continue;
    out.push(commandEntry(cmd));
  }
  return out;
}

function commandEntry(cmd: Command): PaletteEntry {
  const title = t(cmd.title);
  const group = t(cmd.group);
  const keywords = cmd.keywords ?? [];
  return {
    key: `cmd:${cmd.id}`,
    kind: 'command',
    title,
    detail: group,
    commandId: cmd.id,
    checked: cmd.checked?.(),
    boost: 4,
    fields: [
      { text: title, weight: 1 },
      // English title and keywords stay searchable in every language.
      ...(title !== cmd.title ? [{ text: cmd.title, weight: 0.85 }] : []),
      { text: group, weight: 0.55 },
      ...keywords.map((k) => ({ text: k, weight: 0.7 })),
    ],
    run: () => cmd.run(),
  };
}

const currentAspect = (): AspectId => {
  if (useUI.getState().screen !== 'editor') return '16:9';
  const { cw, ch } = designSize(getProject().settings);
  return aspectIdFor(cw, ch);
};

function templateVariation(templateId: string, aspect: AspectId): TemplateVariation | undefined {
  return variationPage({ aspect, category: 'all' }, 0).find((v) => v.templateId === templateId);
}

let libraryCache: { locale: string; entries: PaletteEntry[] } | null = null;

/** Library content (cached per language). */
export function libraryEntries(locale: string): PaletteEntry[] {
  if (libraryCache?.locale === locale) return libraryCache.entries;
  const entries: PaletteEntry[] = [];
  const add = (kind: EntryKind, id: string, name: string, category: string, extra: string[], run: () => unknown): void => {
    entries.push({
      key: `lib:${kind}:${id}`,
      kind,
      title: name,
      detail: labelOf(category),
      fields: [{ text: name, weight: 1 }, { text: labelOf(category), weight: 0.5 }, { text: t(KIND_LABELS[kind]), weight: 0.45 }, ...extra.map((k) => ({ text: k, weight: 0.4 }))],
      run,
    });
  };
  for (const d of TEMPLATES)
    add('template', d.id, d.name, d.category, d.tags ?? [], async () => {
      const aspect = currentAspect();
      const v = templateVariation(d.id, supportsAspect(d, aspect) ? aspect : '16:9');
      if (!v) return;
      if (useUI.getState().screen === 'editor') applyTemplate(v);
      else await newProject({ width: 1920, height: 1080, fps: await getSetting<number>('general.defaultFps', 30) }, v);
    });
  for (const d of EFFECTS) add('effect', d.id, d.name, d.category, [], () => applyEffect(d.id));
  for (const d of TRANSITIONS) add('transition', d.id, d.name, d.category, [], () => addTransition(d.id));
  for (const d of FILTERS) add('filter', d.id, d.name, d.category, [], () => applyFilter(d.id));
  for (const d of TEXT_PRESETS) add('text', d.id, d.name, d.category, [], () => addText(d.id));
  for (const d of STICKERS) add('sticker', d.id, d.name, d.category, d.keywords ?? [], () => addSticker(d.id));
  for (const d of SOUNDS) add('sound', d.id, d.name, d.category, d.keywords ?? [], () => addSound(d.id));
  for (const d of GENERATORS) add('background', d.id, d.name, d.category, ['animated background', 'generator'], () => addGenerator(d.id));
  libraryCache = { locale, entries };
  return entries;
}

/** Library entries usable on the current screen (only templates start a project from Home). */
export function libraryEntriesFor(locale: string): PaletteEntry[] {
  const all = libraryEntries(locale);
  return useUI.getState().screen === 'editor' ? all : all.filter((e) => e.kind === 'template');
}
