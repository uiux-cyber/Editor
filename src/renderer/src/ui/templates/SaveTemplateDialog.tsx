import { Film, Image as ImageIcon, LayoutTemplate } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { designSize } from '@/core/project';
import type { Clip, MediaAsset } from '@/core/types';
import { TEMPLATE_CATEGORIES } from '@/library/staticTemplates';
import type { TemplateCategory } from '@/library/types';
import { serializeSelection, type SerializedSelection } from '@/library/userTemplates';
import { useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { Field, Segmented, Select } from '../common/controls';
import { Modal } from '../common/overlays';
import { labelOf } from '../library/common';
import { LiveThumb, renderInto, templateThumbProject } from '../library/thumbs';
import { errorText, storeUserTemplate, useTemplates } from './store';
import { ensureThumbImages } from './thumbImages';

const POSTER_LONG_SIDE = 640;

function defaultName(clips: Clip[]): string {
  const text = clips.find((c): c is Extract<Clip, { type: 'text' }> => c.type === 'text' && !!c.text.content.trim());
  const line = text?.text.content.split('\n')[0].trim() ?? '';
  return line ? (line.length > 40 ? `${line.slice(0, 38)}…` : line) : 'My template';
}

/** Render the template's poster frame to PNG bytes. */
async function renderPoster(s: SerializedSelection, assets: MediaAsset[], cw: number, ch: number, time: number): Promise<Uint8Array | null> {
  const k = POSTER_LONG_SIDE / Math.max(cw, ch);
  const w = Math.round(cw * k);
  const h = Math.round(ch * k);
  const project = templateThumbProject(s.file.clips, w, h, cw, ch);
  for (const a of assets) project.assets[a.id] ??= a;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  if (!renderInto(canvas, project, time)) return null;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export function SaveTemplateDialog({ onClose }: { onClose: () => void }): ReactNode {
  const project = useProjectStore((s) => s.project);
  const selection = useUI((s) => s.selection);
  const logosDir = useTemplates((s) => s.logosDir);
  // Freeze the selection the dialog was opened with.
  const [ids] = useState(() => selection.filter((id) => project.clips[id]));
  const clips = useMemo(() => ids.map((id) => project.clips[id]).filter(Boolean), [ids, project]);
  const [name, setName] = useState(() => defaultName(clips));
  const [category, setCategory] = useState<TemplateCategory>('title');
  const [tags, setTags] = useState('');
  const [embed, setEmbed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);
  const { cw, ch } = designSize(project.settings);

  const mediaAssets = useMemo(() => {
    const out: MediaAsset[] = [];
    for (const c of clips) if ((c.type === 'video' || c.type === 'image') && project.assets[c.assetId]) out.push(project.assets[c.assetId]);
    return [...new Map(out.map((a) => [a.id, a])).values()];
  }, [clips, project.assets]);
  const hasMedia = mediaAssets.length > 0 || clips.some((c) => c.type === 'audio');

  const serialized = useMemo(
    () => (ids.length ? serializeSelection(project, ids, { name, category, tags: tags.split(','), embedMedia: embed, brandDir: logosDir || undefined }) : null),
    [project, ids, name, category, tags, embed, logosDir],
  );

  useEffect(() => {
    let alive = true;
    void ensureThumbImages(mediaAssets).then(() => alive && setImagesReady(true));
    return () => {
      alive = false;
    };
  }, [mediaAssets]);

  const portrait = ch > cw;
  const thumbW = portrait ? 220 : 420;
  const thumbH = Math.round((thumbW * ch) / cw);
  const previewKey = serialized ? `${serialized.file.clips.length}:${embed}:${serialized.summary.placeholders}:${imagesReady}` : '';
  const build = useMemo(
    () => () => {
      if (!serialized) return null;
      const p = templateThumbProject(serialized.file.clips, thumbW, thumbH, cw, ch);
      for (const a of mediaAssets) p.assets[a.id] ??= a;
      return { project: p, poster: serialized.file.duration * 0.5, from: 0, to: Math.max(0.5, serialized.file.duration) };
    },
    [serialized, thumbW, thumbH, cw, ch, mediaAssets],
  );

  const save = async (): Promise<void> => {
    if (!serialized || saving) return;
    if (!name.trim()) {
      toast('info', 'Give your template a name');
      return;
    }
    setSaving(true);
    try {
      await ensureThumbImages(mediaAssets);
      const poster = await renderPoster(serialized, mediaAssets, cw, ch, serialized.file.duration * 0.5);
      const entry = await storeUserTemplate(serialized.file, poster, serialized.embed);
      useTemplates.setState({ galleryCategory: 'mine' });
      onClose();
      useUI.getState().toast({
        kind: 'success',
        message: `“${entry.file.name}” saved to My templates`,
        detail: serialized.summary.placeholders ? `${serialized.summary.placeholders} media placeholder${serialized.summary.placeholders === 1 ? '' : 's'} — drop new media on them after applying.` : undefined,
        action: { label: 'Show', run: () => useUI.getState().setLibraryTab('templates') },
      });
    } catch (err) {
      toast('error', 'Could not save the template', errorText(err));
      setSaving(false);
    }
  };

  if (!serialized || serialized.file.clips.length === 0) {
    return (
      <Modal title="Save as template" onClose={onClose} width={440} footer={<span style={{ flex: 1 }} />}>
        <div className="empty">
          <div className="empty__icon">
            <LayoutTemplate size={20} />
          </div>
          <div className="empty__title">Select some layers first</div>
          <p>Select the clips that make up your design on the timeline, then choose “Save as template…”.</p>
        </div>
      </Modal>
    );
  }

  const s = serialized.summary;
  return (
    <Modal
      title="Save as template"
      subtitle="Reuse this design in any project — it appears under My templates."
      onClose={onClose}
      width={portrait ? 680 : 820}
      footer={
        <>
          <span className="tpl-save__meta">
            {s.layers} layer{s.layers === 1 ? '' : 's'} · {serialized.file.duration.toFixed(1)} s
            {s.placeholders ? ` · ${s.placeholders} placeholder${s.placeholders === 1 ? '' : 's'}` : ''}
            {s.embedded ? ` · ${s.embedded} embedded file${s.embedded === 1 ? '' : 's'}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void save()} data-testid="save-template">
            {saving ? <span className="spinner" /> : null} Save template
          </button>
        </>
      }
    >
      <div className="tpl-save">
        <div className="tpl-save__preview">
          <div className="tpl-save__thumb" style={{ aspectRatio: `${thumbW} / ${thumbH}` }}>
            <LiveThumb id={`save:${previewKey}:${thumbW}`} width={thumbW} height={thumbH} build={build} autoplay />
          </div>
          <p className="hint">Preview of the template as it will be applied{s.placeholders ? ' — media shows as drop-in placeholders' : ''}.</p>
        </div>
        <div className="tpl-save__form">
          <Field label="Name" labelWidth={84}>
            <input
              className="input"
              autoFocus
              value={name}
              maxLength={80}
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') void save();
              }}
              data-testid="template-name"
            />
          </Field>
          <Field label="Category" labelWidth={84}>
            <Select value={category} options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: labelOf(c) }))} onChange={setCategory} />
          </Field>
          <Field label="Tags" labelWidth={84}>
            <input className="input" value={tags} placeholder="e.g. sale, bold, summer" spellCheck={false} onChange={(e) => setTags(e.target.value)} onKeyDown={(e) => e.stopPropagation()} data-testid="template-tags" />
          </Field>
          {hasMedia && (
            <>
              <Field label="Media" labelWidth={84}>
                <Segmented
                  value={embed ? 'embed' : 'slots'}
                  onChange={(v) => setEmbed(v === 'embed')}
                  options={[
                    { value: 'slots', label: 'Placeholders', title: 'Photos and videos become drop-in placeholders' },
                    { value: 'embed', label: 'Embed media', title: 'Copy the media files into the template' },
                  ]}
                  style={{ flex: 1 }}
                />
              </Field>
              <div className="tpl-save__note">
                {embed ? <Film size={14} /> : <ImageIcon size={14} />}
                <span>
                  {embed
                    ? 'The media files are copied next to the template, so it always looks exactly like this.'
                    : 'Photos and videos become placeholders: drop new media on them after applying the template. Built-in sounds are kept.'}
                </span>
              </div>
            </>
          )}
          {s.skipped.length > 0 && (
            <div className="tpl-save__note tpl-save__note--warn">
              <span>Not included: {s.skipped.join(', ')}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
