# Kinora + Claude

Kinora works as a connector for Claude. Once connected, you can ask Claude, in your own Claude app,
to edit in Kinora: "cut the silences from this interview, add captions and export TikTok and YouTube
versions". Claude reads the timeline, looks at frames and uses Kinora's own commands. It runs on your
Claude plan; Kinora uploads nothing and needs no API key.

## Set up

### Claude Desktop

1. In Kinora, click **Connect Claude** on the start screen (or **Connect** in Settings → Claude, or
   Help → Connect to Claude…).
2. Claude Desktop opens and asks to install the **Kinora** extension. Click **Install**. No restart
   and no config files: Kinora builds the extension (`Kinora.mcpb`) with this PC's paths filled in.
3. Ask Claude something like "What's in my Kinora project?". If Kinora isn't open, Claude starts it.

If Claude Desktop doesn't open by itself, Settings → Claude shows **Show Kinora.mcpb**: drag that
file onto Claude Desktop's Settings → Extensions page and click Install.

To remove Kinora from Claude, uninstall it in Claude Desktop under Settings → Extensions. To stop
Claude using Kinora without uninstalling, turn off **Let Claude control Kinora** in Kinora.

The extension runs the MCP server that ships with the installed Kinora, so it stays current when
Kinora updates itself; there is nothing to reinstall.

### Claude Code and other MCP apps

Settings → Claude shows a command such as:

```bash
claude mcp add --scope user -e ELECTRON_RUN_AS_NODE=1 kinora -- "C:\Users\you\AppData\Local\Programs\Kinora\Kinora.exe" "C:\Users\you\AppData\Local\Programs\Kinora\resources\mcp\kinora-mcp.cjs"
```

Run it once in a terminal. Other MCP apps can start the same command (stdio transport).

## Things to ask

- "Make a 30-second vertical promo from the clips in D:\Shoot with an upbeat template and music."
- "Cut the silences and filler words from the interview, then add captions in my brand style."
- "Export this for TikTok, YouTube Shorts and Instagram Reels into my Videos folder."
- "For every video in this folder, add my intro and captions, then export them."
- "Look at the frame at 0:12 — is the title readable? Make it bigger if not."

### Ready-made requests

Kinora also offers ready-made requests (MCP prompts) that start a whole task with one click. In
Claude Desktop, click **+** in the message box, choose **Kinora** and pick one; in Claude Code, type
`/mcp__kinora__` and pick one. Settings → Claude lists them too, with a button to copy each one.

| Request | What Claude does |
| --- | --- |
| Turn a long video into shorts | Finds the strongest moments and makes vertical shorts with captions and a hook title |
| Caption and clean up a talking-head video | Removes silences and filler words, adds captions and a name lower third, evens out the audio |
| Make a promo video from photos | Photos with motion, transitions, music cut to the beat, an animated title and an end card |
| Add an animated title | A custom title as a Motion clip, with editable words, colours and font |
| Turn numbers into an animated chart | An animated D3 chart from your numbers, as a Motion clip |
| Make a logo intro | A logo reveal from your brand kit |
| Cut clips to the beat of a song | Detects the beats and puts every cut on one |
| Export for a platform | The right presets per platform, auto-reframed when the shape differs |
| Review my edit | Looks through the project and suggests improvements without changing anything |

## What Claude can do

| Tool | What it does |
| --- | --- |
| `get_status` | Screen, playhead, selection, background tasks and recent changes |
| `get_project` | Settings, tracks, clips, media (with paths), markers, In / Out |
| `list_commands` / `run_command` | Every command of the command palette (captions, silence and filler removal, noise reduction, background removal, scene detection, splitting, grouping…) |
| `search_library` | Templates, Motion clips, text styles, stickers, sounds, backgrounds, transitions, effects, filters |
| `new_project` / `open_project` / `save_project` | Projects |
| `import_media` | Import files, optionally placing them one after another |
| `add_item` | Add media, a template, a ready-made Motion clip (any version), text, a sticker, a sound or a background |
| `apply_to_clip` | Effect, filter or transition |
| `update_clip` | Timing, text, size, colour, volume, opacity, speed, position, scale, rotation |
| `delete_clips` / `split_clip` / `select_clips` / `set_playhead` | Editing basics |
| `capture_frame` | A picture of the video at a time |
| `export_video` | Platform presets or formats, in the background |
| `motion_guide` / `create_motion` / `update_motion` / `get_motion` | Motion clips: custom animation as code (below) |
| `undo` / `redo` | History |

## Motion clips: custom animation written by Claude

For anything the template and sticker library can't do (kinetic typography, 3D, animated charts,
physics, generative art, logo reveals), Claude writes a **Motion clip**: a short JavaScript module
that Kinora renders frame by frame, exactly, as a transparent layer. It can be moved, scaled,
trimmed, layered over video and exported like any clip.

- Ask, for example: "Make a 3D logo reveal with bloom", "Animate this data as a bar chart", "Add a
  kinetic title that says MAKE IT MOVE".
- Claude reads `motion_guide`, writes the code and calls `create_motion`. Kinora runs it first and
  returns a preview frame, or the error with its line, so Claude can fix it before it reaches your
  project. `update_motion` changes a clip (undo restores the previous version); `get_motion` reads it.
- Libraries, all bundled and offline: **three.js** (with post-processing: bloom, film, glitch, bokeh,
  halftone, pixelate; rounded boxes, SVG and glTF loading, thick lines, sky), **GSAP** with every
  plugin (SplitText, MorphSVG, DrawSVG, MotionPath, CustomEase…), **PixiJS**, **anime.js**, **D3**,
  **Matter.js** physics, **p5.js**, **Lottie**, **simplex-noise** and **Rough.js**, plus Kinora's
  typefaces and a helper kit (easing, keyframes, springs, staggers, seeded randomness, text fitting,
  physics baking, SVG drawing).
- **Settings you can change without Claude.** Claude declares a clip's settings (the words,
  colours, fonts, speed, a logo…) with `params`; they appear at the top of the inspector when you
  select the clip, and the clip restarts with your values. Claude can change them too
  (`update_motion` with `values`) without rewriting the code. Settings linked to your brand kit
  follow it with **Use my brand**. When several clips share one Motion clip, **Make unique** gives
  one of them its own copy.
- **The Motion library.** Library ▸ Motion has ready-made clips (titles, lower thirds, subscribe and
  follow buttons, counters, charts, a progress ring, 3D logo reveals, confetti, particles, a colour
  wipe, a kinetic reel) that work the same way: click or drag one onto the timeline and change it in
  the inspector. Every design comes in endless colour, font and style versions as you scroll. Claude
  finds them with `search_library` (kind `motion`) and adds a version with `add_item`.
- Clips are saved as `.kmotion` files in `Documents\Kinora\Motion`; you can also import a
  `.kmotion` file like any media.
- **Sandboxed:** a clip runs in an isolated frame with no network, no access to your files or to
  Kinora, and its own process: a clip that hangs is stopped after 15 seconds and never freezes the
  editor. Time, `requestAnimationFrame` and randomness are controlled by Kinora, so the export
  matches the preview frame for frame.

## Safety

- **Your switch.** Claude can only use Kinora while **Let Claude control Kinora** is on
  (Settings → Claude). Turning it off disconnects Claude immediately.
- **Only you.** The connection is a local Windows named pipe protected by a random token stored in
  your own profile (`%APPDATA%\Kinora\claude-bridge.json`), so other users on the PC can't use it.
  Nothing listens on the network.
- **Undo everything.** Each change is one step in the History panel, labelled "Claude: …".
- **Your files.** Claude reads only the media and projects it's asked to use. It writes new export
  and project files; replacing an existing file always shows a prompt in Kinora first. Claude never
  deletes files (deleting clips only removes them from the timeline).
- The title bar shows **Claude** while a Claude app is connected, with what it's doing.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Claude doesn't list Kinora's tools | In Claude Desktop, check Settings → Extensions shows Kinora as enabled. If it isn't there, click **Connect** in Kinora again and click **Install**. |
| The Install dialog doesn't appear | Open Claude Desktop first, then click **Connect** again; or use **Show Kinora.mcpb** and drag the file onto Claude Desktop's Settings → Extensions page. |
| "Claude access is turned off in Kinora" | Turn on **Let Claude control Kinora** in Settings → Claude. |
| "Kinora did not start in time" | Open Kinora yourself, then ask again. |
| Kinora was moved or reinstalled elsewhere | Click **Connect** again and install the new extension over the old one. |

## How it works (developers)

```
Claude Desktop ─stdio (MCP)─▶ extension server/index.js ─▶ kinora-mcp.cjs ─named pipe─▶ Kinora main ─IPC─▶ renderer (tools)
                              (Claude's own Node.js)        (from the installed Kinora)
Claude Code    ─stdio (MCP)─▶ Kinora.exe kinora-mcp.cjs (Node mode) ─named pipe─▶ …
```

- `src/shared/claude.ts`: tool definitions (names, descriptions, JSON schemas), the pipe protocol,
  the Claude Desktop extension manifest and loader, and the helpers that remove the config entries
  Kinora 1.3.0 wrote. `src/shared/zip.ts` writes the `.mcpb` (a ZIP). Shared by every side.
- `src/mcp/`: the MCP server. `protocol.ts` is JSON-RPC over stdio (tools only, no dependencies);
  `kinora-mcp.ts` connects to the app, starting it when needed. Built by `vite.mcp.config.mts` into
  `out/mcp/kinora-mcp.cjs`, shipped unpacked as `resources\mcp\kinora-mcp.cjs`, and started as
  `Kinora.exe kinora-mcp.cjs` with `ELECTRON_RUN_AS_NODE=1` for Claude Code. The Claude Desktop
  extension runs it on Claude's own Node.js and passes Kinora's executable in `KINORA_EXE`.
- `src/main/handlers/claude.ts`: the pipe server (token check, one connection per Claude app),
  forwarding calls to the renderer, file approvals, and Connect (build and open `Kinora.mcpb`).
- `src/renderer/src/ui/claude/`: `tools.ts` runs each tool with the editor's own actions;
  `store.ts` serialises calls, tracks connected apps and the user's approvals.

**Adding a tool:** add its definition to `TOOLS` in `src/shared/claude.ts`, implement it in the
`TOOLS` table of `ui/claude/tools.ts`, and cover it in `scripts/e2e/claude.mjs`. The unit tests check
that every defined tool is implemented.

**Tests:** `npx vitest run tests/claude.test.ts` (config merge, protocol, definitions);
`npm run build && node scripts/e2e.mjs claude` (a full session through the real bridge);
`node scripts/e2e-claude-autostart.mjs` (Claude starts Kinora when it is closed).
