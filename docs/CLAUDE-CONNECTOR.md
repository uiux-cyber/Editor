# Kinora + Claude

Kinora works as a connector for Claude. Once connected, you can ask Claude, in your own Claude app,
to edit in Kinora: "cut the silences from this interview, add captions and export TikTok and YouTube
versions". Claude reads the timeline, looks at frames and uses Kinora's own commands. It runs on your
Claude plan; Kinora uploads nothing and needs no API key.

## Set up

### Claude Desktop

1. In Kinora, open **Settings → Claude** (or Help → Connect to Claude…) and click **Connect**.
   Kinora adds itself to Claude Desktop's `claude_desktop_config.json` (both the regular and the
   Microsoft Store install), keeping everything else in that file.
2. Quit Claude Desktop completely (tray icon → Quit) and open it again.
3. Ask Claude something like "What's in my Kinora project?". If Kinora isn't open, Claude starts it.

**Remove** in the same place takes Kinora out of Claude Desktop's config again.

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

## What Claude can do

| Tool | What it does |
| --- | --- |
| `get_status` | Screen, playhead, selection, background tasks and recent changes |
| `get_project` | Settings, tracks, clips, media (with paths), markers, In / Out |
| `list_commands` / `run_command` | Every command of the command palette (captions, silence and filler removal, noise reduction, background removal, scene detection, splitting, grouping…) |
| `search_library` | Templates, text styles, stickers, sounds, backgrounds, transitions, effects, filters |
| `new_project` / `open_project` / `save_project` | Projects |
| `import_media` | Import files, optionally placing them one after another |
| `add_item` | Add media, a template, text, a sticker, a sound or a background |
| `apply_to_clip` | Effect, filter or transition |
| `update_clip` | Timing, text, size, colour, volume, opacity, speed, position, scale, rotation |
| `delete_clips` / `split_clip` / `select_clips` / `set_playhead` | Editing basics |
| `capture_frame` | A picture of the video at a time |
| `export_video` | Platform presets or formats, in the background |
| `undo` / `redo` | History |

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
| Claude doesn't list Kinora's tools | Quit Claude Desktop from the tray and reopen it. Check Settings → Claude shows "Kinora is added to Claude Desktop". |
| "Claude access is turned off in Kinora" | Turn on **Let Claude control Kinora** in Settings → Claude. |
| "Kinora did not start in time" | Open Kinora yourself, then ask again. |
| Kinora was moved or reinstalled elsewhere | Click **Remove**, then **Connect** again. |

## How it works (developers)

```
Claude Desktop / Claude Code ──stdio (MCP)──▶ kinora-mcp.cjs ──named pipe──▶ Kinora main ──IPC──▶ renderer (tools)
                                                 (Kinora.exe in Node mode)
```

- `src/shared/claude.ts`: tool definitions (names, descriptions, JSON schemas), the pipe protocol and
  the Claude Desktop config helpers. Shared by every side.
- `src/mcp/`: the MCP server. `protocol.ts` is JSON-RPC over stdio (tools only, no dependencies);
  `kinora-mcp.ts` connects to the app, starting it when needed. Built by `vite.mcp.config.mts` into
  `out/mcp/kinora-mcp.cjs`, shipped unpacked as `resources\mcp\kinora-mcp.cjs`, and started as
  `Kinora.exe kinora-mcp.cjs` with `ELECTRON_RUN_AS_NODE=1` (no separate Node install).
- `src/main/handlers/claude.ts`: the pipe server (token check, one connection per Claude app),
  forwarding calls to the renderer, file approvals, and Connect / Remove for Claude Desktop.
- `src/renderer/src/ui/claude/`: `tools.ts` runs each tool with the editor's own actions;
  `store.ts` serialises calls, tracks connected apps and the user's approvals.

**Adding a tool:** add its definition to `TOOLS` in `src/shared/claude.ts`, implement it in the
`TOOLS` table of `ui/claude/tools.ts`, and cover it in `scripts/e2e/claude.mjs`. The unit tests check
that every defined tool is implemented.

**Tests:** `npx vitest run tests/claude.test.ts` (config merge, protocol, definitions);
`npm run build && node scripts/e2e.mjs claude` (a full session through the real bridge);
`node scripts/e2e-claude-autostart.mjs` (Claude starts Kinora when it is closed).
