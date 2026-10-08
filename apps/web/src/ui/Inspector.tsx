import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { formatArea, formatDims, formatLatLon, formatScore } from '../lib/format.js';
import { googleMapsUrl } from '../lib/links.js';
import { dimsOf, sortPools, thumbFor } from './model.js';
import { usePools } from './hooks.js';
import { useUi } from './uiState.js';
import { PoolThumb } from './PoolThumb.js';
import { IconCheck, IconClose, IconCopy, IconExternal, IconNext, IconPrev } from './icons.js';

/** The selected pool: crop of the scanned imagery, measurements, place, and a way out to Google Maps. */
export function Inspector({ phone, sourceName }: { phone: boolean; sourceName: string | null }) {
  const selectedId = useStore((s) => s.selectedId);
  const ranked = useStore((s) => s.ranked);
  const thumbs = useStore((s) => s.thumbs);
  const select = useStore((s) => s.select);
  const sort = useUi((s) => s.sort);
  const { shown } = usePools();
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [selectedId]);

  if (!selectedId) return null;
  const list = sortPools(shown, sort);
  const pos = list.findIndex((d) => d.id === selectedId);
  const d = pos >= 0 ? list[pos] : ranked.find((r) => r.id === selectedId);
  if (!d) return null;

  const title = `Pool #${d.rank}`;
  const dims = dimsOf(d);
  const coords = formatLatLon(d.center.lat, d.center.lon);
  const step = (k: number) => {
    if (list.length === 0) return;
    const i = pos < 0 ? 0 : (pos + k + list.length) % list.length;
    select(list[i].id);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatLatLon(d.center.lat, d.center.lon, 6));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const nav = (
    <>
      {pos >= 0 && (
        <span className="of">
          {pos + 1} of {list.length}
        </span>
      )}
      <button className="icon-btn" aria-label="Previous pool" onClick={() => step(-1)} disabled={list.length < 2}>
        <IconPrev />
      </button>
      <button className="icon-btn" aria-label="Next pool" onClick={() => step(1)} disabled={list.length < 2}>
        <IconNext />
      </button>
    </>
  );

  const score = (
    <span className="score">
      <span className="bar" aria-hidden="true">
        <i style={{ width: `${Math.round(d.confidence * 100)}%` }} />
      </span>
      {formatScore(d.confidence)}
    </span>
  );

  const size = (
    <>
      {formatDims(dims)}
      {dims && <span className="muted"> from outline</span>}
    </>
  );

  const copyBtn = (
    <button className="copy" aria-label={copied ? 'Coordinates copied' : 'Copy coordinates'} onClick={copy}>
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );

  const gmaps = (
    <a className="btn grow" href={googleMapsUrl(d.center.lat, d.center.lon)} target="_blank" rel="noreferrer">
      <IconExternal />
      Open in Google Maps
    </a>
  );

  if (phone) {
    return (
      <section className="m-card" aria-label={title}>
        <div className="m-head">
          <h2>{title}</h2>
          {nav}
          <button className="icon-btn" aria-label="Close" onClick={() => select(null)}>
            <IconClose />
          </button>
        </div>
        <div className="m-pool">
          <PoolThumb
            detection={d}
            image={thumbFor(d, thumbs)}
            width={112}
            viewM={20}
            scaleBar
            caption={sourceName ?? undefined}
            className="shot"
          />
          <dl className="facts">
            <dt>Area</dt>
            <dd>
              <b>{formatArea(d.areaM2)}</b>
            </dd>
            <dt>Size</dt>
            <dd>{size}</dd>
            <dt>Score</dt>
            <dd>{score}</dd>
          </dl>
        </div>
        <div className="m-coords">
          <span className="mono">{coords}</span>
          {copyBtn}
        </div>
        <div className="btns">{gmaps}</div>
      </section>
    );
  }

  return (
    <section className="insp" role="dialog" aria-label={title}>
      <div className="insp-h">
        <h2>{title}</h2>
        {nav}
        <button className="icon-btn" aria-label="Close" onClick={() => select(null)}>
          <IconClose />
        </button>
      </div>
      <PoolThumb
        detection={d}
        image={thumbFor(d, thumbs)}
        width={320}
        height={176}
        scaleBar
        caption={sourceName ?? undefined}
        className="shot"
      />
      <dl className="facts">
        <dt>Area</dt>
        <dd>
          <b>{formatArea(d.areaM2)}</b>
        </dd>
        <dt>Size</dt>
        <dd>{size}</dd>
        <dt>Score</dt>
        <dd>{score}</dd>
        <dt>Location</dt>
        <dd className="loc">
          <span className="mono">{coords}</span>
          {copyBtn}
        </dd>
      </dl>
      <div className="acts">{gmaps}</div>
    </section>
  );
}
