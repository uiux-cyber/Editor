/**
 * Applying templates: layers + the media they reference (brand logo, embedded media) + the
 * template's music bed + built-in sounds of user templates, all as ONE undo step.
 *
 * Sounds are synthesised asynchronously (`addSoundAsset`), so a template with sound opens a
 * store transaction: the layers appear immediately, the sound joins them a moment later and the
 * transaction is committed as a single history entry.
 */

import { makeAudio } from "@/core/factory";
import {
  cloneClip,
  designSize,
  insertTemplateLayers,
  trackWithRoom,
} from "@/core/project";
import { snapToFrame } from "@/core/time";
import type { AudioClip, Clip, ID, MediaAsset, Project } from "@/core/types";
import { engine } from "@/engine/engine";
import { addSoundAsset, prepareAddedAsset, refreshAnimationPoster, useAssetRuntime } from "@/engine/media/assets";
import { getSound, getTemplate } from "@/library";
import { brandFontPair, brandPalette } from "@/library/brand";
import { applyBrandStyle, isBrandStylable } from "@/library/brandStyle";
import {
  buildTemplate,
  type TemplateVariation,
} from "@/library/templateEngine";
import type { TemplateDef, TemplateMusic } from "@/library/types";
import { api } from "@/platform/api";
import type { FileInfo } from "@shared/ipc";
import { serializeMotionFile } from "@shared/motion";
import { getProject, updateProject, useProjectStore } from "@/store/project";
import { toast, useUI } from "@/store/ui";
import { t, tk } from "../i18n";
import { newProject } from "../projectIO";
import { templateThumbProject, type ThumbMotion, type ThumbSpec } from "../library/thumbs";
import { useTemplates } from "./store";

/** Defaults for template music beds. */
export const MUSIC_DEFAULTS = { volume: 0.8, fadeIn: 0.4, fadeOut: 1.2 };

/** The music a template would add right now (null when it has none or music is switched off). */
export function templateMusic(
  def: TemplateDef | undefined,
): TemplateMusic | null {
  if (!def?.music || !useTemplates.getState().includeMusic) return null;
  const sound = getSound(def.music.soundId);
  return sound ? def.music : null;
}

/** Make file assets used by template layers playable in this session. */
function prepareFileAssets(assets: MediaAsset[]): void {
  const rt = useAssetRuntime.getState();
  for (const a of assets) {
    if (a.source.type !== "file") continue;
    const current = rt.items[a.id];
    if (current?.status === "ready" && current.url) continue;
    rt.patch(a.id, {
      status: "ready",
      url: api.media.toUrl(a.source.path),
      thumb:
        a.kind === "image"
          ? api.media.toUrl(a.source.path)
          : (current?.thumb ?? null),
    });
  }
}

/** A template's in-memory Motion layer, sized for the project (real pixels and frame rate). */
function motionForProject(a: MediaAsset, settings: Project["settings"]): MediaAsset {
  if (a.source.type !== "motion") return a;
  const meta = { ...a.source.meta, width: settings.width, height: settings.height, fps: settings.fps };
  return { ...a, width: settings.width, height: settings.height, fps: settings.fps, source: { ...a.source, meta } };
}

/**
 * Save a template's Motion layers as .kmotion files (Documents\Kinora\Motion) and point their
 * assets at them, so they behave like any Motion clip (settings in the inspector, Claude…).
 * Inside the template's transaction: one undo step.
 */
async function saveMotionLayers(assets: MediaAsset[]): Promise<void> {
  for (const a of assets) {
    if (a.source.type !== "motion") continue;
    try {
      const file = await api.call<FileInfo>("x:motion:save", a.name, serializeMotionFile(a.source.meta, a.source.code));
      updateProject((p) => {
        const cur = p.assets[a.id];
        if (cur?.source.type === "motion") {
          cur.source = { type: "file", path: file.path };
          cur.size = file.size;
        }
      });
      const saved = getProject().assets[a.id];
      if (saved) {
        await prepareAddedAsset(saved);
        void refreshAnimationPoster(saved);
      }
    } catch (err) {
      // The layer keeps working from memory; only its settings panel needs the file.
      console.warn("[templates] could not save a Motion layer", err);
    }
  }
}

/** Mutates. Add assets that are not in the project yet. */
function addAssets(p: Project, assets: MediaAsset[]): void {
  for (const a of assets)
    if (!p.assets[a.id]) p.assets[a.id] = { ...a, addedAt: Date.now() };
}

interface PendingSound {
  soundId: string;
  /** A template clip (relative timing) — or a music bed spanning the template. */
  clip?: AudioClip;
  music?: TemplateMusic;
}

export interface ApplyOptions {
  /** Timeline time (default: the playhead). */
  time?: number;
}

/**
 * Insert a template variation into the open project. Returns the ids of the visual layers
 * (sounds are added asynchronously into the same undo step); `done` resolves once everything,
 * sounds included, is in place.
 */
export function applyTemplateVariation(
  v: TemplateVariation,
  opts: ApplyOptions = {},
): { ids: ID[]; done: Promise<ID[]> } {
  const project = getProject();
  const { cw, ch } = designSize(project.settings);
  const built = buildTemplate(v, cw, ch);
  if (!built || built.clips.length === 0) {
    toast("error", t("This template could not be built for the current project."));
    return { ids: [], done: Promise.resolve([]) };
  }
  const at = snapToFrame(opts.time ?? engine.time, project.settings.fps);
  const assetById = new Map(built.assets.map((a) => [a.id, a]));
  // Built-in sounds inside user templates are re-synthesised and joined after the layers.
  const pending: PendingSound[] = [];
  const layers: Clip[] = [];
  for (const c of built.clips) {
    const asset = c.type === "audio" ? assetById.get(c.assetId) : undefined;
    if (c.type === "audio" && asset?.source.type === "generated")
      pending.push({ soundId: asset.source.soundId, clip: c });
    else layers.push(c);
  }
  const music = templateMusic(built.def);
  if (music) pending.push({ soundId: music.soundId, music });
  const fileAssets = built.assets.filter((a) => a.source.type === "file");
  prepareFileAssets(fileAssets);
  const motionAssets = built.assets.filter((a) => a.source.type === "motion").map((a) => motionForProject(a, project.settings));

  const store = useProjectStore.getState();
  const transaction = pending.length > 0 || motionAssets.length > 0;
  // History labels stay English (tk marks them for the History panel, which translates them).
  if (transaction) store.begin(tk("Apply template"));
  let ids: ID[] = [];
  let groupId: ID | undefined;
  updateProject(
    (p) => {
      addAssets(p, fileAssets);
      addAssets(p, motionAssets);
      ids = layers.length
        ? insertTemplateLayers(p, layers, at, p.settings.fps)
        : [];
      groupId = ids.length ? p.clips[ids[0]]?.groupId : undefined;
    },
    { label: tk("Apply template") },
  );
  if (ids.length) useUI.getState().select(ids);
  for (const a of motionAssets) void prepareAddedAsset(a);
  if (!transaction) return { ids, done: Promise.resolve(ids) };

  const done = (async (): Promise<ID[]> => {
    const added: ID[] = [];
    try {
      await saveMotionLayers(motionAssets);
      for (const s of pending) {
        const asset = await addSoundAsset(s.soundId);
        updateProject((p) => {
          const a = p.assets[asset.id] ?? asset;
          const fps = p.settings.fps;
          let clip: AudioClip;
          if (s.music) {
            const length = Math.min(built.duration, a.duration);
            clip = makeAudio(a, {
              duration: Math.max(1 / fps, snapToFrame(length, fps)),
              volume: s.music.volume ?? MUSIC_DEFAULTS.volume,
              fadeIn: Math.min(
                s.music.fadeIn ?? MUSIC_DEFAULTS.fadeIn,
                length / 3,
              ),
              fadeOut: Math.min(
                s.music.fadeOut ?? MUSIC_DEFAULTS.fadeOut,
                length / 3,
              ),
            });
            clip.name = `${a.name} · ${built.def.name}`;
            clip.start = at;
          } else {
            clip = cloneClip(s.clip!);
            clip.assetId = a.id;
            clip.start = snapToFrame(at + s.clip!.start, fps);
            clip.duration = Math.min(
              clip.duration,
              Math.max(1 / fps, (a.duration - clip.trimIn) / clip.speed),
            );
          }
          if (groupId) clip.groupId = groupId;
          clip.trackId = trackWithRoom(
            p,
            "audio",
            clip.start,
            clip.duration,
          ).id;
          p.clips[clip.id] = clip;
          added.push(clip.id);
        });
      }
    } catch (err) {
      toast(
        "error",
        t("The template music could not be added"),
        (err as Error).message,
      );
    } finally {
      useProjectStore.getState().commit();
    }
    if (added.length) {
      const sel = useUI.getState().selection;
      // Keep the template selected, now with its sound.
      if (ids.every((id) => sel.includes(id)))
        useUI.getState().select([...ids, ...added]);
    }
    return [...ids, ...added];
  })();
  return { ids, done };
}

/**
 * Start a new project from a template (Home screen): an empty project of the given format, the
 * template applied at 0 s, and a clean undo history.
 */
export async function startProjectFromTemplate(
  format: { width: number; height: number; fps: number },
  v: TemplateVariation,
): Promise<boolean> {
  const def = getTemplate(v.templateId);
  if (!(await newProject({ ...format, name: def?.name }))) return false;
  const { done } = applyTemplateVariation(v, { time: 0 });
  await done;
  useProjectStore.setState({ past: [], future: [] });
  engine.seek(0);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Brand restyle
// ---------------------------------------------------------------------------------------------

/** Restyle the selected text, shapes, stickers and backgrounds with the brand kit (one undo step). */
export function applyBrandToSelection(): number {
  const { brand, brandSet } = useTemplates.getState();
  const ids = useUI.getState().selection;
  const project = getProject();
  const targets = ids.filter(
    (id) => project.clips[id] && isBrandStylable(project.clips[id]),
  );
  if (!brandSet) {
    toast(
      "info",
      t("Set up your brand kit first"),
      t("Add your colours, fonts and logo in the Brand Kit."),
    );
    return 0;
  }
  if (targets.length === 0) {
    toast(
      "info",
      t("Select text or shapes to brand"),
      t("Apply brand restyles selected text, shapes, stickers and animated backgrounds."),
    );
    return 0;
  }
  let changed = 0;
  updateProject(
    (p) => {
      changed = applyBrandStyle(
        targets.map((id) => p.clips[id]),
        brandPalette(brand),
        brandFontPair(brand),
      ).changed;
    },
    { label: tk("Apply brand") },
  );
  if (changed)
    toast(
      "success",
      t("{count, plural, one {Brand applied to # layer} other {Brand applied to # layers}}", { count: changed }),
    );
  else toast("info", t("The selection already uses your brand"));
  return changed;
}

// ---------------------------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------------------------

/** Thumbnail spec of a variation, with the media it references (logos, embedded media). */
export function templateThumbSpec(
  v: TemplateVariation,
  cw: number,
  ch: number,
  w: number,
  h: number,
): ThumbSpec | null {
  const built = buildTemplate(v, cw, ch);
  if (!built) return null;
  const project = templateThumbProject(built.clips, w, h, cw, ch, v.seed);
  const motion: ThumbMotion[] = [];
  for (const raw of built.assets) {
    let a = raw;
    if (a.source.type === "motion") {
      // Thumbnails render Motion layers at the thumbnail's own size (layout uses the asset size).
      a = { ...a, source: { ...a.source, meta: { ...a.source.meta, width: w, height: h, fps: 24 } } };
      const clip = built.clips.find((c) => "assetId" in c && c.assetId === a.id);
      motion.push({ asset: a, start: clip?.start ?? 0 });
    }
    if (!project.assets[a.id]) project.assets[a.id] = a;
  }
  return {
    project,
    poster: built.duration * (built.def.poster ?? 0.6),
    from: 0,
    to: built.duration,
    ...(motion.length ? { motion } : {}),
  };
}
