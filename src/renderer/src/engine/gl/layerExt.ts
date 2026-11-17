/**
 * Layer shader extensions. Features that change how a single layer is shaded (HDR tone-mapping,
 * curves / wheels / LUTs, background-removal mattes…) live in `engine/gl/ext/*.ts`, each
 * default-exporting a `LayerExtension` (or an array of them). They are compiled into the layer
 * program at fixed insertion points, so features never need to edit the core shader.
 *
 * Inside `body` these variables are in scope and may be modified:
 *   vec3 rgb      straight (un-premultiplied) colour, 0..1
 *   float alpha   coverage 0..1
 * and these are readable:
 *   vec2 uv       0..1 position inside the layer quad (0,0 = top-left)
 *   vec2 tuv      texture coordinate in the source (after crop / flips)
 *   vec2 u_size   layer size in render pixels;  float u_px  render px per design px
 *   float u_time  seconds since the clip start
 * Prefix every uniform / function you declare in `decls` with your extension id (e.g. `ext_lut_`).
 */

import type { Project, VisualClip } from '@/core/types';
import type { MediaProvider } from '../compositor';
import type { GLContext } from './context';
import type { Program } from './shaderlib';

export type LayerStage =
  /** Right after the source is sampled (e.g. HDR tone-mapping, input transforms). */
  | 'source'
  /** After the colour grade and filter (curves, wheels, LUTs). */
  | 'grade'
  /** After coverage (corners, masks) — e.g. mattes multiplying `alpha`. */
  | 'alpha';

export interface LayerExtContext {
  gl: WebGL2RenderingContext;
  glctx: GLContext;
  prog: Program;
  clip: VisualClip;
  /** Seconds since the clip start. */
  localTime: number;
  /** Source time for timed media (video clips), else undefined. */
  sourceTime?: number;
  provider: MediaProvider;
  /** Render target size and scale. */
  W: number;
  H: number;
  px: number;
  /** True while shading an adjustment layer (the input is the whole frame beneath it). */
  identity: boolean;
  /** Reserve a texture unit for this draw (units 0..3 are taken by the core shader). */
  unit: () => number;
}

export interface LayerExtension {
  /** Unique id, also used for the `u_ext_<id>` on/off uniform. Letters, digits, underscore. */
  id: string;
  stage: LayerStage;
  /** Lower runs first within a stage (default 100). */
  order?: number;
  /** GLSL declarations (uniforms, helper functions). */
  decls: string;
  /** GLSL statements run when the extension is active for the layer. */
  body: string;
  /**
   * Called for every layer draw. Set your uniforms and return true when the extension should
   * run for this layer; return false to skip it (cheap: a uniform branch).
   */
  apply: (ctx: LayerExtContext) => boolean;
  /**
   * Optional: load asynchronous data the extension needs for `project` (e.g. LUT tables). The
   * exporter awaits this before rendering the first frame so exports never miss it.
   */
  prepare?: (project: Project) => Promise<void>;
}

// --- colour-audio: async data hooks for layer extensions ----------------------------------------
const changeListeners = new Set<() => void>();

/** Extensions call this when asynchronously loaded data becomes available; the preview repaints. */
export function notifyLayerExtChanged(): void {
  changeListeners.forEach((cb) => cb());
}

export function onLayerExtChanged(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

/** Run every extension's `prepare` for a project (used by the exporter). */
export async function prepareLayerExtensions(project: Project): Promise<void> {
  await Promise.all(
    LAYER_EXTENSIONS.map(async (e) => {
      try {
        await e.prepare?.(project);
      } catch (err) {
        console.warn(`[gl] layer extension "${e.id}" could not prepare`, err);
      }
    }),
  );
}
// --- end colour-audio ---------------------------------------------------------------------------

const modules = import.meta.glob<{ default: LayerExtension | LayerExtension[] }>('./ext/*.ts', { eager: true });

export const LAYER_EXTENSIONS: LayerExtension[] = Object.keys(modules)
  .sort()
  .flatMap((k) => {
    const d = modules[k].default;
    return Array.isArray(d) ? d : d ? [d] : [];
  })
  .filter((e) => /^[A-Za-z0-9_]+$/.test(e.id))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

/** GLSL for one insertion point. */
export function extStageGlsl(stage: LayerStage): string {
  return LAYER_EXTENSIONS.filter((e) => e.stage === stage)
    .map((e) => `  if (u_ext_${e.id} > 0.5) {\n${e.body}\n  }`)
    .join('\n');
}

export function extDeclsGlsl(): string {
  return LAYER_EXTENSIONS.map((e) => `uniform float u_ext_${e.id};\n${e.decls}`).join('\n');
}
