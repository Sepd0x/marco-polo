import { useEffect, useRef } from 'react';
import { IMAGERY_PROVIDERS, coverageContains, coversArea, ringBBox, type ImageryProvider } from '@marco-polo/core';
import { useStore } from '../state/store.js';
import { chipSource } from './model.js';
import { useMapView, useScanSources } from './hooks.js';
import { useUi } from './uiState.js';
import { IconChevron, IconLayers } from './icons.js';

function centreOf(area: [number, number][] | null, view: { bbox: [number, number, number, number] } | null) {
  if (area && area.length) {
    const b = ringBBox(area);
    return { lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 };
  }
  if (view) return { lon: (view.bbox[0] + view.bbox[2]) / 2, lat: (view.bbox[1] + view.bbox[3]) / 2 };
  return null;
}

/** The source shown on the chip: the scanned one once a scan exists, else the one that would be used here. */
export function useChipSource(): ImageryProvider | { name: string } | null {
  const phase = useStore((s) => s.phase);
  const imagery = useStore((s) => s.settings.imagery);
  const area = useStore((s) => s.area);
  const view = useMapView();
  const scanned = useScanSources();
  if (phase === 'scanning' || phase === 'paused' || phase === 'complete') {
    if (scanned.length === 1) return { name: scanned[0].name };
    if (scanned.length > 1) return { name: `${scanned.length} sources` };
  }
  return chipSource(imagery, centreOf(area, view));
}

/** Chip on the map naming the imagery; opens the source picker. */
export function ImageryChip() {
  const imagery = useStore((s) => s.settings.imagery);
  const open = useUi((s) => s.sourcePickerOpen);
  const setOpen = useUi((s) => s.setSourcePickerOpen);
  const source = useChipSource();
  return (
    <div className="chip-wrap">
      <button
        className="chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconLayers />
        <span>Imagery</span>
        <b>{imagery.mode === 'auto' ? 'Auto' : 'Fixed'}</b>
        {source && <span>{source.name}</span>}
        <IconChevron />
      </button>
      {open && <SourcePicker onClose={() => setOpen(false)} />}
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
    {kind === 'wait' && <rect x="1" y="1" width="14" height="10" fill="#b9bab4" stroke="#6b6c66" strokeDasharray="2 2" />}
    {kind === 'busy' && (
      <rect x="1" y="1" width="14" height="10" fill="#d8d9d3" stroke="#17171a" strokeWidth="1.5" strokeDasharray="4 2" />
    )}
    {kind === 'done' && <rect x="1" y="1" width="14" height="10" fill="#6f8a5c" />}
    {kind === 'pool' && (
      <>
        <rect x="3" y="2.5" width="10" height="7" rx="2" fill="none" stroke="#10140a" strokeWidth="3" />
        <rect x="3" y="2.5" width="10" height="7" rx="2" fill="none" stroke="#c6f432" strokeWidth="1.5" />
      </>
    )}
  </svg>
);

/** What the tile states on the map mean, shown while a scan runs. */
export function Legend() {
  return (
    <div className="legend" role="note" aria-label="Map key">
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
