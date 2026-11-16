import { Ban } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { makeEffect } from '@/core/factory';
import { EFFECTS, FILTERS, TRANSITIONS } from '@/library';
import type { EffectDef, FilterDef, TransitionDef } from '@/library/types';
import { addTransition, applyEffect, applyFilter } from '../actions';
import { startDrag } from '../dnd';
import { Chips, SearchBox, labelOf, unique, useIncremental } from './common';
import { LiveThumb, demoImageLayer, projectFromLayers, transitionDemoProject, type ThumbSpec } from './thumbs';

const W = 224;
const H = 126;

/** Scale the 16:9 demo picture so it covers the tile. */
function coverLayer(duration: number): ReturnType<typeof demoImageLayer> {
  return demoImageLayer(duration);
}

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

function TransitionTile({ def }: { def: TransitionDef }): ReactNode {
  // The poster sits a little before the midpoint: dips and flashes are fully opaque at 50%.
  const build = useCallback((): ThumbSpec => ({ project: transitionDemoProject(def.id, W, H), poster: 1.36, from: 0.75, to: 2.25 }), [def]);
  return (
    <div
      className="tile"
      title={`${def.name}\nClick to add at the nearest cut, or drag between two clips`}
      onPointerDown={(e) => startDrag(e, { kind: 'transition', type: def.id }, def.name, () => addTransition(def.id))}
    >
      <div className="tile__thumb" style={{ aspectRatio: `${W} / ${H}` }}>
        <LiveThumb id={`tr:${def.id}`} width={W} height={H} build={build} />
      </div>
      <div className="tile__label truncate">{def.name}</div>
    </div>
  );
}

export function TransitionsTab(): ReactNode {
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const categories = useMemo(() => unique(TRANSITIONS.map((t) => t.category)), []);
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return TRANSITIONS.filter((t) => (category === 'all' || t.category === category) && (!term || t.name.toLowerCase().includes(term) || t.category.includes(term)));
  }, [category, search]);
  const { count, sentinel } = useIncremental(list.length, 30, `${category}|${search}`);
  return (
    <div className="lib">
      <header className="lib__head">
        <h3>Transitions</h3>
        <span className="badge">{TRANSITIONS.length}</span>
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder="Search transitions" />
      </div>
      <Chips value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]} />
      <div className="lib__scroll">
        <div className="grid grid--3">
          {list.slice(0, count).map((t) => (
            <TransitionTile key={t.id} def={t} />
          ))}
        </div>
        {list.length === 0 && (
          <div className="empty">
            <div className="empty__title">No transitions found</div>
          </div>
        )}
        {sentinel}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

function EffectTile({ def }: { def: EffectDef }): ReactNode {
  const build = useCallback((): ThumbSpec => {
    const layer = coverLayer(4);
    layer.effects = [makeEffect(def.id)];
    return { project: projectFromLayers([layer], W, H, '#000000', true), poster: 1.2, from: 0, to: 4 };
  }, [def]);
  return (
    <div
      className="tile"
      title={`${def.name}\nClick to apply to the selected clip, or drag onto a clip`}
      onPointerDown={(e) => startDrag(e, { kind: 'effect', effectId: def.id }, def.name, () => applyEffect(def.id))}
    >
      <div className="tile__thumb" style={{ aspectRatio: `${W} / ${H}` }}>
        <LiveThumb id={`fx:${def.id}`} width={W} height={H} build={build} animate={!!def.animated} />
      </div>
      <div className="tile__label truncate">{def.name}</div>
    </div>
  );
}

export function EffectsTab(): ReactNode {
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const categories = useMemo(() => unique(EFFECTS.map((t) => t.category)), []);
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return EFFECTS.filter((t) => (category === 'all' || t.category === category) && (!term || t.name.toLowerCase().includes(term) || t.category.includes(term)));
  }, [category, search]);
  const { count, sentinel } = useIncremental(list.length, 30, `${category}|${search}`);
  return (
    <div className="lib">
      <header className="lib__head">
        <h3>Effects</h3>
        <span className="badge">{EFFECTS.length}</span>
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder="Search effects" />
      </div>
      <Chips value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]} />
      <div className="lib__scroll">
        <div className="grid grid--3">
          {list.slice(0, count).map((t) => (
            <EffectTile key={t.id} def={t} />
          ))}
        </div>
        {list.length === 0 && (
          <div className="empty">
            <div className="empty__title">No effects found</div>
          </div>
        )}
        {sentinel}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

function FilterTile({ def }: { def: FilterDef }): ReactNode {
  const build = useCallback((): ThumbSpec => {
    const layer = coverLayer(1);
    layer.filter = { id: def.id, intensity: 1 };
    return { project: projectFromLayers([layer], W, H, '#000000', true), poster: 0, from: 0, to: 1 };
  }, [def]);
  return (
    <div
      className="tile"
      title={`${def.name}\nClick to apply to the selected clip, or drag onto a clip`}
      onPointerDown={(e) => startDrag(e, { kind: 'filter', filterId: def.id }, def.name, () => applyFilter(def.id))}
    >
      <div className="tile__thumb" style={{ aspectRatio: `${W} / ${H}` }}>
        <LiveThumb id={`flt:${def.id}`} width={W} height={H} build={build} animate={false} />
      </div>
      <div className="tile__label truncate">{def.name}</div>
    </div>
  );
}

export function FiltersTab(): ReactNode {
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const categories = useMemo(() => unique(FILTERS.map((t) => t.category)), []);
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return FILTERS.filter((t) => (category === 'all' || t.category === category) && (!term || t.name.toLowerCase().includes(term) || t.category.includes(term)));
  }, [category, search]);
  const { count, sentinel } = useIncremental(list.length, 36, `${category}|${search}`);
  return (
    <div className="lib">
      <header className="lib__head">
        <h3>Filters</h3>
        <span className="badge">{FILTERS.length}</span>
      </header>
      <div className="lib__search">
        <SearchBox value={search} onChange={setSearch} placeholder="Search filters" />
      </div>
      <Chips value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c, label: labelOf(c) }))]} />
      <div className="lib__scroll">
        <div className="grid grid--3">
          {category === 'all' && !search && (
            <div className="tile" title="Remove the filter from the selected clip" onClick={() => applyFilter(null)}>
              <div className="tile__thumb tile__thumb--none" style={{ aspectRatio: `${W} / ${H}` }}>
                <Ban size={20} />
              </div>
              <div className="tile__label truncate">None</div>
            </div>
          )}
          {list.slice(0, count).map((t) => (
            <FilterTile key={t.id} def={t} />
          ))}
        </div>
        {list.length === 0 && (
          <div className="empty">
            <div className="empty__title">No filters found</div>
          </div>
        )}
        {sentinel}
      </div>
    </div>
  );
}
