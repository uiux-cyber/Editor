import { Check, ImagePlus, Star, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { getTemplate } from '@/library';
import { brandContrastChecks, brandPalette, type BrandColors, type BrandFont } from '@/library/brand';
import { cssFamily, getBundledFont } from '@/library/fonts';
import { ASPECT_SIZES, variationFor } from '@/library/templateEngine';
import { api } from '@/platform/api';
import { ColorInput, Field, Select, Toggle } from '../common/controls';
import { Modal } from '../common/overlays';
import { tk, tMaybe, useT } from '../i18n';
import './templates.css';
import { FontPicker } from '../inspector/FontPicker';
import { LiveThumb } from '../library/thumbs';
import { templateThumbSpec } from './apply';
import { addBrandLogo, currentLogo, removeBrandLogo, setUseBrand, updateBrand, useTemplates } from './store';

const COLOR_ROWS: { key: keyof BrandColors; label: string; hint: string }[] = [
  { key: 'primary', label: tk('Primary'), hint: tk('Buttons, bars and highlights') },
  { key: 'secondary', label: tk('Secondary'), hint: tk('Second accent and gradients') },
  { key: 'accent', label: tk('Accent'), hint: tk('Small details that pop') },
  { key: 'background', label: tk('Background'), hint: tk('Backdrops and panels') },
  { key: 'text', label: tk('Text'), hint: tk('Headlines and body copy') },
];

/** Labels of the brandContrastChecks() rows (library/brand.ts), translated where shown. */
const CHECK_LABELS = new Set<string>([
  tk('Text on background'),
  tk('Muted text on background'),
  tk('Text on primary'),
  tk('Primary on background'),
  tk('Secondary on background'),
  tk('Accent on background'),
]);

const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Font weight names ('weight' context: "Light" and "Medium" mean something else elsewhere). */
function weightName(w: number, t: ReturnType<typeof useT>): string {
  switch (w) {
    case 100:
      return t('Thin', undefined, 'weight');
    case 200:
      return t('Extra light', undefined, 'weight');
    case 300:
      return t('Light', undefined, 'weight');
    case 400:
      return t('Regular', undefined, 'weight');
    case 500:
      return t('Medium', undefined, 'weight');
    case 600:
      return t('Semibold', undefined, 'weight');
    case 700:
      return t('Bold', undefined, 'weight');
    case 800:
      return t('Extra bold', undefined, 'weight');
    case 900:
      return t('Black', undefined, 'weight');
    default:
      return '';
  }
}

function FontRow({ label, value, onChange }: { label: string; value: BrandFont; onChange: (f: BrandFont) => void }): ReactNode {
  const t = useT();
  const weights = getBundledFont(value.family)?.weights ?? ALL_WEIGHTS;
  return (
    <div className="brand-font">
      <Field label={label} labelWidth={84}>
        <FontPicker value={value.family} onChange={(family) => onChange({ ...value, family, weight: (getBundledFont(family)?.weights ?? ALL_WEIGHTS).reduce((b, w) => (Math.abs(w - value.weight) < Math.abs(b - value.weight) ? w : b), 400) })} />
      </Field>
      <Field label="" labelWidth={84}>
        <Select value={weights.includes(value.weight) ? value.weight : weights[0]} options={weights.map((w) => ({ value: w, label: `${w} · ${weightName(w, t)}` }))} onChange={(weight) => onChange({ ...value, weight })} style={{ flex: 1 }} />
        <label className="brand-font__caps" title={t('Set in capitals')}>
          <Toggle value={!!value.uppercase} onChange={(uppercase) => onChange({ ...value, uppercase })} />
          <span>AA</span>
        </label>
      </Field>
    </div>
  );
}

/** Live previews of a few templates rendered with the brand. */
function BrandPreview(): ReactNode {
  const t = useT();
  const brand = useTemplates((s) => s.brand);
  const logoEpoch = useTemplates((s) => s.logoEpoch);
  const items = ['b-business-logo-reveal', 'lower-third-classic-bar'];
  const size = ASPECT_SIZES['16:9'];
  const w = 360;
  const h = Math.round((w * size.ch) / size.cw);
  return (
    <div className="brand-preview">
      {items.map((id) => {
        const def = getTemplate(id);
        if (!def) return null;
        const v = variationFor(def, 0, true);
        return (
          <div key={id} className="brand-preview__item" style={{ aspectRatio: `${w} / ${h}` }}>
            <LiveThumb id={`brand:${v.key}:${logoEpoch}:${w}`} width={w} height={h} build={() => templateThumbSpec(v, size.cw, size.ch, w, h)} />
          </div>
        );
      })}
      <p className="hint">{t('Hover a preview to play it. Every template uses these colours, fonts and your logo when “Use my brand” is on.')}</p>
    </div>
  );
}

/** The brand kit editor (Brand Kit window and Settings › Brand kit). */
export function BrandKitPanel({ compact = false }: { compact?: boolean }): ReactNode {
  const t = useT();
  const brand = useTemplates((s) => s.brand);
  const checks = useMemo(() => brandContrastChecks(brand), [brand]);
  const derived = useMemo(() => brandPalette(brand), [brand]);
  const primary = currentLogo(brand);
  const failing = checks.filter((c) => !c.ok);

  return (
    <div className={`brand-kit ${compact ? 'is-compact' : ''}`}>
      <div className="brand-kit__form">
        <section className="brand-kit__group">
          <h4>{t('Brand')}</h4>
          <Field label={t('Name')} labelWidth={84}>
            <input
              className="input"
              value={brand.name}
              placeholder={t('Your brand or channel name')}
              maxLength={120}
              spellCheck={false}
              onChange={(e) => updateBrand((k) => void (k.name = e.target.value))}
              onKeyDown={(e) => e.stopPropagation()}
              data-testid="brand-name"
            />
          </Field>
        </section>

        <section className="brand-kit__group">
          <h4>{t('Logos')}</h4>
          <div className="brand-logos">
            {brand.logos.map((l) => (
              <div key={l.id} className={`brand-logo ${primary?.id === l.id ? 'is-primary' : ''}`} title={l.name}>
                <div className="brand-logo__img">
                  <img src={api.media.toUrl(l.path)} alt="" draggable={false} />
                </div>
                <div className="brand-logo__bar">
                  <button
                    type="button"
                    className={`icon-btn icon-btn--sm ${brand.primaryLogo === l.id ? 'is-active' : ''}`}
                    title={brand.primaryLogo === l.id ? t('Default logo') : t('Use as the default logo')}
                    onClick={() => updateBrand((k) => void (k.primaryLogo = l.id))}
                  >
                    <Star size={12} />
                  </button>
                  <span className="truncate">{l.name}</span>
                  <button type="button" className="icon-btn icon-btn--sm" title={t('Remove from the brand kit')} onClick={() => void removeBrandLogo(l.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="brand-logo brand-logo--add" onClick={() => void addBrandLogo()} data-testid="brand-add-logo">
              <ImagePlus size={20} />
              <span>{t('Add logo…')}</span>
            </button>
          </div>
          <p className="hint">{t('PNG or SVG with a transparent background works best. Add a light and a dark version and Kinora picks the one that reads on your background.')}</p>
        </section>

        <section className="brand-kit__group">
          <h4>{t('Colours')}</h4>
          {COLOR_ROWS.map((row) => (
            <Field key={row.key} label={tMaybe(row.label)} labelWidth={84} title={tMaybe(row.hint)}>
              <div className="brand-color" data-color={row.key}>
                <ColorInput value={brand.colors[row.key]} onChange={(v) => updateBrand((k) => void (k.colors[row.key] = v.slice(0, 7)))} />
              </div>
            </Field>
          ))}
          <div className="brand-derived" title={t('Derived automatically from your colours')}>
            <span className="brand-derived__label">{t('Derived')}</span>
            {(
              [
                [t('Surface'), derived.surface],
                [t('Muted text'), derived.textMuted],
                [t('On primary'), derived.onPrimary],
                [t('Background 2'), derived.bg2],
              ] as const
            ).map(([label, color]) => (
              <span key={label} className="brand-derived__chip" title={`${label} ${color}`}>
                <i style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </section>

        <section className="brand-kit__group">
          <h4>
            {t('Contrast')}
            {failing.length > 0 ? (
              <span className="brand-contrast__summary is-warn">
                <TriangleAlert size={12} /> {t('{count} to improve', { count: failing.length })}
              </span>
            ) : (
              <span className="brand-contrast__summary">
                <Check size={12} /> {t('All readable')}
              </span>
            )}
          </h4>
          <div className="brand-contrast">
            {checks.map((c) => (
              <div key={c.id} className={`brand-contrast__row ${c.ok ? '' : 'is-fail'}`} data-check={c.id}>
                <span className="brand-contrast__sample" style={{ background: c.bg, color: c.fg }}>
                  Aa
                </span>
                <span className="brand-contrast__label">{CHECK_LABELS.has(c.label) ? tMaybe(c.label) : c.label}</span>
                <span className="brand-contrast__ratio mono">{c.ratio.toFixed(2)}:1</span>
                <span className={`brand-contrast__level level-${c.level.replace(' ', '-').toLowerCase()}`}>{c.level === 'fail' ? t('Low') : c.level}</span>
              </div>
            ))}
          </div>
          {failing.length > 0 && <p className="hint">{t('Low-contrast pairs are hard to read. Templates fall back to a readable colour where they can, but your brand will look best with stronger contrast.')}</p>}
        </section>

        <section className="brand-kit__group">
          <h4>{t('Typography')}</h4>
          <FontRow label={t('Headings')} value={brand.heading} onChange={(f) => updateBrand((k) => void (k.heading = f))} />
          <FontRow label={t('Body')} value={brand.body} onChange={(f) => updateBrand((k) => void (k.body = f))} />
          <div className="brand-type-sample" style={{ background: brand.colors.background, color: derived.text }}>
            <strong style={{ fontFamily: cssFamily(brand.heading.family), fontWeight: brand.heading.weight, textTransform: brand.heading.uppercase ? 'uppercase' : 'none' }}>
              {brand.name || t('Your headline')}
            </strong>
            <span style={{ fontFamily: cssFamily(brand.body.family), fontWeight: brand.body.weight, color: derived.textMuted, textTransform: brand.body.uppercase ? 'uppercase' : 'none' }}>
              {t('Body copy looks like this — clear and on brand.')}
            </span>
            <i style={{ background: brand.colors.primary }} />
          </div>
        </section>
      </div>
      {!compact && <BrandPreview />}
    </div>
  );
}

export function BrandKitWindow({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const useBrand = useTemplates((s) => s.useBrand);
  return (
    <Modal
      title={t('Brand kit')}
      subtitle={t('Your logo, colours and fonts — applied to every template in one click.')}
      onClose={onClose}
      width={1040}
      footer={
        <>
          <label className="tpl-toggle" data-testid="brand-use-toggle">
            <Toggle value={useBrand} onChange={setUseBrand} />
            <span>{t('Use my brand in templates')}</span>
          </label>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('Done')}
          </button>
        </>
      }
    >
      <BrandKitPanel />
    </Modal>
  );
}
