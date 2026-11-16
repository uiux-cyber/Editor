# Kinora

A GPU-accelerated video editor for Windows with a multi-track timeline and an endless,
procedurally generated content library: templates, transitions, effects, filters, stickers,
text styles, animations and royalty-free sounds.

See [docs/PLAN.md](docs/PLAN.md) for the product scope, architecture and roadmap.

## Install (end users)

Run `Kinora-Setup-<version>.exe` from the `release` folder. The installer is not code-signed yet,
so Windows SmartScreen may ask you to confirm with **More info → Run anyway**.

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

## Licences

Bundled fonts are SIL Open Font License (via @fontsource). Media handling uses Mediabunny
(MPL-2.0). All stickers, sounds, shaders and templates are original to this project.
