import { Sparkles, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { connectClaudeDesktop, useClaude } from '../claude/store';
import { useT } from '../i18n';
import { openSettings, setSetting, useSetting } from '../settings/store';

/**
 * Start-screen invitation to connect Claude: one click asks Claude Desktop to install Kinora, then
 * Settings → Claude shows the next step. Hidden once Claude has used Kinora, or when dismissed.
 */
export function ClaudeCard(): ReactNode {
  const t = useT();
  const lastSeen = useClaude((s) => s.lastSeen);
  const live = useClaude((s) => s.clients.length > 0);
  const [dismissed, , loaded] = useSetting<boolean>('claude.cardDismissed', false);
  const [busy, setBusy] = useState(false);
  if (!loaded || dismissed || lastSeen || live) return null;

  const connect = async (): Promise<void> => {
    setBusy(true);
    await connectClaudeDesktop();
    setBusy(false);
    openSettings('claude');
  };

  return (
    <section className="claude-card" aria-labelledby="claude-card-title">
      <span className="claude-card__icon" aria-hidden="true">
        <Sparkles size={18} />
      </span>
      <div className="claude-card__text">
        <h2 id="claude-card-title">{t('Edit with Claude')}</h2>
        <p>{t('Ask Claude to cut, caption and export your videos in Kinora. Connect once; it uses your own Claude plan.')}</p>
      </div>
      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void connect()} data-action="claude-card-connect">
        {t('Connect Claude')}
      </button>
      <button type="button" className="icon-btn claude-card__close" onClick={() => setSetting('claude.cardDismissed', true)} title={t('Hide')} aria-label={t('Hide')}>
        <X size={14} />
      </button>
    </section>
  );
}
