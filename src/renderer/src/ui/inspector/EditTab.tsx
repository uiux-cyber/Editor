import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  CaseUpper,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Link2,
  Underline,
  Unlink2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_MASK } from '@/core/factory';
import { designSize } from '@/core/project';
import { BLEND_MODES, type Clip, type GeneratorClip, type ID, type ShapeClip, type ShapeKind, type StickerClip, type TextClip, type VisualClip } from '@/core/types';
import { engine } from '@/engine/engine';
import { getGenerator, getSticker } from '@/library';
import { getBundledFont, nearestWeight } from '@/library/fonts';
import { getProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { editClips, editVisual } from '../actions';
import { ColorInput, Field, NumberInput, Section, Segmented, Select, SliderField, Toggle } from '../common/controls';
import { writeProp } from '../keyframeOps';
import { FontPicker } from './FontPicker';
import { KeyframeButton, PaintEditor, ParamControls, useLiveProp } from './shared';

const labelOf = (id: string): string => id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------------------------

export function TransformSection({ clip, ids }: { clip: VisualClip; ids: ID[] }): ReactNode {
  const x = useLiveProp(clip, 'x');
  const y = useLiveProp(clip, 'y');
  const sx = useLiveProp(clip, 'scaleX');
  const sy = useLiveProp(clip, 'scaleY');
  const rotation = useLiveProp(clip, 'rotation');
  const opacity = useLiveProp(clip, 'opacity');
  const [linked, setLinked] = useState(Math.abs(sx - sy) < 0.001);
  const set = (prop: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity', v: number): void => editClips(ids, (c) => writeProp(c, prop, v));
  const setScale = (v: number): void =>
    editClips(ids, (c) => {
      // Keep the current proportions when scaling a non-uniform layer with the linked slider.
      const ratio = sx !== 0 ? sy / sx : 1;
      writeProp(c, 'scaleX', v);
      writeProp(c, 'scaleY', linked ? v * ratio : sy);
    });

  const align = (h: -1 | 0 | 1 | null, v: -1 | 0 | 1 | null): void => {
    const { cw, ch } = designSize(getProject().settings);
    editClips(ids, (c) => {
      const box = engine.layerBox(c.id);
      if (!box) return;
      if (h !== null) writeProp(c, 'x', h === 0 ? 0 : (h * (cw - box.w)) / 2);
      if (v !== null) writeProp(c, 'y', v === 0 ? 0 : (v * (ch - box.h)) / 2);
    });
  };

  const fit = (mode: 'fit' | 'fill'): void => {
    const { cw, ch } = designSize(getProject().settings);
    editClips(ids, (c) => {
      const box = engine.layerBox(c.id);
      if (!box || c.type === 'audio') return;
      const k = mode === 'fit' ? Math.min(cw / box.baseW, ch / box.baseH) : Math.max(cw / box.baseW, ch / box.baseH);
      writeProp(c, 'scaleX', k);
      writeProp(c, 'scaleY', k);
      writeProp(c, 'x', 0);
      writeProp(c, 'y', 0);
      writeProp(c, 'rotation', 0);
    });
  };

  return (
    <Section title="Transform" id="transform">
      <Field label="Position">
        <NumberInput prefix="X" value={x} onChange={(v) => set('x', v)} precision={0} />
        <NumberInput prefix="Y" value={y} onChange={(v) => set('y', v)} precision={0} />
        <KeyframeButton clip={clip} ids={ids} props={['x', 'y']} />
      </Field>
      {linked ? (
        <SliderField
          label="Scale"
          value={sx}
          min={0.01}
          max={4}
          step={0.01}
          scale={100}
          suffix="%"
          defaultValue={1}
          onChange={setScale}
          lead={
            <button type="button" className="icon-btn icon-btn--sm is-active" title="Scale width and height together" onClick={() => setLinked(false)}>
              <Link2 size={12} />
            </button>
          }
        />
      ) : (
        <Field label="Scale">
          <button type="button" className="icon-btn icon-btn--sm" title="Scale width and height independently" onClick={() => setLinked(true)}>
            <Unlink2 size={12} />
          </button>
          <NumberInput prefix="W" value={sx} onChange={(v) => set('scaleX', v)} scale={100} suffix="%" min={0.01} max={20} step={1} />
          <NumberInput prefix="H" value={sy} onChange={(v) => set('scaleY', v)} scale={100} suffix="%" min={0.01} max={20} step={1} />
        </Field>
      )}
      <div className="row-end">
        <KeyframeButton clip={clip} ids={ids} props={['scaleX', 'scaleY']} />
      </div>
      <SliderField label="Rotation" value={rotation} min={-180} max={180} step={1} suffix="°" defaultValue={0} bipolar onChange={(v) => set('rotation', v)} lead={<KeyframeButton clip={clip} ids={ids} props={['rotation']} />} />
      <SliderField label="Opacity" value={opacity} min={0} max={1} step={0.01} scale={100} suffix="%" defaultValue={1} onChange={(v) => set('opacity', v)} lead={<KeyframeButton clip={clip} ids={ids} props={['opacity']} />} />
      <Field label="Blend">
        <Select value={clip.blendMode} options={BLEND_MODES.map((m) => ({ value: m, label: labelOf(m) }))} onChange={(v) => editVisual(ids, (c) => void (c.blendMode = v))} />
      </Field>
      <Field label="Align">
        <div className="btn-row">
          <button type="button" className="icon-btn" title="Align left" onClick={() => align(-1, null)}>
            <AlignStartVertical size={15} />
          </button>
          <button type="button" className="icon-btn" title="Centre horizontally" onClick={() => align(0, null)}>
            <AlignCenterVertical size={15} />
          </button>
          <button type="button" className="icon-btn" title="Align right" onClick={() => align(1, null)}>
            <AlignEndVertical size={15} />
          </button>
          <span className="vdivider" />
          <button type="button" className="icon-btn" title="Align top" onClick={() => align(null, -1)}>
            <AlignStartHorizontal size={15} />
          </button>
          <button type="button" className="icon-btn" title="Centre vertically" onClick={() => align(null, 0)}>
            <AlignCenterHorizontal size={15} />
          </button>
          <button type="button" className="icon-btn" title="Align bottom" onClick={() => align(null, 1)}>
            <AlignEndHorizontal size={15} />
          </button>
        </div>
      </Field>
      <Field label="Layout">
        <div className="btn-row">
          {(clip.type === 'video' || clip.type === 'image') && (
            <>
              <button type="button" className="btn btn--sm btn--outline" title="Scale to fit inside the frame" onClick={() => fit('fit')}>
                Fit
              </button>
              <button type="button" className="btn btn--sm btn--outline" title="Scale to cover the whole frame" onClick={() => fit('fill')}>
                Fill
              </button>
            </>
          )}
          <button type="button" className={`icon-btn ${clip.flipH ? 'is-active' : ''}`} title="Flip horizontally" onClick={() => editVisual(ids, (c) => void (c.flipH = !clip.flipH))}>
            <FlipHorizontal2 size={15} />
          </button>
          <button type="button" className={`icon-btn ${clip.flipV ? 'is-active' : ''}`} title="Flip vertically" onClick={() => editVisual(ids, (c) => void (c.flipV = !clip.flipV))}>
            <FlipVertical2 size={15} />
          </button>
        </div>
      </Field>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

export function TextSection({ clip, ids }: { clip: TextClip; ids: ID[] }): ReactNode {
  const t = clip.text;
  const editing = useUI((s) => s.editingText);
  const area = useRef<HTMLTextAreaElement>(null);
  const textIds = ids.filter((id) => getProject().clips[id]?.type === 'text');
  const edit = (recipe: (c: TextClip) => void, coalesce?: string): void =>
    editClips(
      textIds,
      (c) => {
        if (c.type === 'text') recipe(c);
      },
      coalesce,
    );

  useEffect(() => {
    if (editing === clip.id && area.current) {
      area.current.focus();
      area.current.select();
      useUI.getState().set({ editingText: null });
    }
  }, [editing, clip.id]);

  const font = getBundledFont(t.fontFamily);
  const weights = font ? font.weights : [400, 700];
  const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };

  return (
    <>
      <Section title="Text" id="text">
        <textarea
          ref={area}
          className="textarea"
          value={t.content}
          rows={3}
          spellCheck={false}
          placeholder="Type your text"
          onChange={(e) => edit((c) => void (c.text.content = e.target.value), `text:${clip.id}`)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Field label="Font">
          <FontPicker
            value={t.fontFamily}
            onChange={(family) =>
              edit((c) => {
                c.text.fontFamily = family;
                c.text.fontWeight = nearestWeight(family, c.text.fontWeight);
              })
            }
          />
        </Field>
        <Field label="Weight">
          <Select value={weights.includes(t.fontWeight) ? t.fontWeight : weights[0]} options={weights.map((w) => ({ value: w, label: WEIGHT_NAMES[w] ?? String(w) }))} onChange={(w) => edit((c) => void (c.text.fontWeight = w))} />
          <NumberInput value={t.fontSize} onChange={(v) => edit((c) => void (c.text.fontSize = Math.round(v)))} min={8} max={900} step={2} suffix="px" style={{ flex: 'none', width: 78 }} title="Font size" />
        </Field>
        <Field label="Style">
          <div className="btn-row">
            <button type="button" className={`icon-btn ${t.italic ? 'is-active' : ''}`} title="Italic" onClick={() => edit((c) => void (c.text.italic = !t.italic))}>
              <Italic size={15} />
            </button>
            <button type="button" className={`icon-btn ${t.underline ? 'is-active' : ''}`} title="Underline" onClick={() => edit((c) => void (c.text.underline = !t.underline))}>
              <Underline size={15} />
            </button>
            <button type="button" className={`icon-btn ${t.uppercase ? 'is-active' : ''}`} title="All caps" onClick={() => edit((c) => void (c.text.uppercase = !t.uppercase))}>
              <CaseUpper size={15} />
            </button>
            <span className="vdivider" />
            <button type="button" className={`icon-btn ${t.align === 'left' ? 'is-active' : ''}`} title="Align left" onClick={() => edit((c) => void (c.text.align = 'left'))}>
              <AlignLeft size={15} />
            </button>
            <button type="button" className={`icon-btn ${t.align === 'center' ? 'is-active' : ''}`} title="Align centre" onClick={() => edit((c) => void (c.text.align = 'center'))}>
              <AlignCenter size={15} />
            </button>
            <button type="button" className={`icon-btn ${t.align === 'right' ? 'is-active' : ''}`} title="Align right" onClick={() => edit((c) => void (c.text.align = 'right'))}>
              <AlignRight size={15} />
            </button>
          </div>
        </Field>
        <SliderField label="Letter spacing" value={t.letterSpacing} min={-0.1} max={0.6} step={0.005} scale={100} precision={1} defaultValue={0} onChange={(v) => edit((c) => void (c.text.letterSpacing = v))} />
        <SliderField label="Line height" value={t.lineHeight} min={0.7} max={2.5} step={0.01} precision={2} defaultValue={1.15} onChange={(v) => edit((c) => void (c.text.lineHeight = v))} />
        <Field label="Wrap width" title="Wrap long lines inside a box of this width">
          <Toggle
            value={t.boxWidth !== undefined}
            onChange={(on) =>
              edit((c) => {
                if (on) c.text.boxWidth = Math.round(designSize(getProject().settings).cw * 0.8);
                else delete c.text.boxWidth;
              })
            }
          />
          {t.boxWidth !== undefined && <NumberInput value={t.boxWidth} onChange={(v) => edit((c) => void (c.text.boxWidth = Math.round(v)))} min={40} max={8000} step={10} suffix="px" />}
        </Field>
      </Section>

      <Section title="Fill" id="fill">
        <PaintEditor paint={t.fill} onChange={(p) => edit((c) => void (c.text.fill = p))} />
      </Section>

      <Section
        title="Outline"
        id="stroke"
        defaultOpen={!!t.stroke}
        actions={
          <Toggle
            value={!!t.stroke}
            onChange={(on) =>
              edit((c) => {
                if (on) c.text.stroke = { color: '#000000', width: 8 };
                else delete c.text.stroke;
              })
            }
          />
        }
      >
        {t.stroke ? (
          <>
            <Field label="Color">
              <ColorInput value={t.stroke.color} alpha onChange={(v) => edit((c) => c.text.stroke && void (c.text.stroke.color = v))} />
            </Field>
            <SliderField label="Width" value={t.stroke.width} min={0} max={60} step={0.5} precision={1} defaultValue={8} onChange={(v) => edit((c) => c.text.stroke && void (c.text.stroke.width = v))} />
          </>
        ) : (
          <p className="hint">Add an outline around the letters.</p>
        )}
      </Section>

      <Section
        title="Shadow"
        id="shadow"
        defaultOpen={!!t.shadow}
        actions={
          <Toggle
            value={!!t.shadow}
            onChange={(on) =>
              edit((c) => {
                if (on) c.text.shadow = { color: '#00000099', blur: 16, x: 0, y: 8 };
                else delete c.text.shadow;
              })
            }
          />
        }
      >
        {t.shadow ? (
          <>
            <Field label="Color">
              <ColorInput value={t.shadow.color} alpha onChange={(v) => edit((c) => c.text.shadow && void (c.text.shadow.color = v))} />
            </Field>
            <SliderField label="Blur" value={t.shadow.blur} min={0} max={100} step={1} defaultValue={16} onChange={(v) => edit((c) => c.text.shadow && void (c.text.shadow.blur = v))} />
            <Field label="Offset">
              <NumberInput prefix="X" value={t.shadow.x} onChange={(v) => edit((c) => c.text.shadow && void (c.text.shadow.x = v))} min={-200} max={200} />
              <NumberInput prefix="Y" value={t.shadow.y} onChange={(v) => edit((c) => c.text.shadow && void (c.text.shadow.y = v))} min={-200} max={200} />
            </Field>
          </>
        ) : (
          <p className="hint">Add a drop shadow for depth and legibility.</p>
        )}
      </Section>

      <Section
        title="Glow"
        id="glow"
        defaultOpen={!!t.glow}
        actions={
          <Toggle
            value={!!t.glow}
            onChange={(on) =>
              edit((c) => {
                if (on) c.text.glow = { color: c.text.fill.type === 'solid' ? c.text.fill.color.slice(0, 7) : '#7c5cff', blur: 28 };
                else delete c.text.glow;
              })
            }
          />
        }
      >
        {t.glow ? (
          <>
            <Field label="Color">
              <ColorInput value={t.glow.color} onChange={(v) => edit((c) => c.text.glow && void (c.text.glow.color = v))} />
            </Field>
            <SliderField label="Size" value={t.glow.blur} min={0} max={120} step={1} defaultValue={28} onChange={(v) => edit((c) => c.text.glow && void (c.text.glow.blur = v))} />
          </>
        ) : (
          <p className="hint">Add a soft neon-style halo.</p>
        )}
      </Section>

      <Section
        title="Background"
        id="background"
        defaultOpen={!!t.background}
        actions={
          <Toggle
            value={!!t.background}
            onChange={(on) =>
              edit((c) => {
                if (on) c.text.background = { color: '#000000', opacity: 0.7, padX: 28, padY: 14, radius: 14 };
                else delete c.text.background;
              })
            }
          />
        }
      >
        {t.background ? (
          <>
            <Field label="Color">
              <ColorInput value={t.background.color} onChange={(v) => edit((c) => c.text.background && void (c.text.background.color = v.slice(0, 7)))} />
            </Field>
            <SliderField label="Opacity" value={t.background.opacity} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => edit((c) => c.text.background && void (c.text.background.opacity = v))} />
            <Field label="Padding">
              <NumberInput prefix="X" value={t.background.padX} onChange={(v) => edit((c) => c.text.background && void (c.text.background.padX = v))} min={0} max={400} />
              <NumberInput prefix="Y" value={t.background.padY} onChange={(v) => edit((c) => c.text.background && void (c.text.background.padY = v))} min={0} max={400} />
            </Field>
            <SliderField label="Roundness" value={t.background.radius} min={0} max={120} step={1} onChange={(v) => edit((c) => c.text.background && void (c.text.background.radius = v))} />
          </>
        ) : (
          <p className="hint">Put a box behind the text so it reads on any footage.</p>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Shape, sticker, generator
// ---------------------------------------------------------------------------------------------

const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'pill', 'triangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'burst', 'heart', 'arrow', 'chevron', 'line', 'cross', 'bubble', 'ring', 'frame', 'blob'];

export function ShapeSection({ clip, ids }: { clip: ShapeClip; ids: ID[] }): ReactNode {
  const s = clip.shape;
  const edit = (recipe: (c: ShapeClip) => void): void =>
    editClips(ids, (c) => {
      if (c.type === 'shape') recipe(c);
    });
  return (
    <>
      <Section title={s.slot ? 'Media placeholder' : 'Shape'} id="shape">
        {s.slot && <p className="hint">Drag a photo or video from the Media tab onto this placeholder to fill it.</p>}
        {/* Pen paths (kind 'path') are edited on the canvas and in the Path section. */}
        {!s.slot && s.kind !== 'path' && (
          <Field label="Shape">
            <Select value={s.kind} options={SHAPE_KINDS.map((k) => ({ value: k, label: labelOf(k === 'rect' ? 'rectangle' : k === 'cross' ? 'plus' : k) }))} onChange={(k) => edit((c) => void (c.shape.kind = k))} />
          </Field>
        )}
        <Field label="Size">
          <NumberInput prefix="W" value={s.width} onChange={(v) => edit((c) => void (c.shape.width = Math.max(2, Math.round(v))))} min={2} max={8000} />
          <NumberInput prefix="H" value={s.height} onChange={(v) => edit((c) => void (c.shape.height = Math.max(2, Math.round(v))))} min={2} max={8000} />
        </Field>
        {(s.kind === 'rect' || s.kind === 'frame' || s.kind === 'bubble') && (
          <SliderField label="Roundness" value={s.radius} min={0} max={Math.round(Math.min(s.width, s.height) / 2)} step={1} onChange={(v) => edit((c) => void (c.shape.radius = v))} />
        )}
      </Section>
      {!s.slot && (
        <Section title="Fill" id="fill">
          <PaintEditor paint={s.fill} onChange={(p) => edit((c) => void (c.shape.fill = p))} />
        </Section>
      )}
      <Section
        title="Outline"
        id="stroke"
        defaultOpen={!!s.stroke}
        actions={
          <Toggle
            value={!!s.stroke}
            onChange={(on) =>
              edit((c) => {
                if (on) c.shape.stroke = { color: '#ffffff', width: 6 };
                else delete c.shape.stroke;
              })
            }
          />
        }
      >
        {s.stroke ? (
          <>
            <Field label="Color">
              <ColorInput value={s.stroke.color} alpha onChange={(v) => edit((c) => c.shape.stroke && void (c.shape.stroke.color = v))} />
            </Field>
            <SliderField label="Width" value={s.stroke.width} min={0} max={80} step={0.5} precision={1} onChange={(v) => edit((c) => c.shape.stroke && void (c.shape.stroke.width = v))} />
          </>
        ) : (
          <p className="hint">Add a border to the shape.</p>
        )}
      </Section>
      <Section
        title="Shadow"
        id="shadow"
        defaultOpen={!!s.shadow}
        actions={
          <Toggle
            value={!!s.shadow}
            onChange={(on) =>
              edit((c) => {
                if (on) c.shape.shadow = { color: '#00000080', blur: 30, x: 0, y: 14 };
                else delete c.shape.shadow;
              })
            }
          />
        }
      >
        {s.shadow ? (
          <>
            <Field label="Color">
              <ColorInput value={s.shadow.color} alpha onChange={(v) => edit((c) => c.shape.shadow && void (c.shape.shadow.color = v))} />
            </Field>
            <SliderField label="Blur" value={s.shadow.blur} min={0} max={150} step={1} onChange={(v) => edit((c) => c.shape.shadow && void (c.shape.shadow.blur = v))} />
            <Field label="Offset">
              <NumberInput prefix="X" value={s.shadow.x} onChange={(v) => edit((c) => c.shape.shadow && void (c.shape.shadow.x = v))} min={-300} max={300} />
              <NumberInput prefix="Y" value={s.shadow.y} onChange={(v) => edit((c) => c.shape.shadow && void (c.shape.shadow.y = v))} min={-300} max={300} />
            </Field>
          </>
        ) : (
          <p className="hint">Lift the shape off the background.</p>
        )}
      </Section>
    </>
  );
}

export function StickerSection({ clip, ids }: { clip: StickerClip; ids: ID[] }): ReactNode {
  const def = getSticker(clip.stickerId);
  const defaults = def && def.kind === 'canvas' ? (def.colors ?? []) : [];
  const colors = defaults.map((c, i) => clip.colors?.[i] ?? c);
  const edit = (recipe: (c: StickerClip) => void): void =>
    editClips(ids, (c) => {
      if (c.type === 'sticker') recipe(c);
    });
  return (
    <Section title="Sticker" id="sticker">
      <Field label="Name">
        <span className="truncate" style={{ color: 'var(--text-0)' }}>
          {def?.name ?? 'Sticker'}
        </span>
      </Field>
      <SliderField label="Size" value={clip.size} min={24} max={1600} step={2} suffix="px" onChange={(v) => edit((c) => void (c.size = Math.round(v)))} />
      {colors.map((color, i) => (
        <Field key={i} label={`Color ${i + 1}`}>
          <ColorInput
            value={color}
            onChange={(v) =>
              edit((c) => {
                const next = defaults.map((d, k) => c.colors?.[k] ?? d);
                next[i] = v.slice(0, 7);
                c.colors = next;
              })
            }
          />
        </Field>
      ))}
      {clip.colors && (
        <div className="row-end">
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => edit((c) => void delete c.colors)}>
            Reset colors
          </button>
        </div>
      )}
    </Section>
  );
}

export function GeneratorSection({ clip, ids }: { clip: GeneratorClip; ids: ID[] }): ReactNode {
  const def = getGenerator(clip.generatorId);
  if (!def) return null;
  return (
    <Section title={def.name} id="generator">
      <ParamControls
        defs={def.params}
        values={clip.params}
        onChange={(key, value) =>
          editClips(ids, (c) => {
            if (c.type === 'generator' && c.generatorId === clip.generatorId) c.params[key] = value;
          })
        }
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Crop, mask, chroma key
// ---------------------------------------------------------------------------------------------

export function CropSection({ clip, ids }: { clip: VisualClip; ids: ID[] }): ReactNode {
  const crop = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const setCrop = (side: 'l' | 't' | 'r' | 'b', v: number): void =>
    editVisual(ids, (c) => {
      const next = { ...(c.crop ?? { l: 0, t: 0, r: 0, b: 0 }), [side]: v };
      // Never crop the picture away completely.
      if (next.l + next.r > 0.95) next[side] = Math.max(0, 0.95 - (side === 'l' ? next.r : next.l));
      if (next.t + next.b > 0.95) next[side] = Math.max(0, 0.95 - (side === 't' ? next.b : next.t));
      c.crop = next;
    });
  const active = crop.l + crop.t + crop.r + crop.b > 0 || !!clip.cornerRadius;
  return (
    <Section
      title="Crop & corners"
      id="crop"
      defaultOpen={active}
      actions={
        active ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() =>
              editVisual(ids, (c) => {
                delete c.crop;
                delete c.cornerRadius;
              })
            }
          >
            Reset
          </button>
        ) : undefined
      }
    >
      {clip.type !== 'generator' && (
        <>
          <SliderField label="Left" value={crop.l} min={0} max={0.9} step={0.005} scale={100} suffix="%" defaultValue={0} onChange={(v) => setCrop('l', v)} />
          <SliderField label="Right" value={crop.r} min={0} max={0.9} step={0.005} scale={100} suffix="%" defaultValue={0} onChange={(v) => setCrop('r', v)} />
          <SliderField label="Top" value={crop.t} min={0} max={0.9} step={0.005} scale={100} suffix="%" defaultValue={0} onChange={(v) => setCrop('t', v)} />
          <SliderField label="Bottom" value={crop.b} min={0} max={0.9} step={0.005} scale={100} suffix="%" defaultValue={0} onChange={(v) => setCrop('b', v)} />
        </>
      )}
      <SliderField label="Roundness" value={clip.cornerRadius ?? 0} min={0} max={1} step={0.01} scale={100} suffix="%" defaultValue={0} onChange={(v) => editVisual(ids, (c) => void (c.cornerRadius = v))} />
    </Section>
  );
}

const MASK_SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'star', 'heart', 'hexagon'] as const;

export function MaskSection({ clip, ids }: { clip: VisualClip; ids: ID[] }): ReactNode {
  const m = clip.mask;
  const edit = (recipe: (mask: NonNullable<VisualClip['mask']>) => void): void =>
    editVisual(ids, (c) => {
      if (c.mask) recipe(c.mask);
    });
  return (
    <Section
      title="Mask"
      id="mask"
      defaultOpen={!!m}
      actions={
        <Toggle
          value={!!m}
          onChange={(on) =>
            editVisual(ids, (c) => {
              if (on) c.mask = { ...DEFAULT_MASK, shape: 'ellipse' };
              else delete c.mask;
            })
          }
        />
      }
    >
      {m ? (
        <>
          <Field label="Shape">
            <Select value={m.shape} options={MASK_SHAPES.map((s) => ({ value: s, label: labelOf(s === 'rect' ? 'rectangle' : s) }))} onChange={(v) => edit((mask) => void (mask.shape = v))} />
          </Field>
          <SliderField label="Width" value={m.w} min={0.02} max={2} step={0.01} scale={100} suffix="%" defaultValue={0.8} onChange={(v) => edit((mask) => void (mask.w = v))} />
          <SliderField label="Height" value={m.h} min={0.02} max={2} step={0.01} scale={100} suffix="%" defaultValue={0.8} onChange={(v) => edit((mask) => void (mask.h = v))} />
          <SliderField label="Position X" value={m.cx} min={-0.5} max={0.5} step={0.005} scale={100} bipolar defaultValue={0} onChange={(v) => edit((mask) => void (mask.cx = v))} />
          <SliderField label="Position Y" value={m.cy} min={-0.5} max={0.5} step={0.005} scale={100} bipolar defaultValue={0} onChange={(v) => edit((mask) => void (mask.cy = v))} />
          <SliderField label="Rotation" value={m.rotation} min={-180} max={180} step={1} suffix="°" bipolar defaultValue={0} onChange={(v) => edit((mask) => void (mask.rotation = v))} />
          <SliderField label="Feather" value={m.feather} min={0} max={1} step={0.01} scale={100} suffix="%" defaultValue={0} onChange={(v) => edit((mask) => void (mask.feather = v))} />
          {m.shape === 'rect' && <SliderField label="Roundness" value={m.radius} min={0} max={1} step={0.01} scale={100} suffix="%" defaultValue={0} onChange={(v) => edit((mask) => void (mask.radius = v))} />}
          <Field label="Invert">
            <Toggle value={m.invert} onChange={(v) => edit((mask) => void (mask.invert = v))} />
          </Field>
        </>
      ) : (
        <p className="hint">Show only part of the layer through a shape.</p>
      )}
    </Section>
  );
}

export function ChromaSection({ clip, ids }: { clip: VisualClip; ids: ID[] }): ReactNode {
  const ck = clip.chromaKey;
  const on = !!ck?.enabled;
  const edit = (recipe: (c: NonNullable<VisualClip['chromaKey']>) => void): void =>
    editVisual(ids, (c) => {
      c.chromaKey ??= { enabled: true, color: '#00d639', similarity: 0.42, smoothness: 0.12, spill: 0.5 };
      recipe(c.chromaKey);
    });
  return (
    <Section title="Green screen" id="chroma" defaultOpen={on} actions={<Toggle value={on} onChange={(v) => edit((c) => void (c.enabled = v))} />}>
      {on && ck ? (
        <>
          <Field label="Key color">
            <ColorInput value={ck.color} onChange={(v) => edit((c) => void (c.color = v.slice(0, 7)))} />
          </Field>
          <SliderField label="Similarity" value={ck.similarity} min={0} max={1} step={0.01} scale={100} defaultValue={0.42} onChange={(v) => edit((c) => void (c.similarity = v))} />
          <SliderField label="Smoothness" value={ck.smoothness} min={0} max={1} step={0.01} scale={100} defaultValue={0.12} onChange={(v) => edit((c) => void (c.smoothness = v))} />
          <SliderField label="Spill removal" value={ck.spill} min={0} max={1} step={0.01} scale={100} defaultValue={0.5} onChange={(v) => edit((c) => void (c.spill = v))} />
        </>
      ) : (
        <p className="hint">Remove a solid background colour (chroma key). Use the picker’s eyedropper to sample the screen colour.</p>
      )}
    </Section>
  );
}

export function EditTab({ clip, ids }: { clip: Clip; ids: ID[] }): ReactNode {
  if (clip.type === 'audio') return null;
  const media = clip.type === 'video' || clip.type === 'image';
  return (
    <>
      {clip.type === 'text' && <TextSection clip={clip} ids={ids} />}
      {clip.type === 'shape' && <ShapeSection clip={clip} ids={ids} />}
      {clip.type === 'sticker' && <StickerSection clip={clip} ids={ids} />}
      {clip.type === 'generator' && <GeneratorSection clip={clip} ids={ids} />}
      {clip.type === 'adjustment' ? (
        <Section title="Adjustment layer" id="adjustment">
          <p className="hint">Everything beneath this layer is graded and stylised by its Adjust and Effects settings.</p>
          <OpacityOnly clip={clip} ids={ids} />
        </Section>
      ) : (
        <TransformSection clip={clip} ids={ids} />
      )}
      {(media || clip.type === 'generator') && <CropSection clip={clip} ids={ids} />}
      <MaskSection clip={clip} ids={ids} />
      {media && <ChromaSection clip={clip} ids={ids} />}
    </>
  );
}

function OpacityOnly({ clip, ids }: { clip: VisualClip; ids: ID[] }): ReactNode {
  const opacity = useLiveProp(clip, 'opacity');
  return (
    <SliderField
      label="Strength"
      value={opacity}
      min={0}
      max={1}
      step={0.01}
      scale={100}
      suffix="%"
      defaultValue={1}
      onChange={(v) => editClips(ids, (c) => writeProp(c, 'opacity', v))}
      lead={<KeyframeButton clip={clip} ids={ids} props={['opacity']} />}
    />
  );
}
