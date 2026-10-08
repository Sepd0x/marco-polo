import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { RankedDetection } from '@marco-polo/core';
import { useStore } from '../state/store.js';
import { formatArea, formatCount, formatDims, formatScore } from '../lib/format.js';
import { dimsOf, thumbFor, thumbFrame } from './model.js';
import { PoolThumb } from './PoolThumb.js';

const RENDER_CAP = 200;

export const rowId = (id: string) => `pool-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/**
 * The pools as a listbox: arrow keys move the selection, and the inspector
 * and the map follow it.
 */
export function PoolList({
  pools,
  newest,
  label,
  limit = RENDER_CAP,
  headers = true,
  onPick,
}: {
  pools: RankedDetection[];
  newest: string | null;
  label: string;
  limit?: number;
  headers?: boolean;
  onPick?: (id: string) => void;
}) {
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const thumbs = useStore((s) => s.thumbs);
  const parts = useStore((s) => s.parts);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = pools.slice(0, limit);

  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector(`#${rowId(selectedId)}`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  const pick = (id: string) => {
    select(id);
    onPick?.(id);
  };

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

  const active = shown.some((d) => d.id === selectedId) ? rowId(selectedId!) : undefined;

  return (
    <>
      {headers && shown.length > 0 && (
        <div className="cols" aria-hidden="true">
          <span>#</span>
          <span />
          <span>Area and size, 30 m view</span>
          <span>Score</span>
        </div>
      )}
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
              onClick={() => pick(d.id)}
            >
              <span className="n">{d.rank}</span>
              <PoolThumb detection={d} image={thumbFor(d, thumbs, thumbFrame(d, parts))} width={40} />
              <span className="row-main">
                <span className="a">
                  {formatArea(d.areaM2)}
                  {d.kind === 'hot_tub' && <span className="kind-tag">Hot tub</span>}
                  {isNew && <span className="new-tag">New</span>}
                </span>
                <span className="d">{formatDims(dimsOf(d))}</span>
              </span>
              <span className="s">
                <span className="sr-only">Score </span>
                {formatScore(d.confidence)}
              </span>
            </li>
          );
        })}
      </ul>
      {pools.length > limit && limit === RENDER_CAP && (
        <p className="note">
          Showing the first {formatCount(limit)}. The CSV and GeoJSON have all {formatCount(pools.length)}.
        </p>
      )}
    </>
  );
}
