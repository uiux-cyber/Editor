# Kinora — product & engineering plan

Kinora is a desktop video editor for Windows that pairs a real multi-track timeline with a large,
procedurally generated content library (templates, transitions, effects, filters, stickers, text
styles, animations, sounds). Everything renders on the GPU, and the preview and the exporter share
one compositor, so what you see is exactly what you export.

This document covers the product scope, the architecture, how quality is enforced, what ships in
1.0, and the roadmap after it.

---

## 1. Product goals

| Goal | How Kinora meets it |
|---|---|
| Fast to start | Home screen with one-click formats (16:9, 9:16, 1:1, 4:5, 21:9) and a template gallery. |
| Endless ready-to-use content | Templates are parametric designs: each one is rebuilt for any aspect ratio and recoloured / re-typeset with every palette × font pairing × seed, so the gallery never runs out. |
| Pro editing where it matters | Multi-track timeline, snapping, ripple delete, split / trim / slip-free trimming, keyframes with easing, blend modes, masks, chroma key, adjustment layers, speed, audio fades. |
| What you see is what you export | Preview and export run the same WebGL2 compositor and the same scene evaluation. |
| Safe with your work | Autosave every 15 s with crash recovery, unsaved-changes prompts, relinking of moved media, atomic file writes. |
| Works offline, no licensing traps | Every font is SIL OFL, every sound is synthesised at runtime, every graphic is original code. |

### Target users
Creators and small teams producing social video, YouTube content, promos and presentations who
want template speed with editing control — the space between phone editors and full NLEs.

---

## 2. Feature scope (1.0)

**Editing**
- Multi-track timeline (visual tracks stacked, audio tracks below), track mute / hide / lock / rename.
- Select, move between tracks, trim from both edges (media-aware limits), split at playhead (S),
  blade tool, ripple delete, duplicate, copy / cut / paste, nudge by frame, marquee selection.
- Snapping to clip edges, markers and the playhead; magnetic zoom around the cursor.
- Undo / redo for every change (gestures such as drags and slider scrubs are one step).
- Markers, jump to edit points, frame stepping, J / K / L style navigation.

**Layers**
- Video, image, audio, text, sticker, shape, animated background (generator), adjustment layer.
- Transform with on-canvas handles (move, scale, rotate, snapping guides), opacity, flip, crop,
  rounded corners, 14 blend modes, 7 mask shapes with feather / invert, chroma key with spill removal.
- Keyframes for position, scale, rotation, opacity and volume with 19 easing curves.
- Media placeholders in templates: drop a photo or video on one and it is cropped to fit.

**Text**
- 24 bundled typefaces plus any font installed on the PC.
- Solid / linear / radial fills, outline, drop shadow, glow, background box, wrapping, tracking,
  line height, caps; per-letter / per-word / per-line animations.

**Colour & effects**
- Full grade (exposure, contrast, highlights / shadows, white balance, HSL, vibrance, split toning,
  monochrome toning, fade, vignette, grain, sharpen) plus LUT-style filter presets with intensity.
- Stackable GPU effects with parameters, applicable per clip or through an adjustment layer.

**Audio**
- Clip volume (keyframable), fades, mute, detach audio from video, speed.
- Live mixing in the preview with an output meter; offline mixing for export.
- Voiceover recording straight onto the timeline.

**Export**
- MP4 (H.264 / HEVC / AV1), WebM (VP9), MOV (H.264), animated GIF, MP3, WAV, PNG still.
- Resolution presets up to 4K, frame rate, quality levels, GPU / CPU encoder preference,
  fast-start MP4, size estimate, live progress with preview, cancel.

**Project management**
- `.kinora` project files (JSON, versioned, validated on load), recent projects with thumbnails,
  autosave + crash recovery, relink missing media, file association and single-instance handling.

---

## 3. Content library

All content is code in `src/renderer/src/library/<pack>/*.ts`; dropping a new file into a pack
folder registers it automatically.

| Pack | 1.0 count | Notes |
|---|---|---|
| Transitions | 94 | GLSL, 11 categories, parameters (direction, colour, softness…) |
| Effects | 108 | GLSL, multi-pass capable, blur / stylize / distort / glitch / retro / light / colour / motion |
| Filters | 80 | Colour-grade presets in 8 looks families |
| Animated backgrounds | 44 | GLSL generators with colour and speed controls |
| Clip animations | 151 | In / out / loop presets for any layer |
| Text animations | 97 | Per character / word / line choreography |
| Text styles | 139 | 11 categories, half of them animated |
| Stickers | 1,514 | 1,396 emoji + 118 original vector stickers (92 animated, recolourable) |
| Sounds | 94 | Synthesised SFX and seamless music beds — royalty free by construction |
| Templates | 78 designs | 15 categories, every design in 16:9 / 9:16 / 1:1 / 4:5, × 37 palettes × 28 font pairings × seeded layout variants = endless variations |

---

## 4. Architecture

```
┌──────────────────────── Electron main (src/main) ────────────────────────┐
│ window, kinora:// protocol (app bundle + range-streamed local media),     │
│ IPC with a path allow-list, settings, recent files, autosave, dialogs     │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ contextBridge (src/preload) — typed in src/shared/ipc.ts
┌───────────────┴──────────────── Renderer (src/renderer/src) ─────────────┐
│ core/      pure project model: types, factory, timeline ops, keyframes,  │
│            scene evaluation (what is visible / audible at time t)        │
│ store/     zustand stores; project store = immer + undo history          │
│ engine/    compositor (WebGL2) ← sources (text / shape / sticker raster)  │
│            preview engine (transport, media pool, render loop)           │
│            export pipeline (Mediabunny + WebCodecs, offline audio mix)    │
│ library/   content packs + registries + template engine                  │
│ ui/        React: shell, library panels, preview + gizmo, inspector,     │
│            timeline, export dialog, shortcuts                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key decisions
- **Resolution-independent model.** Geometry is stored in "design pixels" (shorter side = 1080), so
  changing the project size or exporting at another resolution never moves anything.
- **One compositor for preview and export.** Layers render into premultiplied RGBA textures; effects
  and transitions are full-frame passes; blend modes use the W3C separable formulas.
- **WebCodecs everywhere.** Mediabunny demuxes / muxes; decoding and encoding use the GPU when
  available. No FFmpeg binary, nothing to license.
- **Content as code.** Packs are typed data + small GLSL / canvas / Web Audio functions, validated
  by an automated checker in real Chromium.
- **Security.** Sandboxed renderer, context isolation, strict CSP, IPC sender checks, and file
  writes only to paths the user picked in a native dialog.

---

## 5. Quality gates

| Gate | Command | What it proves |
|---|---|---|
| Types | `npm run typecheck` | Main, preload and renderer compile with `strict`. |
| Library checker | `npm run check` | Every shader compiles and renders; transitions start / end exactly on the input pictures; animations are neutral at their ends and loops are seamless; stickers draw and loop; sounds are deterministic, unclipped and click-free; filters stay in range; templates build in every aspect with valid ids, fonts and timing. |
| Template review | `npm run sheets -- --aspects=16:9,9:16` | Contact sheets rendered by the real compositor for visual review. |
| Pipeline test | `node scripts/e2e.mjs export` | Builds projects, exports every container, re-imports the result and checks duration / size / codecs. |
| Interaction test | `node scripts/e2e.mjs ui [--packaged]` | Drives the real UI with mouse and keyboard: import, click-to-add, drag to timeline, move, trim, split, undo / redo, context menu, transition drop, text editing, canvas dragging, inspector sliders, animations, effects, filters, stickers, templates, playback, save / reopen, export dialog. |

---

## 6. Release plan

1. **1.0** — everything in §2 and §3, NSIS installer for Windows x64.
2. **Before public distribution**
   - Code-sign the installer (EV certificate) to avoid SmartScreen warnings.
   - Auto-update channel (done in 1.2: electron-updater with GitHub releases; signing still to come).
   - Crash reporting (opt-in) and anonymous performance telemetry (opt-in).
   - Beta on a range of GPUs (Intel iGPU, AMD, NVIDIA) and on 8 GB RAM machines.
3. **1.1 (this build)** — shipped together: editing depth (trim modes, magnetic main track, groups,
   links, track heights, History; speed ramps, freeze frame, reverse, keep pitch, compound clips),
   on-device smart features (captions, SRT / VTT, filler words, silences, beats, noise reduction,
   TTS, ducking, background removal, auto-reframe, scene detection, colour match, motion tracking),
   colour & audio (curves, wheels, LUTs, scopes, EQ, compressor, track meters), text & graphics
   (GIF / WebP / APNG / Lottie, pen tool, count-up numbers), templates & brand (save as template,
   brand kit, music, content packs), export (presets, multi-aspect, queue, In / Out, transparency,
   captions), performance & media (proxies, render cache, optional FFmpeg, HDR) and workflow
   (command palette, custom shortcuts, settings, light theme, 5 translations, accessibility,
   collect project). See the README for a summary.
4. **Later** — cloud backup and review links (needs a hosted service), translation of the
   remaining panels (library, inspector, timeline, export dialog), native-speaker review of the
   translations, more languages.
5. **1.2** — open source (MIT) on GitHub, automatic updates from GitHub releases published by
   a tag-triggered workflow (docs/RELEASING.md).
6. **1.3** — Kinora as a Claude connector (MCP): Claude Desktop / Claude Code edit, caption and
   export in Kinora through a local, token-protected pipe (docs/CLAUDE-CONNECTOR.md).
7. **1.4** — Motion clips: animation code (three.js, GSAP, PixiJS, anime.js, D3, Matter.js, p5.js,
   Lottie…) rendered frame by frame in a sealed, out-of-process sandbox; Claude writes them with
   create_motion / update_motion.
8. **Still to do before wide distribution**: code signing, opt-in crash reports, GPU / low-RAM beta.
9. **Content cadence**: monthly template and sticker drops through the same pack format.

---

## 7. Known limitations

- Source formats are limited to what WebCodecs can decode on the PC (H.264, HEVC with the Windows
  HEVC extension or a supporting GPU, VP8 / VP9, AV1, AAC, MP3, Opus, FLAC, PCM). ProRes / DNxHD /
  MXF sources are converted on import when FFmpeg is installed (Kinora does not ship FFmpeg).
- Changing clip speed changes the pitch of its sound unless "Keep pitch" is on (WSOLA time-stretch,
  also through speed ramps; above ~4× the stretched sound becomes choppy). Reversed clips longer than
  5 minutes play silently in the preview (they export with sound).
- The installer is unsigned, so Windows SmartScreen shows a warning on first run.
- Only built-in music beds can be attached to templates (`TemplateDef.music`); user templates keep
  built-in sounds, and other audio only when the template embeds its media.
- Projects that use fonts installed on one PC fall back to a default font on PCs without them.
- The interface is translated in the menus, command palette, settings, start screen and dialogs of
  the shell; the library, inspector, timeline and export panels are still English. Translations
  have not been reviewed by native speakers.
- Smart features were tested on synthetic and sample footage; accuracy on real-world material
  (filler words in natural speech, segmentation of real people, non-English captions) varies.
- FFmpeg conversion was tested against a stand-in executable, and HDR against synthetic PQ clips.
