/**
 * Settings → Claude: connect Kinora to Claude Desktop (or Claude Code), allow / stop Claude,
 * and see what Claude can do.
 */

import { Check, Copy, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/platform/api';
import { useUI } from '@/store/ui';
import { useClaude } from '../../claude/store';
import { Toggle } from '../../common/controls';
import { useT } from '../../i18n';
import { prettyClient } from '../../shell/Claude';
import type { SettingsSectionDef } from '../index';
import { SettingRow, SettingsGroup } from '../kit';

interface Status {
  enabled: boolean;
  clients: { id: number; name: string; since: number }[];
  desktopDirs: string[];
  desktopConnected: boolean;
  claudeCode: string;
  bridgeReady: boolean;
}

function ClaudeSettings(): ReactNode {
  const t = useT();
  const clients = useClaude((s) => s.clients);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useUI((s) => s.toast);

  const refresh = (): void => void api.call<Status>('x:claude:status').then(setStatus);
  useEffect(refresh, [clients.length]);

  const connect = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.call<{ ok: boolean; error?: string; status: Status }>('x:claude:connectDesktop');
      setStatus(res.status);
      if (res.ok) toast({ kind: 'success', message: t('Kinora is added to Claude Desktop'), detail: t('Quit and reopen Claude Desktop, then ask Claude to edit in Kinora.'), timeout: 12000 });
      else if (res.error === 'not-installed') toast({ kind: 'warning', message: t('Claude Desktop was not found'), detail: t('Install Claude Desktop and open it once, then try again.') });
      else toast({ kind: 'error', message: t('Couldn’t update Claude Desktop’s settings'), detail: t('Its claude_desktop_config.json could not be read. Fix or remove it, then try again.') });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await api.call<Status>('x:claude:disconnectDesktop'));
      toast({ kind: 'info', message: t('Kinora is removed from Claude Desktop'), detail: t('Reopen Claude Desktop to finish.') });
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (on: boolean): Promise<void> => setStatus(await api.call<Status>('x:claude:setEnabled', on));

  const copy = async (): Promise<void> => {
    if (!status) return;
    await navigator.clipboard.writeText(status.claudeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (!status) return null;
  const connectedApps = [...new Set(clients.map((c) => prettyClient(c.name)))];
  const line = !status.enabled
    ? t('Claude can’t use Kinora right now.')
    : connectedApps.length
      ? t('Connected: {apps}', { apps: connectedApps.join(', ') })
      : t('Waiting for Claude. Ask Claude to do something in Kinora.');

  return (
    <>
      <SettingsGroup title={t('Claude')} description={t('Ask Claude, in your own Claude app, to edit, caption and export your videos in Kinora. It uses your Claude plan; nothing is uploaded by Kinora.')}>
        <SettingRow label={t('Let Claude control Kinora')} description={<span role="status">{line}</span>}>
          <Toggle value={status.enabled} onChange={(v) => void setEnabled(v)} title={t('Let Claude control Kinora')} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('Claude Desktop')}>
        <SettingRow
          label={status.desktopConnected ? t('Kinora is added to Claude Desktop') : t('Add Kinora to Claude Desktop')}
          description={
            status.desktopDirs.length === 0
              ? t('Claude Desktop was not found on this PC. Install it from claude.ai/download and open it once.')
              : status.desktopConnected
                ? t('If Claude doesn’t see Kinora yet, quit and reopen Claude Desktop.')
                : t('One click adds Kinora to Claude Desktop’s connectors. Then quit and reopen Claude Desktop.')
          }
        >
          {status.desktopConnected ? (
            <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => void disconnect()} data-action="claude-disconnect">
              {t('Remove')}
            </button>
          ) : (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy || status.desktopDirs.length === 0 || !status.bridgeReady} onClick={() => void connect()} data-action="claude-connect">
              <Sparkles size={14} aria-hidden="true" />
              {t('Connect')}
            </button>
          )}
        </SettingRow>
        {status.desktopDirs.length === 0 && (
          <SettingRow label={t('Get Claude Desktop')}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void api.app.openExternal('https://claude.ai/download')}>
              {t('Open')}
            </button>
          </SettingRow>
        )}
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
    keywords: ['claude', 'ai', 'assistant', 'mcp', 'connector', 'automate', 'claude desktop', 'claude code'],
    Component: ClaudeSettings,
  },
];

export default sections;
