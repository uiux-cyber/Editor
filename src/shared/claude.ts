/**
 * Kinora as a Claude connector (MCP). Shared by three sides, so no runtime imports here:
 *
 *  - the MCP bridge (src/mcp/kinora-mcp.ts), a small script Claude Desktop / Claude Code start
 *    with Kinora's own executable (ELECTRON_RUN_AS_NODE). It answers `tools/list` by itself and
 *    forwards `tools/call` to the running app over a local named pipe (starting Kinora if needed);
 *  - the main process (src/main/handlers/claude.ts): pipe server, Claude Desktop config;
 *  - the renderer (src/renderer/src/ui/claude/), which runs the tools on the open project.
 */

export const MCP_SERVER_NAME = 'kinora';
/** In Kinora's user-data folder: where the running app's pipe is and the token to use it. */
export const BRIDGE_FILE = 'claude-bridge.json';
/** Settings key: Claude may control Kinora (off until the user connects Claude). */
export const CLAUDE_ENABLED_SETTING = 'claude.enabled';
/** MCP protocol versions this server speaks (tools only), newest first. */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export interface BridgeInfo {
  /** Named pipe of the running app (absent while Claude access is off). */
  pipe?: string;
  token?: string;
  pid: number;
  version: string;
  enabled: boolean;
}

/** bridge → app, one JSON object per line */
export type BridgeRequest = { type: 'hello'; token: string; client: string } | { type: 'call'; id: number; tool: string; args: Record<string, unknown> };
/** app → bridge */
export type BridgeResponse = { type: 'welcome'; version: string } | { type: 'denied'; message: string } | { type: 'result'; id: number; result: ToolResult };

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export const textResult = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }],
  ...(isError ? { isError: true } : {}),
});

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

type Schema = Record<string, unknown>;
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
const num = (description: string, extra: Schema = {}): Schema => ({ type: 'number', description, ...extra });
const bool = (description: string): Schema => ({ type: 'boolean', description });
const ids = (description: string): Schema => ({ type: 'array', items: { type: 'string' }, description, minItems: 1 });

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  annotations: { title: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
}

const tool = (name: string, title: string, description: string, inputSchema: Schema, hints: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean } = {}): ToolDef => ({
  name,
  title,
  description,
  inputSchema,
  annotations: {
    title,
    ...(hints.readOnly ? { readOnlyHint: true } : {}),
    ...(hints.destructive !== undefined ? { destructiveHint: hints.destructive } : {}),
    ...(hints.idempotent ? { idempotentHint: true } : {}),
    openWorldHint: false,
  },
});

export const LIBRARY_KINDS = ['templates', 'text_styles', 'stickers', 'sounds', 'backgrounds', 'transitions', 'effects', 'filters'] as const;
export const ASPECT_IDS = ['16:9', '9:16', '1:1', '4:5', '21:9'] as const;

export const TOOLS: ToolDef[] = [
  tool('get_status', 'Kinora status', 'What Kinora is doing right now: screen (home or editor), playhead, selection, background tasks (captions, vision, exports) with progress, and the last changes in the undo history. Call this first, and again to follow long tasks.', obj({}), { readOnly: true }),
  tool(
    'get_project',
    'Read the project',
    'The open project: settings (size, fps, duration), tracks, clips (id, type, track, start, duration, text, source media, speed, volume…), media in the bin (id, name, kind, duration, path), markers and In/Out. Times are in seconds.',
    obj({ include_media_paths: bool('Include the file path of every media item (default true).') }),
    { readOnly: true },
  ),
  tool('list_commands', 'List editor commands', 'Every editor command (the same list as the command palette) with its id, title, menu group, whether it can run now, and its shortcut. Filter with a query. Run one with run_command.', obj({ query: str('Words to filter by, e.g. "caption", "silence", "split".') }), { readOnly: true }),
  tool(
    'run_command',
    'Run an editor command',
    'Run a command by id (see list_commands), exactly as if the user picked it. Most commands act on the selected clips or at the playhead, so select clips / set the playhead first. Smart features (auto captions, silence and filler detection, noise reduction, background removal, scene detection…) run in the background: follow them with get_status.',
    obj({ id: str('Command id, e.g. "clip.split", "smart.autoCaptions".') }, ['id']),
    { destructive: false },
  ),
  tool(
    'search_library',
    'Search the content library',
    "Find ids in Kinora's built-in library: templates, text_styles, stickers, sounds (music and effects), backgrounds (animated), transitions, effects and filters.",
    obj({ kind: { type: 'string', enum: [...LIBRARY_KINDS] }, query: str('Words to match in names, categories and tags.'), limit: num('Most results to return (default 30, max 100).', { minimum: 1, maximum: 100 }) }, ['kind']),
    { readOnly: true },
  ),
  tool(
    'new_project',
    'New project',
    'Start a new empty project. If the current one has unsaved changes, Kinora asks the user first.',
    obj({ name: str('Project name.'), aspect: { type: 'string', enum: [...ASPECT_IDS], description: 'Frame shape (default 16:9).' }, fps: num('Frame rate (default 30).', { enum: [24, 25, 30, 50, 60] }) }),
  ),
  tool('open_project', 'Open a project', 'Open a .kinora project file from disk. If the current project has unsaved changes, Kinora asks the user first.', obj({ path: str('Absolute path of the .kinora file.') }, ['path'])),
  tool(
    'save_project',
    'Save the project',
    'Save the project. Without a path it saves to its current file (a new project needs a path). Replacing a different existing file asks the user first.',
    obj({ path: str('Absolute path ending in .kinora (optional).') }),
    { destructive: false },
  ),
  tool(
    'import_media',
    'Import media',
    'Import video, audio, image, GIF or Lottie files into the media bin, optionally adding them to the end of the timeline one after another.',
    obj({ paths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Absolute file paths.' }, add_to_timeline: bool('Also place the files at the end of the main track, in order (default false).') }, ['paths']),
  ),
  tool(
    'add_item',
    'Add to the timeline',
    'Add something to the timeline: imported media (id from get_project), a template, text (with an optional text style), a sticker, a sound or an animated background (ids from search_library). Placed at `time` (default: the playhead) on a free track.',
    obj(
      {
        kind: { type: 'string', enum: ['media', 'template', 'text', 'sticker', 'sound', 'background'] },
        id: str('Media id or library id (optional for text).'),
        text: str('Text to show (kind "text"; replaces the style\'s sample text).'),
        time: num('Start time in seconds.', { minimum: 0 }),
        duration: num('Length in seconds (text, stickers, backgrounds, images).', { exclusiveMinimum: 0 }),
        track_id: str('Preferred track id.'),
        variant: num('Template look: 0 is the first variation, other numbers give other colours / fonts / layouts.', { minimum: 0 }),
        use_brand: bool("Style the template with the user's brand kit (when set up)."),
      },
      ['kind'],
    ),
  ),
  tool(
    'apply_to_clip',
    'Apply an effect, filter or transition',
    'Apply a library effect or filter to a clip, or put a transition between a clip and the next clip on its track. filter id "none" removes the filter.',
    obj({ kind: { type: 'string', enum: ['effect', 'filter', 'transition'] }, id: str('Library id from search_library.'), clip_id: str('The clip (for transitions: the clip before the cut).') }, ['kind', 'id', 'clip_id']),
  ),
  tool(
    'update_clip',
    'Change a clip',
    'Change properties of one clip. Only the fields you pass change. Position x / y are in design pixels from the frame centre (the shorter side of the frame is 1080).',
    obj(
      {
        clip_id: str('Clip id.'),
        start: num('Start time on the timeline (s).', { minimum: 0 }),
        duration: num('Length on the timeline (s).', { exclusiveMinimum: 0 }),
        name: str('Clip name.'),
        text: str('New text (text clips).'),
        font_size: num('Text size in design pixels.', { exclusiveMinimum: 0 }),
        color: str('Text colour, e.g. "#ffffff".'),
        volume: num('Volume, 1 = 100% (0 to 4).', { minimum: 0, maximum: 4 }),
        muted: bool('Mute the clip.'),
        opacity: num('Opacity 0 to 1.', { minimum: 0, maximum: 1 }),
        speed: num('Playback speed, e.g. 0.5 or 2 (video and audio).', { minimum: 0.1, maximum: 16 }),
        x: num('Horizontal position.'),
        y: num('Vertical position.'),
        scale: num('Size, 1 = 100%.', { exclusiveMinimum: 0 }),
        rotation: num('Rotation in degrees.'),
      },
      ['clip_id'],
    ),
  ),
  tool('delete_clips', 'Delete clips', 'Remove clips from the timeline (undoable; media files on disk are never touched).', obj({ clip_ids: ids('Clip ids.'), close_gap: bool('Pull later clips back to close the gap (default false).') }, ['clip_ids']), { destructive: true }),
  tool('split_clip', 'Split a clip', 'Cut a clip in two at a time (seconds, on the timeline). Linked sound is split too.', obj({ clip_id: str('Clip id.'), time: num('Where to cut.', { minimum: 0 }) }, ['clip_id', 'time'])),
  tool('select_clips', 'Select clips', 'Select clips (many commands act on the selection). An empty list clears the selection.', obj({ clip_ids: { type: 'array', items: { type: 'string' } } }, ['clip_ids']), { idempotent: true }),
  tool('set_playhead', 'Move the playhead', 'Move the playhead to a time in seconds.', obj({ time: num('Time in seconds.', { minimum: 0 }) }, ['time']), { idempotent: true }),
  tool(
    'capture_frame',
    'Look at a frame',
    'A picture of the video at a time (default: the playhead), as the viewer will see it, so you can check framing, text and colours.',
    obj({ time: num('Time in seconds.', { minimum: 0 }), width: num('Image width in pixels (default 960, max 1600).', { minimum: 160, maximum: 1600 }) }),
    { readOnly: true },
  ),
  tool(
    'export_video',
    'Export',
    'Render the project to a file in the background (follow it with get_status). Use platform presets (several at once go into one folder, one file each, reframed for their shape) or a format. Replacing an existing file asks the user first.',
    obj({
      path: str('Output file for a single export, e.g. "C:\\Users\\me\\Videos\\Promo.mp4".'),
      folder: str('Output folder when exporting several presets.'),
      presets: { type: 'array', items: { type: 'string', enum: ['youtube-1080p', 'youtube-4k', 'youtube-shorts', 'tiktok', 'instagram-reels', 'instagram-portrait', 'instagram-square', 'facebook', 'linkedin'] }, description: 'Platform presets.' },
      format: { type: 'string', enum: ['mp4-avc', 'mp4-hevc', 'mp4-av1', 'webm-vp9', 'mov-avc', 'webm-alpha', 'gif', 'mp3', 'wav', 'png'], description: 'Format when not using presets (default mp4-avc).' },
      aspect: { type: 'string', enum: ['source', '16:9', '9:16', '1:1', '4:5'], description: 'Reframe to this shape (format exports).' },
      range: { type: 'string', enum: ['all', 'inout', 'selection'], description: 'What to export (default: In/Out when set, else everything).' },
      burn_in_captions: bool('Draw captions into the picture (default true).'),
    }),
    { destructive: false },
  ),
  tool('undo', 'Undo', 'Undo the last change(s), as Ctrl+Z.', obj({ steps: num('How many steps (default 1).', { minimum: 1, maximum: 50 }) })),
  tool('redo', 'Redo', 'Redo undone change(s), as Ctrl+Shift+Z.', obj({ steps: num('How many steps (default 1).', { minimum: 1, maximum: 50 }) })),
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export const SERVER_INSTRUCTIONS = [
  "Kinora is a video editor running on the user's Windows PC; these tools edit the project open in it.",
  'Start with get_status and get_project. Times are in seconds; positions are in design pixels (shorter frame side = 1080).',
  'Every change is one undo step in Kinora\'s History panel, labelled "Claude: …", so the user can review or revert it.',
  'Captions, silence/filler detection, vision features and exports run in the background: poll get_status until they finish before relying on the result.',
  'Use capture_frame to check how things look. Replacing or deleting files on disk always asks the user in Kinora first.',
].join(' ');

// ---------------------------------------------------------------------------------------------
// Claude Desktop extension (.mcpb): the one-click way to connect
// ---------------------------------------------------------------------------------------------

export const REPO_URL = 'https://github.com/uiux-cyber/Editor';
export const EXTENSION_FILE = 'Kinora.mcpb';

export interface ExtensionOptions {
  version: string;
  /** Kinora's executable (started when Claude needs Kinora and it is closed). */
  exe: string;
  /** The MCP server shipped with the installed Kinora (kept current by Kinora's updates). */
  script: string;
  userData: string;
  /** Extra arguments to start the app with (development builds). */
  appArgs?: string[];
}

/**
 * manifest.json of the Claude Desktop extension Kinora builds for this PC (MCP Bundle format,
 * manifest_version 0.3). Claude runs server/index.js with its own Node.js; the paths of this
 * Kinora installation are filled in, so nothing has to be configured by hand.
 */
export function extensionManifest(o: ExtensionOptions): Record<string, unknown> {
  return {
    manifest_version: '0.3',
    name: 'kinora',
    display_name: 'Kinora',
    version: o.version,
    description: 'Edit, caption and export videos in Kinora, the video editor on your PC.',
    long_description:
      'Lets Claude work in Kinora: read the timeline, look at frames, add templates, text, music and effects, run captions and other smart features, and export for every platform. Every change is undoable in Kinora, and replacing a file always asks you first.',
    author: { name: 'Kinora contributors', url: REPO_URL },
    repository: { type: 'git', url: `${REPO_URL}.git` },
    homepage: REPO_URL,
    documentation: `${REPO_URL}/blob/main/docs/CLAUDE-CONNECTOR.md`,
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js'],
        env: {
          KINORA_EXE: o.exe,
          KINORA_MCP_SCRIPT: o.script,
          KINORA_USER_DATA: o.userData,
          ...(o.appArgs?.length ? { KINORA_APP_ARGS: JSON.stringify(o.appArgs) } : {}),
        },
      },
    },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    keywords: ['video', 'video editor', 'captions', 'export', 'kinora'],
    license: 'MIT',
    compatibility: { platforms: ['win32'], runtimes: { node: '>=18.0.0' } },
  };
}

/** server/index.js of the extension: run the installed Kinora's MCP server, else the bundled copy. */
export const EXTENSION_LOADER = `'use strict';
// Kinora for Claude. Runs the MCP server that ships with the installed Kinora, so it stays current
// with Kinora's updates; falls back to the copy in this extension when Kinora's can't be found.
const fs = require('fs');
const path = require('path');
const installed = process.env.KINORA_MCP_SCRIPT;
const bundled = path.join(__dirname, 'kinora-mcp.cjs');
const target = installed && fs.existsSync(installed) ? installed : bundled;
if (target === bundled) process.stderr.write('[kinora] Kinora\\'s MCP server was not found at ' + installed + '; using the copy in this extension.\\n');
require(target);
`;

// ---------------------------------------------------------------------------------------------
// Claude Desktop configuration (Kinora 1.3.0 wrote entries here; now only cleaned up)
// ---------------------------------------------------------------------------------------------

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Add (or replace) Kinora's entry in a claude_desktop_config.json text, keeping everything else.
 * Throws when the existing text is not a JSON object, so a file we can't read is never replaced.
 */
export function withKinoraEntry(configText: string | null, entry: McpServerEntry): string {
  const config = parseConfig(configText);
  const servers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers) ? (config.mcpServers as Record<string, unknown>) : {};
  config.mcpServers = { ...servers, [MCP_SERVER_NAME]: entry };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Remove Kinora's entry (null when there is nothing to change). */
export function withoutKinoraEntry(configText: string | null): string | null {
  if (!configText?.trim()) return null;
  const config = parseConfig(configText);
  const servers = config.mcpServers as Record<string, unknown> | undefined;
  if (!servers || typeof servers !== 'object' || !(MCP_SERVER_NAME in servers)) return null;
  const { [MCP_SERVER_NAME]: _removed, ...rest } = servers;
  config.mcpServers = rest;
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Kinora's entry in a config text, if any (unparseable text counts as none). */
export function kinoraEntryOf(configText: string | null): McpServerEntry | null {
  try {
    const servers = parseConfig(configText).mcpServers as Record<string, McpServerEntry> | undefined;
    return servers?.[MCP_SERVER_NAME] ?? null;
  } catch {
    return null;
  }
}

function parseConfig(text: string | null): Record<string, unknown> {
  if (!text || !text.trim()) return {};
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('claude_desktop_config.json does not contain a JSON object');
  return value as Record<string, unknown>;
}

/** Shell command that adds Kinora to Claude Code (user scope). */
export function claudeCodeCommand(entry: McpServerEntry): string {
  const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
  const env = Object.entries(entry.env ?? {})
    .map(([k, v]) => `-e ${k}=${/[\s"]/.test(v) ? q(v) : v}`)
    .join(' ');
  return `claude mcp add --scope user ${env} ${MCP_SERVER_NAME} -- ${[entry.command, ...entry.args].map(q).join(' ')}`.replace(/ {2,}/g, ' ');
}
