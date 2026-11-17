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
| Content at runtime (packs, user templates) | `registerContent(source, { palettes, filters, templates… })` | `library/index.ts` (`onLibraryChange` notifies galleries) |
| Data-only content pack for users | `*.kinorapack` (JSON + GLSL), built with `scripts/build-pack.mjs` | [`docs/PACKS.md`](PACKS.md) |

## Commands, menus and shortcuts

Every command registered in `ui/commands/defs/*.ts` automatically appears in the command palette
(Ctrl+K), in Settings → Shortcuts (where users can rebind it) and in the keyboard shortcuts
dialog; its `shortcut` works through the global key dispatcher. Title-bar menus are generated
from the registry: a command goes to `menu` ('File' | 'Edit' | 'View' | 'Tools' | 'Help'), else to
its `group` when that names a menu, else to **Tools** under a heading with its group name
(`menu: false` keeps it palette / shortcut only). Useful optional fields:

```ts
{
  id: 'smart.autoCaptions',          // stable: keys custom shortcuts and recents
  title: 'Generate captions…',       // English; translated on display (docs/I18N.md)
  group: 'Smart',
  shortcut: 'Ctrl+Alt+C',            // symbols as typed: '?', '+'; extraShortcuts for more
  when: () => useUI.getState().screen === 'editor',
  checked: () => …,                  // toggles show a check mark / On-Off
  global: true,                      // also fires while a text field has focus
  run: () => …,
}
```

Show a command's current shortcut with `shortcutText(id)` / `withShortcut(label, id)` from
`ui/commands/keymapStore` (they follow the user's keymap), and run one with `runCommand(id)`.

## Settings sections

Settings sections (`ui/settings/defs/*.tsx`) appear in the Settings window (gear, Ctrl+,). Build
them from `ui/settings/kit` (`SettingsGroup`, `SettingRow`, `ChoiceCards`, `Switch`) and persist
values with `useSetting(key, fallback)` from `ui/settings/store`; `openSettings('<id>')` opens a
section. Give the section `description` and `keywords` so the settings search finds it.

## Themes and text

All colours come from the tokens in `styles/base.css`, which has a dark and a light set
(`<html data-theme="dark|light">`); use `var(--…)` rather than fixed colours. Canvas code can read
tokens with `cachedThemeColor('--name', fallback)` from `ui/theme`. User-visible strings go
through `t()` — see [docs/I18N.md](I18N.md).

## Project file paths

Asset paths (`source.path`, `proxy.path`, `transcodedFrom`) are stored relative to the project
file when the media sits inside the project's folder (`Media/clip.mp4`), and resolved on load
(`serializeProject(p, { projectPath })` / `parseProjectFile(text, { projectPath })`). In memory
they are always absolute. File → Collect project… copies every file into such a folder.

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

## Undo steps and timeline invariants

- Every change goes through `updateProject(recipe, { label })` (or `begin(label)` / `commit(label)`
  for gestures). The label names the step in the History panel ("Apply LUT", "Remove silence");
  without one a name is derived from what changed. `updateFromBase` rebuilds the live project from
  the gesture's starting snapshot (handy for "base + delta" drags).
- The store keeps the magnetic main track packed after every update (`packMainTrack` in
  `core/editing.ts`): when `project.magneticMain` is on, the bottom visual track (`mainTrackId`)
  never has gaps, and linked partners follow its clips. New projects have it on.
- `core/editing.ts` also has the trim modes (`applyEdit` with ripple / roll / slip / slide),
  `insertOnMain`, group / link helpers and `splitClipsAt` (splits linked partners too).

## Shared helpers

- `core/captions.ts` — caption clips (text clips on a `role: 'captions'` track) → cues, SRT / WebVTT
  writing and parsing.
- `core/reframe.ts` — `reframeProject(project, w, h)` adapts a project to another aspect ratio;
  `setFocusProvider()` lets subject tracking steer the pan. The vision feature registers the
  provider; call `analyseProjectFocus(project, { signal, onProgress })` from `vision/reframe.ts`
  first so every clip has a subject analysis (results are cached per file).
- `vision/client.ts` — the on-device vision workers (MediaPipe models, Mediabunny decoding);
  `visionRequest()` runs analysis jobs with progress / cancellation off the UI thread.

## Time remapping and compound clips

- Never compute source time as `trimIn + t * speed`: use `sourceTimeAt(clip, localTime)` from
  `core/timemap.ts` (speed ramps, reverse, freeze). Trims and splits go through `retimeClip`, limits
  through `maxDurationFor` / `maxStartExtension`.
- Compound clips nest a `Sequence`. To find what plays at a time — including inside compounds — use
  `core/nested.ts` (`pictureRefsAt`, `soundsAt`, `mediaInstances`); nested clips come back as
  instance clips with ids `compoundId/clipId`. `deepClips()` walks every clip of a project.
- While a compound clip is open, the store's `project` (and `getProject()`) is its nested sequence;
  `root` / `getRootProject()` is the document. Save, autosave and export use the root.

## Checks to run

```bash
npm run typecheck && npm test && npm run check
npm run build && node scripts/e2e.mjs smoke && node scripts/e2e.mjs ui && node scripts/e2e.mjs export && node scripts/e2e.mjs time
```
