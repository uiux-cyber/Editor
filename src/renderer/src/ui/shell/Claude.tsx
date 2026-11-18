import { FileWarning, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { answerApproval, useClaude } from '../claude/store';
import { Modal } from '../common/overlays';
import { useT } from '../i18n';
import { openSettings } from '../settings/store';

/**
 * Title-bar indicator while a Claude app is connected: what Claude is doing right now, or the last
 * thing it did. Opens Settings → Claude.
 */
export function ClaudeIndicator(): ReactNode {
  const t = useT();
  const clients = useClaude((s) => s.clients);
  const running = useClaude((s) => s.running);
  const last = useClaude((s) => s.last);
  if (!clients.length) return null;
  const names = [...new Set(clients.map((c) => prettyClient(c.name)))].join(', ');
  const tip = running ? t('Claude is working: {action}', { action: running }) : last ? t('Last action by Claude: {action}', { action: last.title }) : t('Connected: {apps}', { apps: names });
  return (
    <button type="button" className={`claude-btn${running ? ' is-busy' : ''}`} title={tip} aria-label={tip} onClick={() => openSettings('claude')} data-action="claude">
      <Sparkles size={14} aria-hidden="true" />
      <span>Claude</span>
      <span className="claude-btn__dot" aria-hidden="true" />
    </button>
  );
}

/** Claude Desktop reports itself as e.g. "claude-ai"; show something readable. */
export function prettyClient(name: string): string {
  if (/^claude[-_ ]?ai$/i.test(name) || /claude desktop/i.test(name)) return 'Claude Desktop';
  if (/claude[-_ ]?code/i.test(name)) return 'Claude Code';
  return name;
}

/** The user's approval for something Claude asked to do (replacing a file). */
export function ClaudeApprovals(): ReactNode {
  const t = useT();
  const approval = useClaude((s) => s.approvals[0]);
  if (!approval) return null;
  const name = approval.path.replace(/^.*[\\/]/, '');
  const deny = (): void => answerApproval(approval.id, false);
  return (
    <Modal
      title={t('Replace “{name}”?', { name })}
      subtitle={t('Requested by {client}', { client: prettyClient(approval.client) })}
      onClose={deny}
      width={520}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={deny} data-action="claude-deny">
            {t('Keep the file')}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => answerApproval(approval.id, true)} data-action="claude-approve">
            {t('Replace')}
          </button>
        </>
      }
    >
      <div className="claude-approval">
        <FileWarning size={20} aria-hidden="true" />
        <div>
          <p>{approval.what === 'the project' ? t('Claude wants to save the project over an existing file:') : t('Claude wants to write the export over an existing file:')}</p>
          <p className="claude-approval__path">{approval.path}</p>
          <p className="claude-approval__note">{t('The current file will be lost. Choose Keep the file and Claude will use another name.')}</p>
        </div>
      </div>
    </Modal>
  );
}
