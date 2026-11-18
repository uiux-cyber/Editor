/**
 * Settings → Claude: connect Kinora to Claude Desktop with one click (Kinora builds a Claude
 * extension and Claude Desktop asks to install it), Claude Code's command, the on / off switch,
 * and what Claude can do.
 */

import { Check, CircleCheck, Copy, FolderOpen, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/platform/api';
import { connectClaudeDesktop, useClaude } from '../../claude/store';
import { Toggle } from '../../common/controls';
import { formatRelative, useT } from '../../i18n';
import { prettyClient } from '../../shell/Claude';
import type { SettingsSectionDef } from '../index';
import { SettingRow, SettingsGroup } from '../kit';

interface Status {
  enabled: boolean;
  clients: { id: number; name: string; since: number }[];
  desktopFound: boolean;
  lastSeen: { name: string; at: number } | null;
  claudeCode: string;
  bridgeReady: boolean;
}

function ClaudeSettings(): ReactNode {
  const t = useT();
  const clients = useClaude((s) => s.clients);
  const [status, setStatus] = useState<Status | null>(null);
  const step = useClaude((s) => s.connectStep);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = (): void => void api.call<Status>('x:claude:status').then(setStatus);
  useEffect(refresh, [clients.length]);

  const connect = async (): Promise<void> => {
    setBusy(true);
    await connectClaudeDesktop();
    setBusy(false);
    refresh();
  };

  const setEnabled = async (on: boolean): Promise<void> => setStatus(await api.call<Status>('x:claude:setEnabled', on));

  const copy = async (): Promise<void> => {
    if (!status) return;
    await navigator.clipboard.writeText(status.claudeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (!status) return null;
  const live = [...new Set(clients.map((c) => prettyClient(c.name)))];
  const state = live.length
    ? { ok: true, text: t('Connected: {apps}', { apps: live.join(', ') }) }
    : status.lastSeen
      ? { ok: true, text: t('Last used by {app} {when}', { app: prettyClient(status.lastSeen.name), when: formatRelative(status.lastSeen.at) }) }
      : { ok: false, text: t('Not connected yet') };

  return (
    <>
      <SettingsGroup title={t('Claude')} description={t('Ask Claude, in your own Claude app, to edit, caption and export your videos in Kinora. It uses your Claude plan; nothing is uploaded by Kinora.')}>
        <div className={`claude-state ${state.ok ? 'is-ok' : ''}`} role="status" data-claude-state={live.length ? 'connected' : status.lastSeen ? 'used' : 'new'}>
          {state.ok ? <CircleCheck size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          <span>{state.text}</span>
        </div>
        <ol className="claude-steps claude-steps--numbered">
          <li>
            <div className="claude-step">
              <span>{t('Click Connect. Claude Desktop opens and asks to install Kinora: click Install.')}</span>
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || !status.bridgeReady} onClick={() => void connect()} data-action="claude-connect">
                <Sparkles size={14} aria-hidden="true" />
                {t('Connect')}
              </button>
            </div>
            {step === 'opened' && <p className="claude-step__note">{t('Look for the Install dialog in Claude Desktop. If it didn’t appear, open Claude Desktop and click Connect again.')}</p>}
            {step === 'manual' && (
              <div className="claude-step__note">
                <p>{t('Claude Desktop didn’t open the file by itself. Drag Kinora.mcpb onto Claude Desktop’s Settings → Extensions page and click Install.')}</p>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => void api.call('x:claude:showExtension')} data-action="claude-show-file">
                  <FolderOpen size={14} aria-hidden="true" />
                  {t('Show Kinora.mcpb')}
                </button>
              </div>
            )}
          </li>
          <li>{t('In Claude, ask: “What’s in my Kinora project?”')}</li>
        </ol>
        {!status.desktopFound && (
          <SettingRow label={t('Claude Desktop isn’t installed')} description={t('Install it from claude.ai/download, open it once, then click Connect.')}>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => void api.app.openExternal('https://claude.ai/download')}>
              {t('Get Claude Desktop')}
            </button>
          </SettingRow>
        )}
        <SettingRow label={t('Let Claude control Kinora')} description={status.enabled ? t('Turn off to disconnect Claude right away.') : t('Claude can’t use Kinora right now.')}>
          <Toggle value={status.enabled} onChange={(v) => void setEnabled(v)} title={t('Let Claude control Kinora')} />
        </SettingRow>
        <p className="set-note">{t('To remove Kinora from Claude, uninstall it in Claude Desktop under Settings → Extensions.')}</p>
      </SettingsGroup>

      <SettingsGroup title={t('Claude Code and other apps')} description={t('Run this command once in a terminal to add Kinora to Claude Code. Other MCP apps can start the same command.')}>
        <SettingRow label={<code className="claude-code">{status.claudeCode}</code>} stacked>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => void copy()} data-action="claude-copy">
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? t('Copied') : t('Copy')}
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('What Claude can do')}>
        <ul className="claude-steps">
          <li>{t('Read the timeline, look at frames and run any command from the command palette.')}</li>
          <li>{t('Import media, add templates, text, stickers, music and effects, trim, split and arrange clips.')}</li>
          <li>{t('Run captions, silence and filler removal and other smart features, and export for every platform.')}</li>
          <li>{t('Every change appears in History as “Claude: …”, so you can undo it.')}</li>
          <li>{t('Replacing a file on disk always asks you first. Claude never deletes your files.')}</li>
        </ul>
      </SettingsGroup>
    </>
  );
}

const sections: SettingsSectionDef[] = [
  {
    id: 'claude',
    title: 'Claude',
    order: 17,
    icon: <Sparkles size={16} />,
    description: 'Let Claude edit with you',
    keywords: ['claude', 'ai', 'assistant', 'mcp', 'connector', 'extension', 'automate', 'claude desktop', 'claude code'],
    Component: ClaudeSettings,
  },
];

export default sections;
