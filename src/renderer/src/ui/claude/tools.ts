/**
 * Claude's tools, run on the open project. Definitions (names, descriptions, input schemas) are
 * in src/shared/claude.ts; the main process forwards calls here (see ./store.ts).
 *
 * Every edit goes through the normal editor actions, so it is one undo step; the history entry is
 * prefixed "Claude: ". Files on disk are only written after the main process approved the path,
 * and replacing an existing file needs the user's approval first.
 */

import { captionTracks } from '@/core/captions';
import { projectDuration } from '@/core/project';
import { getAudioClips } from '@/core/scene';
import { maxDurationFor } from '@/core/timemap';
import type { Clip, ID, MediaAsset, Project } from '@/core/types';
import { engine, usePlayback } from '@/engine/engine';
import { enqueue, useExportQueue } from '@/engine/export/queue';
import { defaultRangeMode, resolveRange, type RangeMode } from '@/engine/export/range';
import { defaultCustom, outputName, planTarget, type CustomSettings, type ExportOptions, type PlannedTarget } from '@/engine/export/targets';
import { EFFECTS, FILTERS, GENERATORS, SOUNDS, STICKERS, TEMPLATES, TEXT_PRESETS, TRANSITIONS, getEffect, getFilter, getGenerator, getSound, getSticker, getTemplate, getTextPreset, getTransition } from '@/library';
import { variationFor } from '@/library/templateEngine';
import { api } from '@/platform/api';
import { getProject, getRootProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { useVision } from '@/vision/store';
import { ASPECT_IDS, LIBRARY_KINDS, textResult, type ToolContent, type ToolResult } from '@shared/claude';
import type { FileInfo } from '@shared/ipc';
import { addAsset, addGenerator, addSound, addSticker, addText, addTransition, applyEffect, applyFilter, deleteSelection, editClips, redo, setSpeed, splitClip, undo } from '../actions';
import { getCommand, getCommands, runCommand } from '../commands';
import { shortcutText } from '../commands/keymapStore';
import { importFiles } from '../library/MediaTab';
import { newProject, openProject, saveProject } from '../projectIO';
import { t } from '../i18n';
import { getSetting } from '../settings/store';
import { useSpeech } from '../speech/store';
import { applyTemplateVariation } from '../templates/apply';
import { requestApproval } from './store';

type Args = Record<string, unknown>;

class ToolError extends Error {}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

// ---- argument helpers -------------------------------------------------------------------------

const str = (a: Args, key: string, required = false): string | undefined => {
  const v = a[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new ToolError(`"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ToolError(`"${key}" must be a string.`);
  return v;
};
const num = (a: Args, key: string, required = false): number | undefined => {
  const v = a[key];
  if (v === undefined || v === null) {
    if (required) throw new ToolError(`"${key}" is required.`);
    return undefined;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ToolError(`"${key}" must be a number.`);
  return n;
};
const bool = (a: Args, key: string): boolean | undefined => (a[key] === undefined ? undefined : a[key] === true || a[key] === 'true');
const strList = (a: Args, key: string): string[] => {
  const v = a[key];
  if (!Array.isArray(v)) throw new ToolError(`"${key}" must be a list.`);
  return v.map(String);
};

function requireEditor(): void {
  if (useUI.getState().screen !== 'editor') throw new ToolError('No project is open in Kinora. Use new_project or open_project first.');
}

function clipOr404(id: string): Clip {
  const clip = getProject().clips[id];
  if (!clip) throw new ToolError(`No clip with id "${id}". Use get_project to see the clips.`);
  return clip;
}

/** Run an edit and label its history steps "Claude: …". */
async function asClaude<T>(fn: () => T | Promise<T>): Promise<T> {
  const before = useProjectStore.getState();
  const startLen = before.pastMeta.length;
  const lastBefore = before.pastMeta[startLen - 1];
  const out = await fn();
  const s = useProjectStore.getState();
  const meta = s.pastMeta.slice();
  let first = meta.length === startLen && meta[startLen - 1] !== lastBefore ? meta.length - 1 : startLen;
  if (meta.length < startLen) first = meta.length;
  let changed = false;
  for (let i = Math.max(0, first); i < meta.length; i++) {
    if (!meta[i].label.startsWith('Claude: ')) {
      meta[i] = { ...meta[i], label: `Claude: ${meta[i].label}` };
      changed = true;
    }
  }
  if (changed) useProjectStore.setState({ pastMeta: meta });
  return out;
}

// ---- descriptions -----------------------------------------------------------------------------

function clipInfo(c: Clip, p: Project): Record<string, unknown> {
  const info: Record<string, unknown> = { id: c.id, type: c.type, track: c.trackId, start: r3(c.start), duration: r3(c.duration), end: r3(c.start + c.duration), name: c.name };
  if (c.groupId) info.group = c.groupId;
  if (c.linkId) info.link = c.linkId;
  if (c.type === 'video' || c.type === 'audio') {
    info.media = c.assetId;
    info.media_name = p.assets[c.assetId]?.name;
    info.source_in = r3(c.trimIn);
    if (c.speed !== 1) info.speed = c.speed;
    if (c.reverse) info.reverse = true;
    if (c.freeze) info.freeze = true;
  }
  if (c.type === 'image') {
    info.media = c.assetId;
    info.media_name = p.assets[c.assetId]?.name;
  }
  if (c.type === 'video' || c.type === 'audio' || c.type === 'compound') {
    if (c.volume !== 1) info.volume = r3(c.volume);
    if (c.muted) info.muted = true;
  }
  if (c.type === 'text') {
    info.text = c.text.content;
    info.font_size = c.text.fontSize;
    if (c.text.fill.type === 'solid') info.color = c.text.fill.color;
    if (c.caption) info.caption = true;
  }
  if (c.type === 'sticker') info.sticker = c.stickerId;
  if (c.type === 'generator') info.background = c.generatorId;
  if (c.type === 'shape') info.shape = c.shape.kind;
  if (c.type === 'compound') info.nested_clips = Object.keys(c.sequence.clips).length;
  if (c.type !== 'audio') {
    const t = c.transform;
    if (t.opacity !== 1) info.opacity = r3(t.opacity);
    if (t.x || t.y) info.position = { x: r3(t.x), y: r3(t.y) };
    if (t.scaleX !== 1 || t.scaleY !== 1) info.scale = t.scaleX === t.scaleY ? r3(t.scaleX) : { x: r3(t.scaleX), y: r3(t.scaleY) };
    if (t.rotation) info.rotation = r3(t.rotation);
    if (c.filter) info.filter = c.filter.id;
    if (c.effects.length) info.effects = c.effects.map((e) => e.effectId);
  }
  return info;
}

const mediaInfo = (a: MediaAsset, withPath: boolean): Record<string, unknown> => ({
  id: a.id,
  name: a.name,
  kind: a.kind,
  duration: r3(a.duration),
  ...(a.width ? { width: a.width, height: a.height } : {}),
  ...(withPath && a.source.type === 'file' ? { path: a.source.path } : {}),
});

const MAX_CLIPS = 600;

function getProjectInfo(args: Args): ToolResult {
  requireEditor();
  const p = getProject();
  const store = useProjectStore.getState();
  const clips = Object.values(p.clips).sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId));
  return textResult({
    name: p.name,
    file: store.filePath,
    unsaved: store.root !== store.savedRef,
    ...(store.editPath.length ? { editing_compound_clip: store.editPath[store.editPath.length - 1] } : {}),
    settings: { width: p.settings.width, height: p.settings.height, fps: p.settings.fps, background: p.settings.background },
    duration: r3(projectDuration(p)),
    tracks_top_to_bottom: p.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, ...(t.role ? { role: t.role } : {}), ...(t.muted ? { muted: true } : {}), ...(t.hidden ? { hidden: true } : {}), ...(t.locked ? { locked: true } : {}) })),
    clips: clips.slice(0, MAX_CLIPS).map((c) => clipInfo(c, p)),
    ...(clips.length > MAX_CLIPS ? { clips_not_shown: clips.length - MAX_CLIPS } : {}),
    transitions: Object.values(p.transitions).map((t) => ({ id: t.id, type: t.type, duration: r3(t.duration), from: t.fromId, to: t.toId })),
    media: Object.values(p.assets).map((a) => mediaInfo(a, bool(args, 'include_media_paths') !== false)),
    markers: (p.markers ?? []).map((m) => ({ time: r3(m.time), label: m.label })),
    ...(p.inPoint !== undefined ? { in_point: r3(p.inPoint) } : {}),
    ...(p.outPoint !== undefined ? { out_point: r3(p.outPoint) } : {}),
  });
}

function tasks(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const speech = useSpeech.getState().job;
  if (speech) out.push({ kind: 'speech', label: speech.label, progress: speech.ratio < 0 ? null : r3(speech.ratio) });
  for (const j of Object.values(useVision.getState().jobs)) out.push({ kind: 'vision', label: j.label, progress: j.progress < 0 ? null : r3(j.progress) });
  for (const j of useExportQueue.getState().jobs.slice(-12)) {
    out.push({
      kind: 'export',
      id: j.id,
      label: j.label,
      status: j.status,
      progress: j.progress ? r3(j.progress.ratio) : j.status === 'done' ? 1 : null,
      output: j.output.path,
      ...(j.error ? { error: j.error } : {}),
    });
  }
  return out;
}

function statusInfo(): Record<string, unknown> {
  const ui = useUI.getState();
  const store = useProjectStore.getState();
  const editor = ui.screen === 'editor';
  return {
    screen: ui.screen,
    ...(editor ? { project: store.project.name, duration: r3(projectDuration(store.project)), playhead: r3(engine.time), playing: usePlayback.getState().playing, selection: ui.selection } : {}),
    tasks: tasks(),
    ...(editor ? { recent_changes: store.pastMeta.slice(-8).map((m) => m.label), can_undo: store.past.length > 0, can_redo: store.future.length > 0 } : {}),
  };
}

// ---- library ----------------------------------------------------------------------------------

interface LibItem {
  id: string;
  name: string;
  category?: string;
  words: string;
  extra?: Record<string, unknown>;
}

function libraryItems(kind: (typeof LIBRARY_KINDS)[number]): LibItem[] {
  const item = (d: { id: string; name: string; category?: string }, words: string[] = [], extra?: Record<string, unknown>): LibItem => ({
    id: d.id,
    name: d.name,
    category: d.category,
    words: [d.id, d.name, d.category ?? '', ...words].join(' ').toLowerCase(),
    extra,
  });
  switch (kind) {
    case 'templates':
      return TEMPLATES.map((d) => item(d, d.tags, { duration: d.duration, ...(d.aspects ? { aspects: d.aspects } : {}), ...(d.music ? { music: true } : {}) }));
    case 'text_styles':
      return TEXT_PRESETS.map((d) => item(d));
    case 'stickers':
      return STICKERS.map((d) => item(d, d.keywords));
    case 'sounds':
      return SOUNDS.map((d) => item(d, d.keywords));
    case 'backgrounds':
      return GENERATORS.map((d) => item(d));
    case 'transitions':
      return TRANSITIONS.map((d) => item(d));
    case 'effects':
      return EFFECTS.map((d) => item(d));
    case 'filters':
      return FILTERS.map((d) => item(d));
  }
}

function searchLibrary(args: Args): ToolResult {
  const kind = str(args, 'kind', true) as (typeof LIBRARY_KINDS)[number];
  if (!LIBRARY_KINDS.includes(kind)) throw new ToolError(`"kind" must be one of ${LIBRARY_KINDS.join(', ')}.`);
  const words = (str(args, 'query') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.min(100, Math.max(1, Math.round(num(args, 'limit') ?? 30)));
  const all = libraryItems(kind);
  const hits = words.length ? all.filter((i) => words.every((w) => i.words.includes(w))) : all;
  return textResult({
    kind,
    matches: hits.length,
    results: hits.slice(0, limit).map((i) => ({ id: i.id, name: i.name, ...(i.category ? { category: i.category } : {}), ...(i.extra ?? {}) })),
  });
}

// ---- commands ---------------------------------------------------------------------------------

function listCommands(args: Args): ToolResult {
  const words = (str(args, 'query') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const list = getCommands()
    .filter((c) => !words.length || words.every((w) => `${c.id} ${c.title} ${c.group} ${(c.keywords ?? []).join(' ')}`.toLowerCase().includes(w)))
    .map((c) => {
      let enabled = true;
      try {
        enabled = !c.when || c.when();
      } catch {
        enabled = false;
      }
      const shortcut = shortcutText(c.id);
      return { id: c.id, title: c.title, group: c.group, enabled, ...(c.checked ? { on: c.checked() } : {}), ...(shortcut ? { shortcut } : {}) };
    });
  return textResult({ commands: list });
}

async function runCommandTool(args: Args): Promise<ToolResult> {
  const id = str(args, 'id', true)!;
  const cmd = getCommand(id);
  if (!cmd) {
    const near = getCommands()
      .filter((c) => c.id.includes(id) || id.includes(c.id) || c.title.toLowerCase().includes(id.toLowerCase()))
      .slice(0, 8)
      .map((c) => c.id);
    throw new ToolError(`No command "${id}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ' Use list_commands.'}`);
  }
  if (cmd.when && !cmd.when()) throw new ToolError(`"${cmd.title}" can't run right now (it may need a selection, an open project or a clip under the playhead).`);
  await asClaude(async () => {
    runCommand(id);
    await sleep(80);
  });
  return textResult({ ran: id, title: cmd.title, status: statusInfo() });
}

// ---- projects ---------------------------------------------------------------------------------

const ASPECT_SIZES: Record<(typeof ASPECT_IDS)[number], [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '21:9': [2560, 1080] };

async function newProjectTool(args: Args): Promise<ToolResult> {
  const aspect = (str(args, 'aspect') ?? '16:9') as (typeof ASPECT_IDS)[number];
  if (!ASPECT_SIZES[aspect]) throw new ToolError(`"aspect" must be one of ${ASPECT_IDS.join(', ')}.`);
  const fps = num(args, 'fps') ?? (await getSetting<number>('general.defaultFps', 30));
  const [width, height] = ASPECT_SIZES[aspect];
  const ok = await newProject({ name: str(args, 'name'), width, height, fps });
  if (!ok) throw new ToolError('The user chose to keep the current project.');
  return textResult({ created: true, status: statusInfo() });
}

async function openProjectTool(args: Args): Promise<ToolResult> {
  const path = await api.call<string>('x:claude:approveProject', str(args, 'path', true));
  const ok = await openProject(path);
  if (!ok) throw new ToolError('The project was not opened (the user kept the current project, or the file could not be read).');
  return textResult({ opened: path, status: statusInfo() });
}

/** Check an output path and get the user's approval to replace an existing file. */
async function approveOutput(path: string, exts: string[], what: string): Promise<string> {
  const checked = await api.call<{ path: string; exists: boolean }>('x:claude:checkOutput', path, exts);
  if (checked.exists) {
    const ok = await requestApproval({ kind: 'replace', path: checked.path, what });
    if (!ok) throw new ToolError(`The user did not allow replacing ${checked.path}. Choose another file name.`);
  }
  await api.call('x:claude:approveOutput', checked.path);
  return checked.path;
}

async function saveProjectTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const target = str(args, 'path');
  const current = useProjectStore.getState().filePath;
  let ok: boolean;
  if (target) {
    const same = current && current.toLowerCase() === target.toLowerCase();
    const path = same ? current! : await approveOutput(target, ['kinora'], 'the project');
    ok = await saveProject(false, path);
  } else {
    if (!current) throw new ToolError('This project has not been saved yet: pass "path" (an absolute path ending in .kinora).');
    ok = await saveProject();
  }
  if (!ok) throw new ToolError('Kinora could not save the project.');
  return textResult({ saved: useProjectStore.getState().filePath });
}

// ---- media and timeline -----------------------------------------------------------------------

async function importMediaTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const { files, problems } = await api.call<{ files: FileInfo[]; problems: string[] }>('x:claude:approveMedia', strList(args, 'paths'));
  const assets = files.length ? await importFiles(files) : [];
  const clips: ID[] = [];
  if (bool(args, 'add_to_timeline') && assets.length) {
    await asClaude(() => {
      for (const asset of assets) clips.push(...addAsset(asset, { time: projectDuration(getProject()) }));
    });
  }
  return textResult({
    imported: assets.map((a) => mediaInfo(a, false)),
    ...(clips.length ? { clips_added: clips } : {}),
    ...(problems.length || files.length > assets.length ? { problems: [...problems, ...(files.length > assets.length ? [`${files.length - assets.length} file(s) could not be imported (see the message in Kinora).`] : [])] } : {}),
  });
}

async function addItemTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const kind = str(args, 'kind', true)!;
  const id = str(args, 'id');
  const time = num(args, 'time');
  const duration = num(args, 'duration');
  const where = { time: time ?? engine.time, trackId: str(args, 'track_id') };
  if (where.trackId && !getProject().tracks.some((t) => t.id === where.trackId)) throw new ToolError(`No track "${where.trackId}".`);
  const need = (what: string): string => {
    if (!id) throw new ToolError(`"id" is required for ${what}.`);
    return id;
  };
  let ids: ID[] = [];
  await asClaude(async () => {
    switch (kind) {
      case 'media': {
        const asset = getProject().assets[need('media')];
        if (!asset) throw new ToolError(`No media with id "${id}". Use get_project (media) or import_media.`);
        ids = addAsset(asset, where);
        break;
      }
      case 'template': {
        const def = getTemplate(need('templates'));
        if (!def) throw new ToolError(`No template "${id}". Use search_library with kind "templates".`);
        const v = variationFor(def, Math.max(0, Math.round(num(args, 'variant') ?? 0)), bool(args, 'use_brand') === true);
        ids = await applyTemplateVariation(v, { time: where.time }).done;
        break;
      }
      case 'text': {
        if (id && !getTextPreset(id)) throw new ToolError(`No text style "${id}". Use search_library with kind "text_styles".`);
        ids = addText(id ?? null, where);
        const text = str(args, 'text');
        if (text && ids.length) {
          editClips(ids, (c) => {
            if (c.type !== 'text') return;
            c.text.content = text;
            c.name = text.split('\n')[0].slice(0, 40) || c.name;
          });
        }
        break;
      }
      case 'sticker':
        if (!getSticker(need('stickers'))) throw new ToolError(`No sticker "${id}". Use search_library with kind "stickers".`);
        ids = addSticker(id!, where);
        break;
      case 'sound':
        if (!getSound(need('sounds'))) throw new ToolError(`No sound "${id}". Use search_library with kind "sounds".`);
        ids = await addSound(id!, where);
        break;
      case 'background':
        if (!getGenerator(need('backgrounds'))) throw new ToolError(`No background "${id}". Use search_library with kind "backgrounds".`);
        ids = addGenerator(id!, where);
        break;
      default:
        throw new ToolError('"kind" must be media, template, text, sticker, sound or background.');
    }
    if (duration && ids.length && kind !== 'template' && kind !== 'media' && kind !== 'sound') {
      editClips(ids, (c) => {
        c.duration = duration;
      });
    }
  });
  if (!ids.length) throw new ToolError('Nothing was added (no free place on the timeline?).');
  const p = getProject();
  return textResult({ added: ids.filter((i) => p.clips[i]).map((i) => clipInfo(p.clips[i], p)) });
}

async function applyToClipTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const kind = str(args, 'kind', true)!;
  const id = str(args, 'id', true)!;
  const clip = clipOr404(str(args, 'clip_id', true)!);
  await asClaude(() => {
    if (kind === 'effect') {
      if (!getEffect(id)) throw new ToolError(`No effect "${id}". Use search_library with kind "effects".`);
      if (clip.type === 'audio') throw new ToolError('Effects apply to visual clips.');
      applyEffect(id, clip.id);
    } else if (kind === 'filter') {
      if (id !== 'none' && !getFilter(id)) throw new ToolError(`No filter "${id}". Use search_library with kind "filters".`);
      if (clip.type === 'audio') throw new ToolError('Filters apply to visual clips.');
      applyFilter(id === 'none' ? null : id, clip.id);
    } else if (kind === 'transition') {
      if (!getTransition(id)) throw new ToolError(`No transition "${id}". Use search_library with kind "transitions".`);
      const p = getProject();
      const end = clip.start + clip.duration;
      const tol = 1.5 / p.settings.fps;
      const next = Object.values(p.clips).find((c) => c.trackId === clip.trackId && c.id !== clip.id && Math.abs(c.start - end) <= tol);
      if (!next) throw new ToolError('A transition needs another clip starting right where this one ends, on the same track.');
      if (!addTransition(id, clip.id, next.id)) throw new ToolError('Kinora could not add a transition at this cut.');
    } else throw new ToolError('"kind" must be effect, filter or transition.');
  });
  const p = getProject();
  return textResult({ clip: clipInfo(p.clips[clip.id] ?? clip, p) });
}

async function updateClipTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const clip = clipOr404(str(args, 'clip_id', true)!);
  const p = getProject();
  const start = num(args, 'start');
  let duration = num(args, 'duration');
  const speed = num(args, 'speed');
  if (speed !== undefined && clip.type !== 'video' && clip.type !== 'audio') throw new ToolError('Speed applies to video and audio clips.');
  if (duration !== undefined && (clip.type === 'video' || clip.type === 'audio')) duration = Math.min(duration, maxDurationFor(clip, p.assets));
  // Keep clips on a track from overlapping.
  const newStart = start ?? clip.start;
  const newEnd = newStart + (duration ?? clip.duration);
  if (start !== undefined || duration !== undefined) {
    const hit = Object.values(p.clips).find((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start < newEnd - 1e-6 && c.start + c.duration > newStart + 1e-6);
    if (hit) throw new ToolError(`That would overlap clip "${hit.name}" (${hit.id}) on the same track. Move it first, or use another time.`);
  }
  await asClaude(() => {
    if (speed !== undefined) setSpeed([clip.id], speed);
    editClips([clip.id], (c) => {
      if (start !== undefined) c.start = Math.max(0, start);
      if (duration !== undefined) c.duration = duration;
      const name = str(args, 'name');
      if (name) c.name = name;
      if (c.type === 'text') {
        const text = str(args, 'text');
        if (text !== undefined) c.text.content = text;
        const size = num(args, 'font_size');
        if (size) c.text.fontSize = size;
        const color = str(args, 'color');
        if (color) c.text.fill = { type: 'solid', color };
      }
      if (c.type === 'video' || c.type === 'audio' || c.type === 'compound') {
        const volume = num(args, 'volume');
        if (volume !== undefined) c.volume = Math.max(0, Math.min(4, volume));
        const muted = bool(args, 'muted');
        if (muted !== undefined) c.muted = muted;
      }
      if (c.type !== 'audio') {
        const t = c.transform;
        const opacity = num(args, 'opacity');
        if (opacity !== undefined) t.opacity = Math.max(0, Math.min(1, opacity));
        const x = num(args, 'x');
        if (x !== undefined) t.x = x;
        const y = num(args, 'y');
        if (y !== undefined) t.y = y;
        const scale = num(args, 'scale');
        if (scale) t.scaleX = t.scaleY = scale;
        const rotation = num(args, 'rotation');
        if (rotation !== undefined) t.rotation = rotation;
      }
    });
  });
  const after = getProject();
  return textResult({ clip: clipInfo(after.clips[clip.id] ?? clip, after) });
}

async function deleteClipsTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const ids = strList(args, 'clip_ids');
  for (const id of ids) clipOr404(id);
  await asClaude(() => {
    useUI.getState().select(ids);
    deleteSelection(bool(args, 'close_gap') === true);
  });
  return textResult({ deleted: ids.filter((id) => !getProject().clips[id]) });
}

async function splitClipTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const clip = clipOr404(str(args, 'clip_id', true)!);
  const time = num(args, 'time', true)!;
  if (time <= clip.start + 1e-3 || time >= clip.start + clip.duration - 1e-3) throw new ToolError(`The time must be inside the clip (${r3(clip.start)}–${r3(clip.start + clip.duration)} s).`);
  const before = new Set(Object.keys(getProject().clips));
  await asClaude(() => splitClip(clip.id, time));
  const p = getProject();
  return textResult({ clips: [clip.id, ...Object.keys(p.clips).filter((id) => !before.has(id))].filter((id) => p.clips[id]).map((id) => clipInfo(p.clips[id], p)) });
}

function selectClipsTool(args: Args): ToolResult {
  requireEditor();
  const ids = Array.isArray(args.clip_ids) ? args.clip_ids.map(String) : [];
  for (const id of ids) clipOr404(id);
  useUI.getState().select(ids);
  return textResult({ selection: useUI.getState().selection });
}

function setPlayheadTool(args: Args): ToolResult {
  requireEditor();
  const time = Math.max(0, Math.min(num(args, 'time', true)!, projectDuration(getProject())));
  engine.seek(time);
  return textResult({ playhead: r3(engine.time) });
}

// ---- frames -----------------------------------------------------------------------------------

/** Wait until the preview stops redrawing (new video frames decoded), at most `max` ms. */
function settle(max = 2500, quiet = 250): Promise<void> {
  return new Promise((resolve) => {
    let quietTimer = setTimeout(done, quiet);
    const hardTimer = setTimeout(done, max);
    const off = engine.onRendered(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(done, quiet);
    });
    function done(): void {
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      off();
      resolve();
    }
  });
}

async function captureFrameTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const time = num(args, 'time');
  if (time !== undefined) {
    engine.seek(Math.max(0, Math.min(time, projectDuration(getProject()))));
  }
  await settle();
  const blob = await engine.snapshot();
  if (!blob) throw new ToolError('The preview is not available right now.');
  const bitmap = await createImageBitmap(blob);
  const want = Math.min(1600, Math.max(160, Math.round(num(args, 'width') ?? 960)));
  const k = Math.min(1, want / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  const content: ToolContent[] = [
    { type: 'image', data, mimeType: 'image/jpeg' },
    { type: 'text', text: `Frame at ${r3(engine.time)} s (${canvas.width} × ${canvas.height}, project ${getProject().settings.width} × ${getProject().settings.height}).` },
  ];
  return { content };
}

// ---- export -----------------------------------------------------------------------------------

const PRESET_IDS = ['youtube-1080p', 'youtube-4k', 'youtube-shorts', 'tiktok', 'instagram-reels', 'instagram-portrait', 'instagram-square', 'facebook', 'linkedin'];
const FORMAT_IDS = ['mp4-avc', 'mp4-hevc', 'mp4-av1', 'webm-vp9', 'mov-avc', 'webm-alpha', 'gif', 'mp3', 'wav', 'png'];

async function exportTool(args: Args): Promise<ToolResult> {
  requireEditor();
  const p = getRootProject();
  const presets = args.presets === undefined ? [] : strList(args, 'presets');
  for (const k of presets) if (!PRESET_IDS.includes(k)) throw new ToolError(`Unknown preset "${k}". Presets: ${PRESET_IDS.join(', ')}.`);
  const format = str(args, 'format') ?? 'mp4-avc';
  if (!FORMAT_IDS.includes(format)) throw new ToolError(`Unknown format "${format}".`);
  const aspect = (str(args, 'aspect') ?? 'source') as CustomSettings['aspect'];
  const mode = (str(args, 'range') ?? defaultRangeMode(p)) as RangeMode;
  const range = resolveRange(p, mode, useUI.getState().selection);
  if (format !== 'png' && !range.valid) throw new ToolError(range.reason ?? 'Nothing to export in that range.');
  const hasCaptions = captionTracks(p).length > 0;
  const opts: ExportOptions = {
    range: { start: range.start, end: range.end },
    time: engine.time,
    audio: getAudioClips(p).length > 0,
    burnInCaptions: bool(args, 'burn_in_captions') !== false || !hasCaptions,
    sidecars: [],
    embedSubtitles: false,
  };
  const custom: CustomSettings = { ...defaultCustom(p), formatId: format, aspect, transparent: format === 'webm-alpha' };
  const plans = (presets.length ? presets.map((k) => planTarget(p, k, defaultCustom(p), opts)) : [planTarget(p, 'custom', custom, opts)]).filter((t): t is PlannedTarget => !!t && t.kind === 'file');
  if (!plans.length) throw new ToolError('Nothing to export with these settings.');

  let outputs: string[];
  const path = str(args, 'path');
  const folder = str(args, 'folder');
  if (plans.length === 1 && path) {
    outputs = [await approveOutput(path, [plans[0].ext], 'the export')];
  } else {
    if (!folder) throw new ToolError(plans.length > 1 ? 'Several presets need "folder" (one file each is created there).' : 'Pass "path" (the output file) or "folder".');
    outputs = await api.call<string[]>(
      'x:claude:filesInFolder',
      folder,
      plans.map((t) => outputName(p.name, t, plans.length > 1)),
    );
  }
  const ids = enqueue(
    plans.map((t, i) => ({ label: t.label, detail: t.detail, aspect: t.aspect, output: { path: outputs[i], kind: 'file' as const }, project: t.project, settings: t.settings, weight: t.weight })),
  );
  useUI.getState().toast({ kind: 'info', message: t('{count, plural, one {Claude started an export} other {Claude started # exports}}', { count: plans.length }), detail: t('Follow the progress in the title bar.') });
  return textResult({ started: ids.map((id, i) => ({ job: id, label: plans[i].label, detail: plans[i].detail, output: outputs[i] })), note: 'Exports run in the background: call get_status to follow them.' });
}

// ---- history ----------------------------------------------------------------------------------

function historyTool(dir: 'undo' | 'redo', args: Args): ToolResult {
  requireEditor();
  const steps = Math.min(50, Math.max(1, Math.round(num(args, 'steps') ?? 1)));
  let done = 0;
  for (let i = 0; i < steps; i++) {
    const s = useProjectStore.getState();
    if (dir === 'undo' ? !s.past.length : !s.future.length) break;
    if (dir === 'undo') undo();
    else redo();
    done++;
  }
  if (!done) throw new ToolError(`Nothing to ${dir}.`);
  return textResult({ [dir === 'undo' ? 'undone' : 'redone']: done, recent_changes: useProjectStore.getState().pastMeta.slice(-5).map((m) => m.label) });
}

// ---- dispatch ---------------------------------------------------------------------------------

const TOOLS: Record<string, (args: Args) => ToolResult | Promise<ToolResult>> = {
  get_status: () => textResult(statusInfo()),
  get_project: getProjectInfo,
  list_commands: listCommands,
  run_command: runCommandTool,
  search_library: searchLibrary,
  new_project: newProjectTool,
  open_project: openProjectTool,
  save_project: saveProjectTool,
  import_media: importMediaTool,
  add_item: addItemTool,
  apply_to_clip: applyToClipTool,
  update_clip: updateClipTool,
  delete_clips: deleteClipsTool,
  split_clip: splitClipTool,
  select_clips: selectClipsTool,
  set_playhead: setPlayheadTool,
  capture_frame: captureFrameTool,
  export_video: exportTool,
  undo: (a) => historyTool('undo', a),
  redo: (a) => historyTool('redo', a),
};

export async function runTool(name: string, args: Args): Promise<ToolResult> {
  const fn = TOOLS[name];
  if (!fn) return textResult(`Unknown tool "${name}".`, true);
  try {
    return await fn(args ?? {});
  } catch (err) {
    if (err instanceof ToolError) return textResult(err.message, true);
    console.warn('[claude] tool failed', name, err);
    return textResult(`Kinora could not do that: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}
