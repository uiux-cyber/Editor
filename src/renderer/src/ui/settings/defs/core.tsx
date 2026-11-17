/**
 * Built-in settings sections: General, Appearance, Shortcuts and Language.
 */

import { Keyboard, Languages, Palette, Settings2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/platform/api';
import { LANGUAGES, formatDate, formatNumber, formatRelative, setLanguage, systemLanguage, useI18n, useT } from '../../i18n';
import { setMotion, setTheme, useTheme, type MotionSetting, type ThemeSetting } from '../../theme';
import type { SettingsSectionDef } from '../index';
import { ChoiceCards, SettingRow, SettingsGroup } from '../kit';
import { ShortcutsEditor } from '../ShortcutsEditor';
import { useSetting } from '../store';

// ---------------------------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------------------------

function General(): ReactNode {
  const t = useT();
  const [startup, setStartup] = useSetting<'home' | 'last'>('general.startup', 'home');
  const [fps, setFps] = useSetting<number>('general.defaultFps', 30);
  const [autosave, setAutosave] = useSetting<number>('general.autosaveSeconds', 15);
  const [recentCount, setRecentCount] = useState<number | null>(null);

  useEffect(() => {
    void api.app.getRecent().then((r) => setRecentCount(r.length));
  }, []);

  const clearRecent = async (): Promise<void> => {
    const list = await api.app.getRecent();
    for (const r of list) await api.app.removeRecent(r.path);
    setRecentCount(0);
  };

  return (
    <>
      <SettingsGroup title={t('Startup')}>
        <ChoiceCards
          label={t('When Kinora starts')}
          value={startup}
          columns={2}
          compact
          onChange={setStartup}
          options={[
            { value: 'home', label: t('Show the start screen'), description: t('Formats, templates and recent projects') },
            { value: 'last', label: t('Reopen the last project'), description: t('Continue where you left off') },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup title={t('Projects')}>
        <SettingRow label={t('Frame rate for new projects')} description={t('Used by the format cards on the start screen and as the default in New project.')} htmlFor="set-fps">
          <select id="set-fps" className="select" style={{ width: 140 }} value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {t('{fps, number} fps', { fps: f })}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('Autosave')} description={t('A recovery copy of unsaved work is kept so it can be restored after a crash.')} htmlFor="set-autosave">
          <select id="set-autosave" className="select" style={{ width: 160 }} value={autosave} onChange={(e) => setAutosave(Number(e.target.value))}>
            <option value={0}>{t('Off')}</option>
            <option value={15}>{t('Every {count, plural, one {# second} other {# seconds}}', { count: 15 })}</option>
            <option value={30}>{t('Every {count, plural, one {# second} other {# seconds}}', { count: 30 })}</option>
            <option value={60}>{t('Every minute')}</option>
            <option value={300}>{t('Every {count, plural, one {# minute} other {# minutes}}', { count: 5 })}</option>
          </select>
        </SettingRow>
        <SettingRow
          label={t('Recent projects')}
          description={recentCount === null ? '' : t('{count, plural, =0 {The list is empty.} one {# project in the list.} other {# projects in the list.}}', { count: recentCount })}
        >
          <button type="button" className="btn btn--outline btn--sm" disabled={!recentCount} onClick={() => void clearRecent()}>
            {t('Clear list')}
          </button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------------------------

function ThemePreview({ kind }: { kind: 'dark' | 'light' | 'system' }): ReactNode {
  return (
    <span className={`theme-preview theme-preview--${kind}`} aria-hidden="true">
      <span className="theme-preview__bar" />
      <span className="theme-preview__body">
        <span className="theme-preview__side" />
        <span className="theme-preview__stage">
          <span className="theme-preview__accent" />
        </span>
        <span className="theme-preview__side" />
      </span>
      <span className="theme-preview__tl">
        <span />
        <span />
      </span>
    </span>
  );
}

function Appearance(): ReactNode {
  const t = useT();
  const setting = useTheme((s) => s.setting);
  const resolved = useTheme((s) => s.resolved);
  const motion = useTheme((s) => s.motion);
  return (
    <>
      <SettingsGroup title={t('Theme')} description={setting === 'system' ? t('Following Windows: currently {theme}.', { theme: resolved === 'dark' ? t('Dark') : t('Light') }) : undefined}>
        <ChoiceCards<ThemeSetting>
          label={t('Theme')}
          value={setting}
          onChange={(v) => void setTheme(v)}
          options={[
            { value: 'system', label: t('System'), description: t('Match Windows'), preview: <ThemePreview kind="system" /> },
            { value: 'dark', label: t('Dark'), description: t('Best for colour work'), preview: <ThemePreview kind="dark" /> },
            { value: 'light', label: t('Light'), description: t('Bright rooms'), preview: <ThemePreview kind="light" /> },
          ]}
        />
      </SettingsGroup>
      <SettingsGroup title={t('Motion')}>
        <ChoiceCards<MotionSetting>
          label={t('Motion')}
          value={motion}
          compact
          onChange={setMotion}
          options={[
            { value: 'system', label: t('System'), description: t('Follow the Windows animation setting') },
            { value: 'reduce', label: t('Reduce motion'), description: t('Turn off interface animations') },
            { value: 'full', label: t('Full motion'), description: t('Always animate the interface') },
          ]}
        />
      </SettingsGroup>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------------------------

function Shortcuts(): ReactNode {
  return <ShortcutsEditor />;
}

// ---------------------------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------------------------

function Language(): ReactNode {
  const t = useT();
  const setting = useI18n((s) => s.setting);
  const locale = useI18n((s) => s.locale);
  const sys = LANGUAGES.find((l) => l.code === systemLanguage()) ?? LANGUAGES[0];
  const sample = Date.now() - 3 * 3600 * 1000;
  return (
    <>
      <SettingsGroup title={t('Interface language')}>
        <ChoiceCards
          label={t('Interface language')}
          value={setting}
          columns={2}
          compact
          onChange={setLanguage}
          options={[
            { value: 'system', label: t('System default'), description: t('Currently {language}', { language: sys.native }) },
            ...LANGUAGES.map((l) => ({ value: l.code, label: l.native, description: l.code === 'en' ? 'English' : l.english, lang: l.code })),
          ]}
        />
      </SettingsGroup>
      <SettingsGroup title={t('Formats')} description={t('Numbers, dates and times follow the interface language.')}>
        <div className="lang-preview" lang={locale}>
          <div>
            <span>{t('Number')}</span>
            <strong>{formatNumber(1234567.89)}</strong>
          </div>
          <div>
            <span>{t('Date')}</span>
            <strong>{formatDate(new Date(), { dateStyle: 'long' })}</strong>
          </div>
          <div>
            <span>{t('Time')}</span>
            <strong>{formatDate(new Date(), { timeStyle: 'short' })}</strong>
          </div>
          <div>
            <span>{t('Relative')}</span>
            <strong>{formatRelative(sample)}</strong>
          </div>
        </div>
        <p className="set-note">{t('Parts of the editor that are not translated yet are shown in English.')}</p>
      </SettingsGroup>
    </>
  );
}

const sections: SettingsSectionDef[] = [
  {
    id: 'general',
    title: 'General',
    order: 10,
    icon: <Settings2 size={16} />,
    description: 'Startup, new projects and autosave',
    keywords: ['startup', 'reopen', 'frame rate', 'fps', 'autosave', 'recovery', 'recent'],
    Component: General,
  },
  {
    id: 'appearance',
    title: 'Appearance',
    order: 20,
    icon: <Palette size={16} />,
    description: 'Theme and motion',
    keywords: ['theme', 'dark', 'light', 'system', 'colour', 'color', 'motion', 'animation'],
    Component: Appearance,
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    order: 30,
    icon: <Keyboard size={16} />,
    description: 'Every command and its keyboard shortcuts',
    keywords: ['keyboard', 'keys', 'hotkeys', 'keymap', 'bindings'],
    Component: Shortcuts,
  },
  {
    id: 'language',
    title: 'Language',
    order: 40,
    icon: <Languages size={16} />,
    description: 'Interface language and formats',
    keywords: ['language', 'locale', 'translation', 'english', 'español', 'français', 'deutsch', 'português', 'हिन्दी', 'number', 'date'],
    Component: Language,
  },
];

export default sections;
