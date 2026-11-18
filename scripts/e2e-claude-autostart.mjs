#!/usr/bin/env node
/**
 * Claude starts Kinora: with no Kinora running, a tool call through the MCP server (on plain Node.js,
 * as in Claude Desktop's extension) starts the app
 * (development build, isolated profile, off-screen) and runs once the app is up.
 *
 *   npm run build && node scripts/e2e-claude-autostart.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = path.join(os.tmpdir(), `kinora-autostart-${process.pid}`);
mkdirSync(userData, { recursive: true });
// Claude access already allowed in this profile (as after "Connect").
writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ 'claude.enabled': true }));

// Run the server the way Claude Desktop's extension does: on plain Node.js (not Kinora's
// executable), told where Kinora is through KINORA_EXE.
const bridge = spawn(process.execPath, [path.join(root, 'out', 'mcp', 'kinora-mcp.cjs')], {
  env: {
    ...process.env,
    KINORA_EXE: electronPath,
    KINORA_USER_DATA: userData,
    KINORA_APP_ARGS: JSON.stringify([root]),
    // Inherited by the app the bridge starts: off-screen, no updates, test dialogs.
    KINORA_E2E_DIR: path.join(root, '.e2e'),
    KINORA_E2E_HIDDEN: process.env.KINORA_E2E_SHOW === '1' ? '0' : '1',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let log = '';
bridge.stderr.on('data', (d) => (log += d));
const waiting = new Map();
readline.createInterface({ input: bridge.stdout }).on('line', (line) => {
  const msg = JSON.parse(line);
  waiting.get(msg.id)?.(msg);
});
let nextId = 0;
const request = (method, params, timeout) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}\n${log}`)), timeout);
    waiting.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

let failed = false;
let appPid = null;
try {
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } }, 10000);
  const started = Date.now();
  const res = await request('tools/call', { name: 'get_status', arguments: {} }, 120000);
  const text = res.result?.content?.[0]?.text ?? '';
  if (res.result?.isError) throw new Error(`get_status failed: ${text}`);
  const status = JSON.parse(text);
  appPid = JSON.parse(readFileSync(path.join(userData, 'claude-bridge.json'), 'utf8')).pid;
  console.log(`  ✓ Kinora was started by the bridge (pid ${appPid}) and answered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (status.screen !== 'home') throw new Error(`unexpected screen ${status.screen}`);
  console.log('  ✓ get_status ran in the started app (start screen)');
  const again = await request('tools/call', { name: 'get_status', arguments: {} }, 10000);
  if (again.result?.isError) throw new Error('second call failed');
  console.log('  ✓ later calls reuse the connection');
  console.log('\n✔ Claude auto-start check passed');
} catch (err) {
  failed = true;
  console.error('\n✖ Claude auto-start check failed:', err?.message ?? err);
} finally {
  bridge.kill();
  try {
    appPid ??= JSON.parse(readFileSync(path.join(userData, 'claude-bridge.json'), 'utf8')).pid;
  } catch {
    /* the app never wrote its file */
  }
  // Close only the app this check started (and its helper processes).
  if (appPid) {
    try {
      execFileSync('taskkill', ['/PID', String(appPid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  rmSync(userData, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
