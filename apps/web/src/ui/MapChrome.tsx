import { useEffect, useRef, useState } from 'react';
import { IMAGERY_PROVIDERS, coverageContains, coversArea, findAnyProvider, ringBBox, type ImageryProvider } from '@marco-polo/core';
import { useStore } from '../state/store.js';
import { emit, on } from '../lib/bus.js';
import { formatCaptureDate, formatCount, formatLandArea, formatLength, formatResolution, plural } from '../lib/format.js';
import { formatDegrees, metresPerPixel, scaleFor } from '../map/frame.js';
import { sourceKind } from './model.js';
import { useAreaFacts, useMapView, useScanSources, useTileCounts } from './hooks.js';
import { useUi } from './uiState.js';
import { IconChevron, IconMinus, IconPlus, IconRect, IconShape } from './icons.js';

function centreOf(area: [number, number][] | null, view: { bbox: [number, number, number, number] } | null) {
  if (area && area.length) {
    const b = ringBBox(area);
    return { lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 };
  }
  if (view) return { lon: (view.bbox[0] + view.bbox[2]) / 2, lat: (view.bbox[1] + view.bbox[3]) / 2 };
  return null;
}

/** The imagery the map shows outside any area, as the map reports it. */
function useBaseSource(): ImageryProvider | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => on('basesource', (e) => setId(e.id)), []);
  return id ? (findAnyProvider(id) ?? null) : null;
}

interface StripSource {
  name: string | null;
  kind: string | null;
  res: string | null;
  date: string | null;
  zoom: number | null;
}

/**
 * What the strip says about the imagery: always what the map shows. With no
 * area that is the background layer the map is drawing; with an area, the
 * sources it is (or will be) scanned on, which the map shows inside it.
 */
function useStripSource(): StripSource {
  const phase = useStore((s) => s.phase);
  const scanned = useScanSources();
  const planned = useAreaFacts();
  const base = useBaseSource();
  const list = phase === 'idle' ? [] : phase === 'ready' ? (planned?.sources ?? []) : scanned;
  if (list.length === 1) {
    const s = list[0];
    return { name: s.name, kind: s.kind, res: formatResolution(s.resM), date: formatCaptureDate(s.date), zoom: s.zoom };
  }
  if (list.length > 1) {
    const zooms = new Set(list.map((s) => s.zoom));
    return { name: `${list.length} sources`, kind: null, res: 'Mixed', date: 'Mixed', zoom: zooms.size === 1 ? list[0].zoom : null };
  }
  if (base) {
    return { name: base.name, kind: sourceKind(base.id), res: formatResolution(base.nativeResM), date: formatCaptureDate(base.date), zoom: null };
  }
  return { name: null, kind: null, res: null, date: null, zoom: null };
}

const KIND_LABEL: Record<string, string> = { aerial: 'Aerial', satellite: 'Satellite' };

/**
 * The tile count as the strip shows it: the plan, then tiles done of the
 * total (the same number as the progress), with failed tiles and tiles
 * without imagery named as the summary names them.
 */
function useTilesText(zoom: number | null): string {
  const phase = useStore((s) => s.phase);
  const planned = useAreaFacts();
  const t = useTileCounts();
  const z = zoom != null ? `, z${zoom}` : '';
  if (phase === 'idle') return 'No area';
  if (phase === 'ready') return planned ? `${planned.approximate ? 'About ' : ''}${plural(planned.tiles, 'tile')}${z}` : 'No area';
  const issues = [t.failed ? `${formatCount(t.failed)} failed` : null, t.noCoverage ? `${formatCount(t.noCoverage)} no imagery` : null].filter(Boolean);
  return `${formatCount(t.done)}/${formatCount(t.total)}${issues.length ? `, ${issues.join(', ')}` : z}`;
}

/* Scale bar: worked out from the camera on every move, written straight into the DOM. */

function lengthText(m: number): [string, string] {
  return m >= 1000 ? [String(m / 1000), 'km'] : [String(m), 'm'];
}

function ScaleBar({ maxPx, ticks }: { maxPx: number; ticks: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      on('camera', ({ zoom, lat }) => {
        const el = ref.current;
        if (!el) return;
        const { metres, px } = scaleFor(metresPerPixel(zoom, lat), maxPx);
        const [n, unit] = lengthText(metres);
        const [h] = lengthText(metres / 2);
        const q = (px / 4).toFixed(1);
        el.style.width = `${px.toFixed(1)}px`;
        el.innerHTML =
          (ticks
            ? `<span class="sl"><span style="left:0">0</span>${px >= 64 ? `<span style="left:50%">${h}</span>` : ''}<span style="left:100%">${n}</span></span>`
            : '') +
          `<span class="sbar"><i class="f" style="width:${q}px"></i><i style="width:${q}px"></i><i class="f" style="width:${(px / 2).toFixed(1)}px"></i></span>`;
        const label = el.nextElementSibling;
        if (label) label.textContent = ticks ? unit : `${n} ${unit}`;
      }),
    [maxPx, ticks],
  );
  return (
    <span className="scale" aria-hidden="true">
      <span className="scale-bar" ref={ref} />
      <span className="scale-unit" />
    </span>
  );
}

/** The scale on the map corner, for when the strip has no room for it. */
export function MapScale() {
  return (
    <div className="map-scale" data-map-occluder>
      <ScaleBar maxPx={100} ticks />
    </div>
  );
}

/** The pointer position, or the size of the shape being drawn, written without re-rendering. */
function CursorCell() {
  const label = useRef<HTMLSpanElement>(null);
  const value = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let drafting = false;
    let last: { lon: number; lat: number } | null = null;
    const position = () => (last ? `${formatDegrees(last.lat, 6)}, ${formatDegrees(last.lon, 6)}` : 'Point at the map');
    const offCursor = on('cursor', (c) => {
      last = c;
      if (drafting || !value.current) return;
      value.current.textContent = position();
    });
    const offDraft = on('draft', (d) => {
      if (!label.current || !value.current) return;
      drafting = d != null;
      label.current.textContent = d ? 'Drawing' : 'Cursor';
      if (d) {
        const size = d.widthM != null && d.heightM != null ? `${formatLength(d.widthM)} × ${formatLength(d.heightM)}, ` : '';
        value.current.textContent = `${size}${formatLandArea(d.areaM2)}`;
      } else {
        // The shape is done: back to where the pointer is.
        value.current.textContent = position();
      }
    });
    return () => {
      offCursor();
      offDraft();
    };
  }, []);
  return (
    <div className="cell cursor">
      <span className="k" ref={label}>
        Cursor
      </span>
      <span ref={value}>Point at the map</span>
    </div>
  );
}

/** The imagery cell: names the source and opens the picker. */
function ImageryCell({ name }: { name: string | null }) {
  const imagery = useStore((s) => s.settings.imagery);
  const open = useUi((s) => s.sourcePickerOpen);
  const setOpen = useUi((s) => s.setSourcePickerOpen);
  return (
    <div className="cell imagery">
      <button className="cell-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="k">Imagery</span>
        <span className="cell-val">
          <span className="k2">{imagery.mode === 'auto' ? 'Auto' : 'Fixed'}</span>
          {name && (
            <span className="trunc" title={name}>
              {name}
            </span>
          )}
          <IconChevron />
        </span>
      </button>
      {open && <SourcePicker onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The data strip under the map, like the data band of an aerial negative:
 * imagery, resolution, capture date, CRS, tiles, scale and cursor, then the
 * credits. Every value is one the app already works out.
 */
export function DataStrip({ phone }: { phone: boolean }) {
  const src = useStripSource();
  const tiles = useTilesText(src.zoom);
  const attribOpen = useUi((s) => s.attribOpen);
  const setAttribOpen = useUi((s) => s.setAttribOpen);

  if (phone) {
    const line = [src.name, src.res, tiles].filter(Boolean).join(', ');
    return (
      <div className="strip phone-strip">
        <div className="strip-line">
          <span className="trunc" title={line}>
            {line}
          </span>
          <ScaleBar maxPx={64} ticks={false} />
        </div>
        <div className={`attrib-line${attribOpen ? ' open' : ''}`}>
          <div className="attrib" id="map-attrib" ref={attribSlot} />
          <button className="attrib-btn" aria-expanded={attribOpen} aria-controls="map-attrib" onClick={() => setAttribOpen(!attribOpen)}>
            {attribOpen ? 'Less' : 'Credits'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="strip">
      <div className="strip-cells">
        <ImageryCell name={src.name} />
        <div className="cell">
          <span className="k">{(src.kind && KIND_LABEL[src.kind]) || 'Resolution'}</span>
          <span>{src.res ?? 'Not given'}</span>
        </div>
        <div className="cell">
          <span className="k">Captured</span>
          <span>{src.date ?? 'Not given'}</span>
        </div>
        <div className="cell">
          <span className="k">CRS</span>
          <span>EPSG:3857</span>
        </div>
        <div className="cell">
          <span className="k">Tiles</span>
          <span>{tiles}</span>
        </div>
        <div className="cell grow scale-cell">
          <ScaleBar maxPx={110} ticks />
        </div>
        <CursorCell />
      </div>
      <div className="attrib" id="map-attrib" ref={attribSlot} />
    </div>
  );
}

/** Tells the map where its credits go; a stable ref, so it fires on mount and unmount only. */
function attribSlot(el: HTMLDivElement | null): void {
  emit('attribslot', { el });
}

/** Zoom and the two drawing tools, in the corner of the map. */
export function MapTools() {
  const phase = useStore((s) => s.phase);
  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const busy = phase === 'scanning' || phase === 'paused';
  return (
    <div className="tools" role="toolbar" aria-label="Map tools" data-map-occluder>
      <button aria-label="Zoom in" title="Zoom in" onClick={() => emit('zoomby', { delta: 1 })}>
        <IconPlus />
      </button>
      <button aria-label="Zoom out" title="Zoom out" onClick={() => emit('zoomby', { delta: -1 })}>
        <IconMinus />
      </button>
      <hr />
      <button
        aria-label="Draw a rectangle"
        title="Draw a rectangle (R)"
        aria-pressed={drawMode === 'rect'}
        disabled={busy}
        onClick={() => setDrawMode(drawMode === 'rect' ? null : 'rect')}
      >
        <IconRect />
      </button>
      <button
        aria-label="Draw a shape"
        title="Draw a shape (P)"
        aria-pressed={drawMode === 'polygon'}
        disabled={busy}
        onClick={() => setDrawMode(drawMode === 'polygon' ? null : 'polygon')}
      >
        <IconShape />
      </button>
    </div>
  );
}

/** Auto, or one keyless source that allows scanning and covers the area. */
export function SourcePicker({ onClose }: { onClose?: () => void }) {
  const imagery = useStore((s) => s.settings.imagery);
  const phase = useStore((s) => s.phase);
  const area = useStore((s) => s.area);
  const update = useStore((s) => s.updateSettings);
  const view = useMapView();
  const ref = useRef<HTMLDivElement>(null);
  const locked = phase === 'scanning' || phase === 'paused';
  const centre = centreOf(area, view);
  const value = imagery.mode === 'auto' ? 'auto' : imagery.providerId;

  useEffect(() => {
    if (!onClose) return;
    ref.current?.querySelector<HTMLInputElement>('input:checked, input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const covers = (p: ImageryProvider) =>
    !p.coverage || (area ? coversArea(p, area) : centre ? coverageContains(p.coverage, centre.lon, centre.lat) : true);

  const choose = (v: string) => {
    update({ imagery: v === 'auto' ? { mode: 'auto' } : { mode: 'fixed', providerId: v } });
    onClose?.();
  };

  return (
    <div className={onClose ? 'popover' : 'picker'} ref={ref} role={onClose ? 'dialog' : undefined} aria-label="Imagery">
      <fieldset disabled={locked}>
        <legend>Imagery</legend>
        <label className="opt">
          <input type="radio" name="imagery" checked={value === 'auto'} onChange={() => choose('auto')} />
          <span>
            <b>Auto</b>
            <span className="opt-sub">The best open source for each part of the area</span>
          </span>
        </label>
        {IMAGERY_PROVIDERS.filter((p) => p.scanAllowed).map((p) => {
          const ok = covers(p);
          return (
            <label className={`opt${ok ? '' : ' off'}`} key={p.id}>
              <input
                type="radio"
                name="imagery"
                checked={value === p.id}
                disabled={!ok}
                onChange={() => choose(p.id)}
              />
              <span>
                <b>{p.name}</b>
                <span className="opt-sub">{ok ? p.licence : 'Does not cover this place'}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {locked && <p className="note-inline">The imagery can change once the scan ends.</p>}
    </div>
  );
}

const Swatch = ({ kind }: { kind: 'wait' | 'busy' | 'done' | 'pool' }) => (
  <svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true">
    {kind === 'wait' && <rect x="1" y="1" width="14" height="10" fill="var(--veil)" fillOpacity="0.7" stroke="var(--ink-3)" strokeDasharray="2 2" />}
    {kind === 'busy' && <rect x="1" y="1" width="14" height="10" fill="none" stroke="var(--ink)" strokeWidth="1.5" />}
    {kind === 'done' && <rect x="1" y="1" width="14" height="10" fill="none" stroke="var(--ink-3)" strokeWidth="1" />}
    {kind === 'pool' && (
      <>
        <rect x="3" y="2.5" width="10" height="7" rx="2" fill="none" stroke="var(--casing)" strokeWidth="3" />
        <rect x="3" y="2.5" width="10" height="7" rx="2" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      </>
    )}
  </svg>
);

/** What the tile states on the map mean, shown while a scan runs. */
export function Legend() {
  return (
    <div className="legend" role="note" aria-label="Map key" data-map-occluder>
      <span>
        <Swatch kind="wait" />
        Waiting
      </span>
      <span>
        <Swatch kind="busy" />
        Scanning
      </span>
      <span>
        <Swatch kind="done" />
        Done
      </span>
      <span>
        <Swatch kind="pool" />
        Pool
      </span>
    </div>
  );
}
