# Kinora

A free, open-source video editor for Windows with a multi-track timeline, on-device smart
features and an endless, procedurally generated content library: templates, transitions,
effects, filters, stickers, text styles, animations and royalty-free sounds.

Kinora is MIT-licensed: use it, change it, build on it and ship your own versions. Everything
runs on your own PC, including the AI features, and no footage is uploaded anywhere.

See [docs/PLAN.md](docs/PLAN.md) for the product scope, architecture and roadmap.

## What's new in 1.4

- **Motion clips:** Claude can write custom animation as code (three.js, GSAP, PixiJS, anime.js,
  D3, Matter.js, p5.js, Lottie and more, all bundled) that Kinora renders frame by frame as a
  transparent, exportable layer, in a sandbox with no network access. See
  [docs/CLAUDE-CONNECTOR.md](docs/CLAUDE-CONNECTOR.md#motion-clips-custom-animation-written-by-claude).

## What's new in 1.3

- **Works with Claude:** connect Kinora to Claude Desktop or Claude Code (Settings → Claude) and
  ask Claude to edit, caption and export for you. It uses your own Claude plan; every change is
  undoable and replacing a file always asks first. See [docs/CLAUDE-CONNECTOR.md](docs/CLAUDE-CONNECTOR.md).

## What's new in 1.2

- **Automatic updates:** Kinora downloads new versions from this repository's releases in the
  background, verifies them, and installs on restart (Help → Check for updates…, Settings →
  Updates). Maintainers: see [docs/RELEASING.md](docs/RELEASING.md).

## What's new in 1.1

- **Editing:** ripple, roll, slip and slide trims; a magnetic main track; groups and linked
  video/audio; resizable tracks; a History panel. Speed ramps, freeze frames, reverse, keep pitch
  and compound (nested) clips.
- **Smart, on this PC:** auto captions with word highlighting (Whisper), SRT / VTT import and
  export, filler-word and silence removal, beat detection and cut-to-beat, noise reduction,
  Windows text-to-speech, auto ducking. Background removal, auto-reframe, scene detection,
  colour match and motion tracking. All models ship inside the installer; nothing is uploaded.
- **Colour & audio:** curves, colour wheels, `.cube` LUT import, waveform / parade /
  vectorscope / histogram; EQ, compressor and per-track meters.
- **Text & graphics:** animated GIF / WebP / APNG and Lottie, a pen tool, count-up numbers.
- **Templates & brand:** save your own templates, a brand kit applied to every template,
  templates with music, installable content packs (`.kinorapack`).
- **Export:** platform presets, several aspect ratios in one go, an export queue, In / Out
  ranges, transparent video, burned-in or sidecar captions.
- **Performance & media:** automatic proxies, a background render cache, optional FFmpeg for
  ProRes / DNxHD / MXF, HDR (PQ / HLG) tone mapping.
- **Workflow:** command palette (Ctrl+K), customisable shortcuts, Settings window, light theme,
  Spanish / French / German / Portuguese / Hindi, keyboard navigation (F6), collect project.

Developers: see [docs/EXTENDING.md](docs/EXTENDING.md) (extension points), [docs/I18N.md](docs/I18N.md),
[docs/PACKS.md](docs/PACKS.md), [docs/RELEASING.md](docs/RELEASING.md) and
[docs/CLAUDE-CONNECTOR.md](docs/CLAUDE-CONNECTOR.md).

## Install (end users)

Download `Kinora-Setup-<version>.exe` from the
[Releases page](https://github.com/uiux-cyber/Editor/releases), or build it yourself (below).
The installer is not code-signed yet, so Windows SmartScreen may ask you to confirm with
**More info → Run anyway**.

## Develop

Requirements: Windows 10/11 x64, Node.js 22+ (24 recommended), a GPU with current drivers.

```bash
npm install
npm run dev          # hot-reloading development build
npm run build        # production bundles in out/
npm start            # run the production bundles
```

Package:

```bash
npm run dist         # NSIS installer → release/Kinora-Setup-<version>.exe
npm run dist:dir     # unpacked app → release/win-unpacked/Kinora.exe
npm run icons        # regenerate resources/icon.png and icon.ico (needs Python + Pillow)
```

## Quality checks

```bash
npm run typecheck                         # strict TypeScript for main, preload and renderer
npm run check                             # validate every content pack in real Chromium
npm run check -- templates sounds         # validate selected packs
npm run sheets -- --aspects=16:9,9:16     # template contact sheets → .sheets/
node scripts/e2e.mjs export               # build, export every format, re-import and verify
node scripts/e2e.mjs ui                   # drive the UI with real mouse and keyboard input
node scripts/e2e.mjs ui --packaged        # same, against release/win-unpacked
```

Scenarios: `smoke ui export export-queue graphics editing time workflow speech vision
color-audio media templates updates claude`. Test windows run off-screen without taking focus; set
`KINORA_E2E_SHOW=1` to watch a run. Run `npm run models` once before the speech / vision
scenarios (it downloads the bundled AI models into `resources/models/`).

End-to-end runs use an isolated profile and write screenshots and exports to `.e2e/`.

## Project layout

```
src/main/          Electron main process: window, kinora:// protocol, IPC, files, autosave
src/preload/       Typed bridge exposed as window.kinora
src/shared/        Types shared by every process
src/renderer/src/
  core/            Pure project model, timeline operations, keyframes, scene evaluation
  store/           Project store (immer + undo history) and UI store
  engine/          WebGL2 compositor, text/shape/sticker rasterisers, preview engine,
                   media import / thumbnails / waveforms, export pipeline
  library/         Content packs (one folder per pack, auto-registered) and the template engine
  ui/              React interface: home, library, preview, inspector, timeline, export
scripts/           Library checker, template contact sheets, end-to-end tests, icon generator
docs/              Product and engineering plan
```

## Adding content

Every pack is a folder of TypeScript files that default-export an array; new files are picked up
automatically. Contracts and GLSL conventions are documented in
`src/renderer/src/library/types.ts`. Always run `npm run check` (and `npm run sheets` for
templates) after adding content.

## Contributing

Bug reports, ideas and pull requests are welcome.

- **Report a bug or suggest a feature:** open an [issue](https://github.com/uiux-cyber/Editor/issues)
  with steps to reproduce, what you expected, and your Windows version and GPU.
- **Send a change:** fork the repository, make your change on a branch, and open a pull request.
  Before you do, run `npm run typecheck` and `npm test`; if you touched content packs,
  also run `npm run check`. Describe what changed and how you tested it.
- **Add content:** templates, stickers, effects and sounds are plain TypeScript files; see
  [Adding content](#adding-content) and [docs/PACKS.md](docs/PACKS.md).

## Licence

Kinora is released under the [MIT License](LICENSE).

Third-party parts keep their own licences: bundled fonts are SIL Open Font License or
Apache 2.0 (via @fontsource), media handling uses Mediabunny (MPL-2.0), speech recognition uses
Transformers.js (Apache 2.0) with the Whisper model (MIT), and the vision features use MediaPipe
(Apache 2.0). The AI model files are downloaded by `npm run models` and are not stored in this
repository. All stickers, sounds, shaders and templates are original to this project.

Motion clips bundle three.js, PixiJS, anime.js, Matter.js, Lottie, simplex-noise and Rough.js (MIT),
D3 (ISC), p5.js (LGPL-2.1, shipped as its own replaceable file) and **GSAP**, which is not open
source: it is distributed under GreenSock's no-charge
[GSAP Standard License](https://gsap.com/standard-license). The full notices ship in
`out/motion/THIRD-PARTY-LICENSES.txt` (`resources/app.asar/out/motion` when installed).
