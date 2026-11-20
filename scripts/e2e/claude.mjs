/**
 * Kinora as a Claude connector, end to end: Settings → Claude → Connect builds the Claude Desktop
 * extension (Kinora.mcpb) and removes the config entries Kinora 1.3.0 wrote (a test folder,
 * KINORA_CLAUDE_CONFIG_DIR). The extension is unpacked with Windows' own ZIP support and started
 * the way Claude Desktop does (`node ${__dirname}/server/index.js` with the manifest's environment),
 * then driven like Claude would: handshake, tools/list, a new project, import, text, library,
 * edits, a frame, split / undo, a command, export (with the "replace?" approval denied, then
 * given), save, delete, the connection status in Settings, and Claude access off.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

let configDir = null;
const bridges = [];

export async function prepare({ outDir }) {
  configDir = path.join(outDir, 'claude-config');
  rmSync(configDir, { recursive: true, force: true });
  mkdirSync(configDir, { recursive: true });
  // A config with the entry Kinora 1.3.0 wrote, another server and a setting: Connect removes
  // only Kinora's entry.
  writeFileSync(
    path.join(configDir, 'claude_desktop_config.json'),
    JSON.stringify({ globalShortcut: 'Ctrl+Alt+Space', mcpServers: { other: { command: 'npx', args: ['other-server'] }, kinora: { command: 'old-kinora.exe', args: [] } } }, null, 2),
  );
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
  expect((await win.getAttribute('[data-claude-state]', 'data-claude-state')) === 'new', 'Settings says Claude is not connected yet');
  await shot('claude-01-settings');
  await win.keyboard.press('Escape');
  // The start screen invites the user to connect; one click does it and shows the next step.
  await win.waitForSelector('.claude-card', { timeout: 5000 });
  expect(true, 'the start screen offers "Edit with Claude"');
  await shot('claude-00-home-card');
  const bundle = path.join(outDir, 'Kinora.mcpb');
  rmSync(bundle, { force: true });
  await win.click('[data-action="claude-card-connect"]');
  // In tests the file is not handed to Claude Desktop, so Settings shows the manual way.
  await win.waitForSelector('[data-action="claude-show-file"]', { timeout: 10000 });
  expect(true, 'Connect on the card opens Settings → Claude with the next step');
  expect(existsSync(bundle), 'Connect builds Kinora.mcpb');
  status = await run(() => window.kinora.call('x:claude:status'));
  expect(status.enabled, 'Connect turns Claude access on');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  expect(!config.mcpServers.kinora && config.mcpServers.other?.command === 'npx' && config.globalShortcut === 'Ctrl+Alt+Space', 'the old 1.3.0 config entry is removed, everything else kept');

  // Unpack it the way Windows does (Expand-Archive) and read the manifest.
  const unpacked = path.join(outDir, 'kinora-extension');
  rmSync(unpacked, { recursive: true, force: true });
  const zipCopy = path.join(outDir, 'kinora-extension.zip');
  writeFileSync(zipCopy, readFileSync(bundle));
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath "${zipCopy}" -DestinationPath "${unpacked}" -Force`], { stdio: 'ignore' });
  const manifest = JSON.parse(readFileSync(path.join(unpacked, 'manifest.json'), 'utf8'));
  expect(manifest.manifest_version === '0.3' && manifest.name === 'kinora' && manifest.server.type === 'node' && manifest.tools.length === 24, `the bundle unpacks with Windows' ZIP support and has a valid manifest (v${manifest.version})`);
  expect(existsSync(path.join(unpacked, 'server', 'index.js')) && existsSync(path.join(unpacked, 'server', 'kinora-mcp.cjs')) && existsSync(path.join(unpacked, 'icon.png')), 'the bundle holds the loader, the server and the icon');
  const cfg = manifest.server.mcp_config;
  expect(existsSync(cfg.env.KINORA_EXE) && existsSync(cfg.env.KINORA_MCP_SCRIPT), 'the manifest points at this Kinora and its server');
  // Claude Desktop runs `node` (its own) with ${__dirname} replaced by the unpacked folder.
  const entry = { command: process.execPath, args: cfg.args.map((a) => a.replace('${__dirname}', unpacked)), env: cfg.env };
  await win.keyboard.press('Escape');

  // ---- MCP session through the extension, started like Claude Desktop ------------------------
  const b = startBridge(entry);
  const init = await b.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1.0' } });
  expect(init.result?.serverInfo?.name === 'kinora' && init.result.protocolVersion === '2025-06-18', `handshake with Kinora ${init.result?.serverInfo?.version}`);
  b.notify('notifications/initialized');
  const list = await b.request('tools/list');
  expect(list.result.tools.length === 24, `Claude sees ${list.result.tools.length} tools`);
  expect(!!init.result?.capabilities?.prompts, 'Kinora offers ready-made requests (prompts)');
  const prompts = await b.request('prompts/list');
  expect(prompts.result?.prompts?.length === 9, `Claude lists ${prompts.result?.prompts?.length} ready-made requests`);
  const prompt = await b.request('prompts/get', { name: 'animated_title', arguments: { text: 'Hello Kinora' } });
  expect(/“Hello Kinora”/.test(prompt.result?.messages?.[0]?.content?.text ?? ''), 'a ready-made request is filled in with what the user typed');

  let s = json(await b.call('get_status'));
  expect(s.screen === 'home', 'get_status reports the start screen');
  await win.waitForSelector('.claude-btn', { timeout: 5000 });
  expect(true, 'the title bar shows Claude is connected');
  await win.waitForSelector('.claude-card', { state: 'detached', timeout: 5000 });
  expect(true, 'the start-screen card goes away once Claude is connected');

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

  // ---- Motion clips through Claude's tools ------------------------------------------------------
  const { MOTION_EXAMPLES } = await import(pathToFileURL(path.join(process.cwd(), 'src/shared/motion.ts')).href);
  r = await b.call('motion_guide');
  expect(!r.isError && /three\.js/.test(textOf(r)) && /export default async function setup\(k\)/.test(textOf(r)), 'motion_guide explains the module format and the libraries');
  // Save first, so starting a new project doesn't stop at Kinora's "save changes?" question.
  await b.call('save_project');
  r = await b.call('new_project', { name: 'Motion test', aspect: '16:9' });
  expect(!r.isError, 'a fresh project for the Motion clip');
  const box = MOTION_EXAMPLES.find((e) => e.name.startsWith('3D'));
  r = await b.call('create_motion', { name: 'Glossy box', code: box.code, duration: 3, time: 0 }, 180000);
  const created = r.isError ? null : JSON.parse(textOf(r).slice(textOf(r).indexOf('{')));
  expect(!!created && r.content.some((c) => c.type === 'image'), `create_motion tests the code, saves it and returns a preview (media ${created?.media_id})`);
  expect(existsSync(created.file) && created.file.endsWith('.kmotion'), 'the clip is saved as a .kmotion file');
  let proj = json(await b.call('get_project'));
  const motionClip = proj.clips.find((c) => c.id === created.clip_id);
  expect(!!motionClip && motionClip.duration === 3 && proj.media.some((m) => m.id === created.media_id && m.kind === 'animation'), 'the clip is on the timeline as a 3 s animation layer');

  r = await b.call('update_motion', { media_id: created.media_id, code: 'export default function setup(k) {\n  return (t) => {\n    k.ctx2d().fillRect(0, 0, missing.x, 1);\n  };\n}\n' });
  expect(r.isError && /missing is not defined/.test(textOf(r)) && /line 3/.test(textOf(r)), 'a broken update is refused with the error and its line, and the clip is unchanged');
  const chart = MOTION_EXAMPLES.find((e) => e.name.startsWith('Animated bar'));
  r = await b.call('update_motion', { media_id: created.media_id, code: chart.code, duration: 4 });
  expect(!r.isError && r.content.some((c) => c.type === 'image'), 'update_motion replaces the code and returns a new preview');
  proj = json(await b.call('get_project'));
  expect(proj.clips.find((c) => c.id === created.clip_id)?.duration === 4, 'the timeline clip follows the new 4 s length');
  r = await b.call('get_motion', { media_id: created.media_id });
  expect(/d3\.scaleBand/.test(textOf(r)), 'get_motion returns the current code');
  r = await b.call('undo');
  r = await b.call('get_motion', { media_id: created.media_id });
  expect(/RoundedBoxGeometry/.test(textOf(r)), 'undo brings the previous version of the clip back');
  r = await b.call('redo');

  // The clip is rendered into exports: a still at 2.5 s shows the chart's bars.
  await b.call('set_playhead', { time: 2.5 });
  const still = path.join(outDir, 'claude-motion-still.png');
  rmSync(still, { force: true });
  r = await b.call('export_video', { path: still, format: 'png' });
  expect(!r.isError, 'a still of the Motion clip is exported');
  await waitExport(still);
  const bright = await run(async (file) => {
    const res = await fetch(window.kinora.media.toUrl(file));
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 300) n++;
    return n / (bmp.width * bmp.height);
  }, still);
  if (!(bright > 0.03)) console.log('  motion state:', JSON.stringify(await run(() => window.__kinora.motion.motionDebug())), JSON.stringify(json(await b.call('get_status')).tasks.slice(-2)));
  expect(bright > 0.03, `the exported frame contains the Motion clip (${(bright * 100).toFixed(1)}% bright pixels)`);
  r = await b.call('capture_frame', { time: 2.5, width: 640 });
  expect(r.content.some((c) => c.type === 'image'), 'capture_frame shows the Motion clip in the preview');
  writeFileSync(path.join(outDir, 'claude-motion-frame.jpg'), Buffer.from(r.content.find((c) => c.type === 'image').data, 'base64'));

  // Settings: Claude declares them, then changes a value without new code.
  const kinetic = MOTION_EXAMPLES.find((e) => e.name === 'Kinetic title');
  r = await b.call('update_motion', { media_id: created.media_id, code: kinetic.code, params: kinetic.params, duration: 4 }, 120000);
  expect(!r.isError && /"values"/.test(textOf(r)), `update_motion declares the clip's settings${r.isError ? ` (${textOf(r)})` : ''}`);
  r = await b.call('update_motion', { media_id: created.media_id, values: { title: 'CLAUDE WAS HERE', accent: '#ff3366' } });
  const changedInfo = r.isError ? null : JSON.parse(textOf(r).slice(textOf(r).indexOf('{')));
  expect(!!changedInfo && !changedInfo.file && changedInfo.values.title === 'CLAUDE WAS HERE', 'update_motion changes setting values without writing new code');
  r = await b.call('get_motion', { media_id: created.media_id });
  expect(/setting values: .*CLAUDE WAS HERE/.test(textOf(r)) && /"id":"accent"/.test(textOf(r)), 'get_motion shows the settings and their values');
  r = await b.call('update_motion', { media_id: created.media_id, values: { nope: 1 } });
  expect(r.isError && /no setting "nope"/.test(textOf(r)) && /title/.test(textOf(r)), 'an unknown setting is refused with the list of settings');
  const values = await run((id) => window.__kinora.useProjectStore.getState().project.assets[id].motionValues, created.media_id);
  expect(values?.title === 'CLAUDE WAS HERE', 'the values are stored on the clip, as if the user had changed them');

  // ---- Status in Settings, then turning access off ---------------------------------------------
  await win.click('[data-action="settings"]');
  await win.click('[data-section="claude"]');
  await win.waitForSelector('[data-claude-state="connected"]', { timeout: 5000 });
  expect(true, 'Settings shows Claude Desktop as connected');
  await shot('claude-04-connected');
  await win.keyboard.press('Escape');
  await run(() => window.kinora.call('x:claude:setEnabled', false));
  await sleep(300);
  r = await b.call('get_status');
  expect(r.isError && /turned off/.test(textOf(r)), 'with Claude access off, calls are refused with a clear message');
  expect(!(await win.locator('.claude-btn').count()), 'the title-bar indicator goes away');
  status = await run(() => window.kinora.call('x:claude:status'));
  expect(status.lastSeen?.name === 'claude-ai', 'Kinora remembers which Claude app used it last');
  b.child.stdin.end();
}
