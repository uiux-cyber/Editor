/**
 * Claude connection, renderer side: which Claude apps are connected, what Claude is doing, and
 * approvals the user must give (replacing a file). Tool calls arrive from the main process
 * (`x:claude:call`) and run one at a time, so parallel calls never edit the project concurrently.
 */

import { create } from 'zustand';
import { api, hasBridge } from '@/platform/api';
import { useUI } from '@/store/ui';
import { TOOLS, type ToolResult } from '@shared/claude';
import { t } from '../i18n';

export interface ClaudeClient {
  id: number;
  name: string;
  since: number;
}

export interface Approval {
  id: number;
  kind: 'replace';
  path: string;
  /** e.g. "the export", "the project" */
  what: string;
  client: string;
  resolve: (ok: boolean) => void;
}

interface ClaudeState {
  clients: ClaudeClient[];
  /** After Connect: Claude Desktop was asked to install the extension, or the user must drag it in. */
  connectStep: 'idle' | 'opened' | 'manual';
  /** The last Claude app that connected (null until Claude has used Kinora). */
  lastSeen: { name: string; at: number } | null;
  /** The tool running now (title), if any. */
  running: string | null;
  /** Last finished action, for the title-bar tooltip. */
  last: { title: string; ok: boolean; at: number } | null;
  approvals: Approval[];
}

export const useClaude = create<ClaudeState>()(() => ({ clients: [], connectStep: 'idle', lastSeen: null, running: null, last: null, approvals: [] }));

/**
 * Connect Kinora to Claude Desktop: Kinora builds its Claude extension and opens it, so Claude
 * Desktop shows its Install dialog. Falls back to "drag Kinora.mcpb into Claude" when Windows
 * can't open the file with Claude Desktop.
 */
export async function connectClaudeDesktop(): Promise<'opened' | 'manual' | 'error'> {
  const toast = useUI.getState().toast;
  try {
    const res = await api.call<{ opened: boolean }>('x:claude:installExtension');
    const step = res.opened ? 'opened' : 'manual';
    useClaude.setState({ connectStep: step });
    if (res.opened) toast({ kind: 'info', message: t('Claude Desktop is asking to install Kinora'), detail: t('Click Install in Claude Desktop, then ask Claude to edit in Kinora.'), timeout: 12000 });
    return step;
  } catch (err) {
    toast({ kind: 'error', message: t('Couldn’t connect to Claude'), detail: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) });
    return 'error';
  }
}

const TITLES = new Map(TOOLS.map((t) => [t.name, t.title]));
let currentClient = 'Claude';
let nextApproval = 1;

/** Ask the user (in Kinora) to approve something a tool wants to do. */
export function requestApproval(req: { kind: 'replace'; path: string; what: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const approval: Approval = { ...req, id: nextApproval++, client: currentClient, resolve };
    useClaude.setState((s) => ({ approvals: [...s.approvals, approval] }));
    void api.call('x:claude:attention').catch(() => undefined);
  });
}

export function answerApproval(id: number, ok: boolean): void {
  const a = useClaude.getState().approvals.find((x) => x.id === id);
  if (!a) return;
  useClaude.setState((s) => ({ approvals: s.approvals.filter((x) => x.id !== id) }));
  a.resolve(ok);
}

interface Call {
  callId: number;
  tool: string;
  args: Record<string, unknown>;
  client: string;
}

let chain: Promise<void> = Promise.resolve();

function onCall(call: Call): void {
  chain = chain.then(async () => {
    currentClient = call.client || 'Claude';
    const title = TITLES.get(call.tool) ?? call.tool;
    useClaude.setState({ running: title });
    let result: ToolResult;
    try {
      // Loaded on first use: the tools pull in most of the editor.
      const { runTool } = await import('./tools');
      result = await runTool(call.tool, call.args ?? {});
    } catch (err) {
      result = { content: [{ type: 'text', text: `Kinora could not run "${call.tool}": ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
    useClaude.setState({ running: null, last: { title, ok: !result.isError, at: Date.now() } });
    await api.call('x:claude:reply', call.callId, result).catch(() => undefined);
  });
}

let started = false;

/** Start serving Claude's tool calls. Call once at startup. */
export function initClaude(): () => void {
  if (started || !hasBridge) return () => undefined;
  started = true;
  const offClients = api.on('x:claude:clients', (clients: ClaudeClient[]) => {
    const first = clients[0];
    useClaude.setState(first ? { clients, lastSeen: { name: first.name, at: first.since } } : { clients });
  });
  const offCall = api.on('x:claude:call', (call: Call) => onCall(call));
  void api
    .call<{ clients: ClaudeClient[]; lastSeen: ClaudeState['lastSeen'] }>('x:claude:status')
    .then((s) => useClaude.setState({ clients: s.clients, lastSeen: s.lastSeen }))
    .catch(() => undefined);
  void api.call('x:claude:ready').catch(() => undefined);
  return () => {
    offClients();
    offCall();
    started = false;
  };
}
