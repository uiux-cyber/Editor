/**
 * Kinora as a Claude connector, end to end: Settings → Claude → Connect writes the Claude Desktop
 * config (a test folder, KINORA_CLAUDE_CONFIG_DIR), then the MCP bridge is started with exactly the
 * command written there and driven like Claude would: handshake, tools/list, a new project, import,
 * text, library, edits, a frame, split / undo, a command, export (with the "replace?" approval
 * denied, then given), save, delete, Claude access off, and Disconnect.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

let configDir = null;
const bridges = [];

export async function prepare({ outDir }) {
  configDir = path.join(outDir, 'claude-config');
  rmSync(configDir, { recursive: true, force: true });
  mkdirSync(configDir, { recursive: true });
  // An existing config with another server and a setting: both must survive.
  writeFileSync(path.join(configDir, 'claude_desktop_config.json'), JSON.stringify({ globalShortcut: 'Ctrl+Alt+Space', mcpServers: { other: { command: 'npx', args: ['other-server'] } } }, null, 2));
  return { KINORA_CLAUDE_CONFIG_DIR: configDir };
}

export async function cleanup() {
  for (const b of bridges) b.child.kill();
}

/** A minimal MCP client over the bridge's stdio. */
function startBridge(entry) {
  const child = spawn(entry.command, entry.args, { env: { ...process.env, ...entry.env, KINORA_MCP_NO_LAUNCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const waiting = new Map();
  let nextId = 0;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  const request = (method, params, timeout = 60000) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => reject(new Error(`no answer to ${method} (bridge log: ${stderr.slice(-400)})`)), timeout);
      waiting.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  const call = async (name, args = {}, timeout = 120000) => {
    const m = await request('tools/call', { name, arguments: args }, timeout);
    if (m.error) throw new Error(`${name}: ${m.error.message}`);
    return m.result;
  };
  const b = { child, request, notify, call, stderr: () => stderr };
  bridges.push(b);
  return b;
}

const textOf = (result) => result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const json = (result) => JSON.parse(textOf(result));

export default async function claude({ win, run, shot, sleep, outDir }) {
  const expect = (ok, msg) => {
    if (!ok) throw new Error(`expectation failed: ${msg}`);
    console.log(`  ✓ ${msg}`);
  };
  const configFile = path.join(configDir, 'claude_desktop_config.json');

  await win.waitForSelector('.home', { timeout: 20000 });

  // ---- Fixture: a 4 s clip rendered by the app itself ----------------------------------------
  const clipFile = path.join(outDir, 'claude-fixture.mp4');
  await run(
    async ({ clipFile }) => {
      const k = window.__kinora;
      await k.projectIO.newProject({ name: 'Fixture', width: 1280, height: 720, fps: 30 });
      k.actions.addGenerator('aurora', { time: 0 });
      await k.actions.addSound('ding', { time: 0.5 });
      const project = k.useProjectStore.getState().project;
      const base = { videoCodec: 'avc', width: 1280, height: 720, fps: 30, quality: 'medium', audio: true, start: 0, end: 4, hardware: 'no-preference', fastStart: false };
      await k.exporter.exportProject(project, { ...base, container: 'mp4' }, clipFile, () => {}, new AbortController().signal);
      k.useProjectStore.getState().markSaved(null);
      k.useUI.getState().set({ screen: 'home' });
    },
    { clipFile },
  );
  expect(existsSync(clipFile), 'fixture clip rendered');

  // ---- Settings → Claude → Connect ----------------------------------------------------------
  await win.click('[data-action="settings"]');
  await win.click('[data-section="claude"]');
  await win.waitForSelector('[data-action="claude-connect"]', { timeout: 10000 });
  let status = await run(() => window.kinora.call('x:claude:status'));
  expect(status.enabled === false, 'Claude access is off until the user connects');
  await shot('claude-01-settings');
  await win.click('[data-action="claude-connect"]');
  await win.waitForSelector('[data-action="claude-disconnect"]', { timeout: 10000 });
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const entry = config.mcpServers?.kinora;
  expect(!!entry && entry.env?.ELECTRON_RUN_AS_NODE === '1' && entry.args[0].endsWith('kinora-mcp.cjs'), 'Connect adds Kinora to claude_desktop_config.json');
  expect(config.globalShortcut === 'Ctrl+Alt+Space' && config.mcpServers.other?.command === 'npx', 'the rest of the Claude Desktop config is kept');
  status = await run(() => window.kinora.call('x:claude:status'));
  expect(status.enabled && status.desktopConnected, 'Claude access is on and Kinora shows as connected');
  await win.keyboard.press('Escape');

  // ---- MCP session through the real bridge --------------------------------------------------
  const b = startBridge(entry);
  const init = await b.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1.0' } });
  expect(init.result?.serverInfo?.name === 'kinora' && init.result.protocolVersion === '2025-06-18', `handshake with Kinora ${init.result?.serverInfo?.version}`);
  b.notify('notifications/initialized');
  const list = await b.request('tools/list');
  expect(list.result.tools.length === 20, `Claude sees ${list.result.tools.length} tools`);

  let s = json(await b.call('get_status'));
  expect(s.screen === 'home', 'get_status reports the start screen');
  await win.waitForSelector('.claude-btn', { timeout: 5000 });
  expect(true, 'the title bar shows Claude is connected');

  let r = await b.call('add_item', { kind: 'text', text: 'too early' });
  expect(r.isError && /new_project/.test(textOf(r)), 'editing without a project explains what to do');

  r = await b.call('new_project', { name: 'Claude test', aspect: '9:16', fps: 30 });
  expect(!r.isError, 'new_project creates a 9:16 project');
  r = await b.call('import_media', { paths: [clipFile, 'C:\\does-not-exist\\nope.mp4'], add_to_timeline: true });
  const imported = json(r);
  expect(imported.imported.length === 1 && imported.clips_added.length >= 1, 'import_media imports the clip and places it on the timeline');
  expect(imported.problems?.some((p) => p.includes('not found')), 'a missing file is reported, not fatal');

  r = await b.call('add_item', { kind: 'text', text: 'Hello from Claude', time: 0, duration: 3 });
  const textClip = json(r).added[0];
  expect(textClip?.type === 'text' && textClip.text === 'Hello from Claude' && textClip.duration === 3, 'add_item adds the text');

  r = await b.call('search_library', { kind: 'stickers', query: 'fire', limit: 3 });
  const sticker = json(r).results[0];
  expect(!!sticker, `search_library finds a sticker (${sticker?.id})`);
  r = await b.call('add_item', { kind: 'sticker', id: sticker.id, time: 1, duration: 2 });
  expect(!r.isError, 'add_item adds the sticker');

  r = await b.call('update_clip', { clip_id: textClip.id, font_size: 120, color: '#ff3366', y: -500 });
  const updated = json(r).clip;
  expect(updated.font_size === 120 && updated.color === '#ff3366' && updated.position?.y === -500, 'update_clip restyles and moves the text');

  const project = json(await b.call('get_project'));
  const video = project.clips.find((c) => c.type === 'video');
  expect(project.settings.width === 1080 && project.settings.height === 1920 && !!video, 'get_project describes the 9:16 project and its clips');
  expect(project.media.some((m) => m.path?.endsWith('claude-fixture.mp4')), 'get_project lists the media with its path');

  r = await b.call('capture_frame', { time: 1.5, width: 540 });
  const img = r.content.find((c) => c.type === 'image');
  expect(img && img.mimeType === 'image/jpeg' && img.data.length > 4000, 'capture_frame returns a picture of the frame');
  writeFileSync(path.join(outDir, 'claude-frame.jpg'), Buffer.from(img.data, 'base64'));

  r = await b.call('split_clip', { clip_id: video.id, time: 2 });
  expect(json(r).clips.length >= 2, 'split_clip cuts the video in two');
  s = json(await b.call('get_status'));
  expect(s.recent_changes.at(-1).startsWith('Claude: '), `history labels Claude's edits ("${s.recent_changes.at(-1)}")`);
  r = await b.call('undo');
  expect(json(r).undone === 1, 'undo reverts the split');

  r = await b.call('set_playhead', { time: 1 });
  r = await b.call('run_command', { id: 'timeline.addMarker' });
  expect(!r.isError && json(await b.call('get_project')).markers.length === 1, 'run_command adds a marker at the playhead');
  r = await b.call('run_command', { id: 'no.such.command' });
  expect(r.isError, 'an unknown command is refused');

  // ---- Export, the "replace?" approval and save -----------------------------------------------
  const out = path.join(outDir, 'claude-export.mp4');
  rmSync(out, { force: true });
  const waitExport = async (file) => {
    for (let i = 0; i < 240; i++) {
      const st = json(await b.call('get_status'));
      const job = st.tasks.filter((t) => t.kind === 'export' && t.output === file).at(-1);
      if (job?.status === 'done') return job;
      if (job && (job.status === 'failed' || job.status === 'cancelled')) throw new Error(`export ${job.status}: ${job.error ?? ''}`);
      await sleep(500);
    }
    throw new Error('export did not finish');
  };
  r = await b.call('export_video', { path: out, format: 'mp4-avc' });
  expect(!r.isError && json(r).started.length === 1, 'export_video starts an export');
  await waitExport(out);
  const firstSize = statSync(out).size;
  expect(firstSize > 10000, `the export is written (${firstSize} bytes)`);

  let pending = b.call('export_video', { path: out, format: 'mp4-avc' });
  await win.waitForSelector('[data-action="claude-deny"]', { timeout: 10000 });
  await shot('claude-02-approval');
  await win.click('[data-action="claude-deny"]');
  r = await pending;
  expect(r.isError && /did not allow/.test(textOf(r)), 'replacing a file needs approval: "Keep the file" stops it');

  pending = b.call('export_video', { path: out, format: 'mp4-avc' });
  await win.waitForSelector('[data-action="claude-approve"]', { timeout: 10000 });
  await win.click('[data-action="claude-approve"]');
  r = await pending;
  expect(!r.isError, 'approving lets Claude replace the file');
  await waitExport(out);

  const saved = path.join(outDir, 'Claude test.kinora');
  rmSync(saved, { force: true });
  r = await b.call('save_project', { path: saved });
  expect(!r.isError && existsSync(saved), 'save_project writes the project file');

  r = await b.call('delete_clips', { clip_ids: [textClip.id] });
  expect(json(r).deleted.includes(textClip.id), 'delete_clips removes the text clip');
  await shot('claude-03-session');

  // ---- Turning access off, and Disconnect ------------------------------------------------------
  await run(() => window.kinora.call('x:claude:setEnabled', false));
  await sleep(300);
  r = await b.call('get_status');
  expect(r.isError && /turned off/.test(textOf(r)), 'with Claude access off, calls are refused with a clear message');
  expect(!(await win.locator('.claude-btn').count()), 'the title-bar indicator goes away');

  await run(() => window.kinora.call('x:claude:disconnectDesktop'));
  const after = JSON.parse(readFileSync(configFile, 'utf8'));
  expect(!after.mcpServers.kinora && after.mcpServers.other && after.globalShortcut, 'Disconnect removes only Kinora from the config');
  b.child.stdin.end();
}
