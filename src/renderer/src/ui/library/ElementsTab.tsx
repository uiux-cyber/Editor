import { Layers, PenTool } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { makeGenerator } from '@/core/factory';
import type { ShapeKind } from '@/core/types';
import { shapePath } from '@/engine/sources/shape';
import { GENERATORS } from '@/library';
import { useUI } from '@/store/ui';
import type { GeneratorDef } from '@/library/types';
import { addAdjustment, addGenerator, addShape } from '../actions';
import { startDrag } from '../dnd';
import { Chips, labelOf, unique } from './common';
import { LiveThumb, projectFromLayers, type ThumbSpec } from './thumbs';

const SHAPES: { kind: ShapeKind; name: string }[] = [
  { kind: 'rect', name: 'Rectangle' },
  { kind: 'ellipse', name: 'Circle' },
  { kind: 'pill', name: 'Pill' },
  { kind: 'triangle', name: 'Triangle' },
  { kind: 'diamond', name: 'Diamond' },
  { kind: 'pentagon', name: 'Pentagon' },
  { kind: 'hexagon', name: 'Hexagon' },
  { kind: 'octagon', name: 'Octagon' },
  { kind: 'star', name: 'Star' },
  { kind: 'burst', name: 'Burst' },
  { kind: 'heart', name: 'Heart' },
  { kind: 'arrow', name: 'Arrow' },
  { kind: 'chevron', name: 'Chevron' },
  { kind: 'line', name: 'Line' },
  { kind: 'cross', name: 'Plus' },
  { kind: 'bubble', name: 'Speech bubble' },
  { kind: 'ring', name: 'Ring' },
  { kind: 'frame', name: 'Frame' },
  { kind: 'blob', name: 'Blob' },
];

function ShapeTile({ kind, name }: { kind: ShapeKind; name: string }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const size = canvas.width;
    const wide = kind === 'line' || kind === 'arrow' || kind === 'pill';
    const w = size * 0.74;
    const h = kind === 'line' ? size * 0.06 : wide ? size * 0.34 : size * 0.74;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate((size - w) / 2, (size - h) / 2);
    const path = new Path2D();
    const rule = shapePath(path, kind, w, h, kind === 'rect' || kind === 'frame' ? size * 0.08 : 0);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#9d85ff');
    g.addColorStop(1, '#22d3ee');
    ctx.fillStyle = g;
    ctx.fill(path, rule);
    ctx.restore();
  }, [kind]);
  return (
    <button type="button" className="shape-tile" title={name} onPointerDown={(e) => startDrag(e, { kind: 'shape', shape: kind }, name, () => addShape(kind))}>
      <canvas ref={ref} width={96} height={96} />
    </button>
  );
}

const GEN_W = 224;
const GEN_H = 126;

function GeneratorTile({ def }: { def: GeneratorDef }): ReactNode {
  const build = useCallback((): ThumbSpec => ({ project: projectFromLayers([makeGenerator(def.id, { duration: 600 })], GEN_W, GEN_H), poster: 2, from: 0, to: 600 }), [def]);
  return (
    <div className="tile" title={`${def.name}\nClick to add at the playhead, or drag to the timeline`} onPointerDown={(e) => startDrag(e, { kind: 'generator', generatorId: def.id }, def.name, () => addGenerator(def.id))}>
      <div className="tile__thumb" style={{ aspectRatio: `${GEN_W} / ${GEN_H}` }}>
        <LiveThumb id={`gen:${def.id}`} width={GEN_W} height={GEN_H} build={build} />
      </div>
      <div className="tile__label truncate">{def.name}</div>
    </div>
  );
}

export function ElementsTab(): ReactNode {
  const [category, setCategory] = useState<string>('all');
  const categories = useMemo(() => unique(GENERATORS.map((g) => g.category)), []);
  const generators = useMemo(() => GENERATORS.filter((g) => category === 'all' || g.category === category), [category]);
  return (
    <div className="lib">
      <header className="lib__head">
        <h3>Elements</h3>
      </header>
      <div className="lib__scroll">
        <button
          type="button"
          className="feature-row"
          title="Adds a layer whose colour grade, filter and effects apply to everything beneath it"
          onPointerDown={(e) => startDrag(e, { kind: 'adjustment' }, 'Adjustment layer', () => addAdjustment())}
        >
          <span className="feature-row__icon">
            <Layers size={16} />
          </span>
          <span>
            <strong>Adjustment layer</strong>
            <small>Grade and stylise every layer below it</small>
          </span>
        </button>
        <button type="button" className="feature-row" title="Draw your own shape or line on the canvas (P)" data-pen-row onClick={() => useUI.getState().setTool('pen')}>
          <span className="feature-row__icon">
            <PenTool size={16} />
          </span>
          <span>
            <strong>Draw with the pen</strong>
            <small>Click points on the canvas, drag for curves (P)</small>
          </span>
        </button>

        <h4 className="lib__subhead">Shapes</h4>
        <div className="grid grid--shapes">
          {SHAPES.map((s) => (
            <ShapeTile key={s.kind} kind={s.kind} name={s.name} />
          ))}
        </div>

        <h4 className="lib__subhead">
          Animated backgrounds <span className="badge">{GENERATORS.length}</span>
        </h4>
        <div style={{ margin: '0 -12px 8px' }}>
          <Chips value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]} />
        </div>
        <div className="grid grid--3">
          {generators.map((g) => (
            <GeneratorTile key={g.id} def={g} />
          ))}
        </div>
      </div>
    </div>
  );
}
