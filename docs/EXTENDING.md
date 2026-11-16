# Extending Kinora

Kinora is built so features can be added mostly in **new files** that are discovered automatically.
Prefer these extension points over editing shared core files.

| What you add | Where | Contract |
|---|---|---|
| Command (palette, menus, shortcuts) | `src/renderer/src/ui/commands/defs/<area>.ts` → `Command[]` | `ui/commands/index.ts` |
| Inspector panel (per clip type, any tab or a new tab) | `src/renderer/src/ui/inspector/sections/defs/<area>.tsx` → `InspectorSectionDef[]` | `ui/inspector/sections/index.ts` |
| Smart tool card (library → Smart tab) | `src/renderer/src/ui/tools/defs/<area>.tsx` → `ToolDef[]` | `ui/tools/index.ts` |
| Per-layer shader stage (tone-map, curves, LUT, matte…) | `src/renderer/src/engine/gl/ext/<name>.ts` → `LayerExtension` | `engine/gl/layerExt.ts` |
| Per-clip audio processing (EQ, compressor, pitch…) | `src/renderer/src/engine/audio/ext/<name>.ts` → `ClipAudioExtension` | `engine/audio/chain.ts` |
| Main-process feature (files, OS integration, child processes) | `src/main/handlers/<area>.ts` → `register(ctx)` | `src/main/context.ts` |
| Settings page section | `src/renderer/src/ui/settings/defs/<area>.tsx` → `SettingsSectionDef[]` | `ui/settings/index.ts` |
| Content (transitions, effects, templates…) | `src/renderer/src/library/<pack>/*.ts` | `library/types.ts` |

## Calling the main process

Main handlers register channels named `x:<area>:<action>`:

```ts
// src/main/handlers/proxies.ts
export default function register(ctx: MainContext) {
  ctx.handle('x:proxies:list', async () => { /* … */ });
}
```

and the renderer calls them with `window.kinora.call('x:proxies:list')` (events: `ctx.send('x:…')`
→ `window.kinora.on('x:…', cb)`). Writes must go through `ctx.assertWrite` / paths the user picked.

## On-device AI models

Run `npm run models` once to download the bundled models into `resources/models/` (git-ignored;
packaged into the installer through `extraResources`). The renderer loads them from
`kinora://models/<path>` — use `modelUrl()` from `@shared/ipc`:

| Path | What |
|---|---|
| `onnx-community/whisper-base_timestamped/` | Whisper base, int8 ONNX, word timestamps (transformers.js) |
| `ort/` | ONNX Runtime WebAssembly files (point `env.backends.onnx.wasm.wasmPaths` here) |
| `mediapipe/wasm/` | MediaPipe Tasks Vision WebAssembly runtime |
| `mediapipe/selfie_segmenter.tflite` | Person segmentation (background removal) |
| `mediapipe/blaze_face_short_range.tflite` | Face detection (auto-reframe) |
| `mediapipe/efficientdet_lite0.tflite` | Object detection (auto-reframe fallback, tracking) |

The page is cross-origin isolated (SharedArrayBuffer available) and WebGPU is enabled. Set
`KINORA_MODELS_DIR` to point at another models folder (e.g. from a git worktree).

## Data model

All persistent state lives in `src/renderer/src/core/types.ts`. Fields for planned features are
already declared there (speed ramps, reverse / freeze, linked clips, compound clips, captions,
count-up text, pen paths, LUTs, curves / wheels, cutouts, EQ / compressor, proxies, HDR, in / out
points, track roles and heights) — implement against them rather than inventing parallel fields.
`parseProjectFile` must keep accepting older projects: new fields are optional.

## Shared helpers

- `core/captions.ts` — caption clips (text clips on a `role: 'captions'` track) → cues, SRT / WebVTT
  writing and parsing.
- `core/reframe.ts` — `reframeProject(project, w, h)` adapts a project to another aspect ratio;
  `setFocusProvider()` lets subject tracking steer the pan.

## Checks to run

```bash
npm run typecheck && npm test && npm run check
npm run build && node scripts/e2e.mjs smoke && node scripts/e2e.mjs ui && node scripts/e2e.mjs export
```
