/**
 * "Convert unsupported media?" — offered when imported files use a codec / container this PC
 * cannot decode. Converts them with FFmpeg (when installed) into a high-quality intermediate;
 * otherwise explains how to install FFmpeg.
 */

import { CircleCheck, Download, FileWarning, FolderSearch } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { FFMPEG_INSTALL_URL } from '@shared/media';
import { browseFfmpeg, convertAndImport, dismissOffer, useFfmpeg } from '@/engine/media/ffmpeg';
import { useMediaPrefs } from '@/engine/media/prefs';
import { api } from '@/platform/api';
import { Field, Select } from '../common/controls';
import { Modal } from '../common/overlays';
import { useT } from '../i18n';

/** Put elements into a translated message at its {placeholders}. */
function rich(message: string, parts: Record<string, ReactNode>): ReactNode[] {
  return message.split(/\{(\w+)\}/).map((piece, i) => (i % 2 ? <Fragment key={i}>{parts[piece] ?? `{${piece}}`}</Fragment> : piece));
}

/** FFmpeg status line + installation help (shared with the Settings section). */
export function FfmpegStatus({ compact = false }: { compact?: boolean }): ReactNode {
  const t = useT();
  const info = useFfmpeg((s) => s.info);
  const detecting = useFfmpeg((s) => s.detecting);
  const [busy, setBusy] = useState(false);
  if (detecting && !info) {
    return (
      <div className="mx-ffmpeg-state">
        <span className="spinner" style={{ width: 12, height: 12 }} /> {t('Looking for FFmpeg…')}
      </div>
    );
  }
  if (info?.found) {
    return (
      <div className="mx-ffmpeg-state is-ok" data-ffmpeg-state="found">
        <CircleCheck size={15} />
        <span className="truncate" title={info.path ?? undefined}>
          {info.source === 'path' ? t('FFmpeg {version} found on PATH', { version: info.version }) : t('FFmpeg {version} selected', { version: info.version })} — <span className="mx-code">{info.path}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="mx-convert__status mx-convert__status--missing" data-ffmpeg-state="missing">
      <strong>{info?.error ? t('FFmpeg is not installed ({error}).', { error: info.error }) : t('FFmpeg is not installed.')}</strong>
      {!compact && (
        <ol className="mx-convert__steps">
          <li>{rich(t('Download a Windows build of FFmpeg (for example the {build} build linked from ffmpeg.org).'), { build: <em>release essentials</em> })}</li>
          <li>{rich(t('Unzip it, e.g. to {folder}.'), { folder: <code>C:\ffmpeg</code> })}</li>
          <li>{rich(t('Click {locate} and choose {exe} — or add that {bin} folder to your PATH and restart Kinora.'), { locate: <em>{t('Locate ffmpeg.exe')}</em>, exe: <code>C:\ffmpeg\bin\ffmpeg.exe</code>, bin: <code>bin</code> })}</li>
        </ol>
      )}
      <div className="mx-settings__row">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => void api.app.openExternal(FFMPEG_INSTALL_URL)}>
          <Download size={13} /> {t('Open download page')}
        </button>
        <button
          type="button"
          className="btn btn--outline btn--sm"
          data-ffmpeg-browse
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void browseFfmpeg().finally(() => setBusy(false));
          }}
        >
          <FolderSearch size={13} /> {t('Locate ffmpeg.exe…')}
        </button>
      </div>
    </div>
  );
}

export function ConvertDialog(): ReactNode {
  const t = useT();
  const offer = useFfmpeg((s) => s.offer);
  const info = useFfmpeg((s) => s.info);
  const hevc = useFfmpeg((s) => s.hevc);
  const codec = useMediaPrefs((s) => s.convertCodec);
  const setPrefs = useMediaPrefs((s) => s.set);
  if (!offer) return null;
  const hevcOk = !!hevc?.main && !!info?.encoders.some((e) => e === 'libx265' || e.startsWith('hevc_'));
  const start = (): void => {
    const files = offer;
    dismissOffer();
    void (async () => {
      for (const f of files) await convertAndImport(f);
    })();
  };
  return (
    <Modal
      title={t('Convert unsupported media?')}
      subtitle={t('WebCodecs on this PC cannot decode these files. Kinora can make a high-quality editing copy with FFmpeg — your originals stay untouched.')}
      onClose={dismissOffer}
      width={560}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={dismissOffer}>
            {t('Not now')}
          </button>
          <button type="button" className="btn btn--primary" data-convert-start disabled={!info?.found} onClick={start}>
            {t('{count, plural, one {Convert file} other {Convert # files}}', { count: offer.length })}
          </button>
        </>
      }
    >
      <div className="mx-convert__files">
        {offer.map((f) => (
          <div key={f.path} className="mx-convert__file" title={f.path}>
            <FileWarning size={18} />
            <strong className="truncate">{f.name}</strong>
            <span className="truncate">{f.reason}</span>
          </div>
        ))}
      </div>
      <FfmpegStatus />
      {info?.found && (
        <div style={{ marginTop: 12 }}>
          <Field label={t('Convert to')} labelWidth={96}>
            <Select
              value={hevcOk ? codec : 'h264'}
              onChange={(v) => setPrefs({ convertCodec: v })}
              options={[
                { value: 'h264', label: t('H.264 MP4 — high bitrate, plays everywhere') },
                ...(hevcOk ? [{ value: 'hevc' as const, label: hevc?.main10 ? t('HEVC MP4 — smaller, keeps 10-bit') : t('HEVC MP4 — smaller') }] : []),
              ]}
            />
          </Field>
          <p className="hint" style={{ marginTop: 6 }}>
            {t("Progress shows in the preview bar; you can keep editing meanwhile. Converted files are kept in Kinora's media folder.")}
          </p>
        </div>
      )}
    </Modal>
  );
}
