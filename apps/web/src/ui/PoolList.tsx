import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { RankedDetection } from '@marco-polo/core';
import { useStore } from '../state/store.js';
import { formatArea, formatCount, formatScore } from '../lib/format.js';
import { dimsOf, thumbFor, thumbFrame } from './model.js';
import { PoolThumb } from './PoolThumb.js';
import { PoolRecord } from './Record.js';

const RENDER_CAP = 200;

export const rowId = (id: string) => `pool-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** Length by width in the list column, where the header already says metres. */
function dimsCell(d: RankedDetection): string {
  const dims = dimsOf(d);
  return dims ? `${dims.lengthM.toFixed(1)} × ${dims.widthM.toFixed(1)}` : 'Not measured';
}

/**
 * The pools as a listbox: arrow keys move the selection, and the map follows
 * it. The open pool's record sits right under its row. It is kept outside the
 * listbox, which may hold options only, and laid over the space its row
 * leaves free for it.
 */
export function PoolList({
  pools,
  newest,
  label,
  limit = RENDER_CAP,
}: {
  pools: RankedDetection[];
  newest: string | null;
  label: string;
  limit?: number;
}) {
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const thumbs = useStore((s) => s.thumbs);
  const parts = useStore((s) => s.parts);
  const listRef = useRef<HTMLUListElement>(null);
  const recRef = useRef<HTMLElement>(null);
  const openRow = useRef<HTMLElement | null>(null);
  const shown = pools.slice(0, limit);
  const open = shown.find((d) => d.id === selectedId) ?? null;

  // Room for the record under the open row, and the record placed in it.
  useLayoutEffect(() => {
    const row = open ? listRef.current?.querySelector<HTMLElement>(`#${rowId(open.id)}`) : null;
    if (openRow.current && openRow.current !== row) openRow.current.style.paddingBottom = '';
    openRow.current = row ?? null;
    const rec = recRef.current;
    if (!row || !rec) return;
    const place = () => {
      row.style.paddingBottom = `${rec.offsetHeight}px`;
      rec.style.top = `${row.offsetTop + row.offsetHeight - rec.offsetHeight}px`;
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(rec);
    return () => ro.disconnect();
  });

  useEffect(() => {
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`#${rowId(selectedId)}`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (shown.length === 0) return;
    const i = shown.findIndex((d) => d.id === selectedId);
    let next = -1;
    if (e.key === 'ArrowDown') next = i < 0 ? 0 : Math.min(shown.length - 1, i + 1);
    else if (e.key === 'ArrowUp') next = i < 0 ? 0 : Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = shown.length - 1;
    else return;
    e.preventDefault();
    select(shown[next].id);
  };

  const active = open ? rowId(open.id) : undefined;

  return (
    <>
      {shown.length > 0 && (
        <div className="cols" aria-hidden="true">
          <span>#</span>
          <span />
          <span>Area</span>
          <span className="r">L × W, m</span>
          <span className="r">Score</span>
        </div>
      )}
      <div className="list-wrap">
        <ul
          className="rows"
          role="listbox"
          aria-label={label}
          tabIndex={shown.length ? 0 : -1}
          aria-activedescendant={active}
          onKeyDown={onKeyDown}
          ref={listRef}
        >
          {shown.map((d) => {
            const sel = d.id === selectedId;
            const isNew = d.id === newest;
            return (
              <li
                key={d.id}
                id={rowId(d.id)}
                role="option"
                aria-selected={sel}
                className={`row${sel ? ' sel' : ''}${isNew ? ' new' : ''}`}
                onClick={() => select(sel ? null : d.id)}
              >
                <span className="n">{d.rank}</span>
                <PoolThumb detection={d} image={thumbFor(d, thumbs, thumbFrame(d, parts))} width={40} />
                <span className="a">
                  <b>{formatArea(d.areaM2)}</b>
                  {d.kind === 'hot_tub' && <span className="kind-tag">Hot tub</span>}
                  {isNew && <span className="new-tag">New</span>}
                </span>
                <span className="d">{dimsCell(d)}</span>
                <span className="s">
                  <span className="sr-only">Score </span>
                  {formatScore(d.confidence)}
                </span>
              </li>
            );
          })}
        </ul>
        {open && <PoolRecord detection={open} ref={recRef} />}
      </div>
      {pools.length > limit && limit === RENDER_CAP && (
        <p className="note">
          Showing the first {formatCount(limit)}. The CSV and GeoJSON have all {formatCount(pools.length)}.
        </p>
      )}
    </>
  );
}
