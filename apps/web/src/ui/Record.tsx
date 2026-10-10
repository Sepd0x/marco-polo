import { forwardRef, useEffect, useState } from 'react';
import type { RankedDetection } from '@marco-polo/core';
import { useStore } from '../state/store.js';
import { formatDims, formatLatLon, formatScore } from '../lib/format.js';
import { googleMapsUrl } from '../lib/links.js';
import { formatDegrees } from '../map/frame.js';
import { partOfDetection } from '../scan/ids.js';
import { dimsOf, thumbFor, thumbFrame } from './model.js';
import { PoolThumb } from './PoolThumb.js';
import { IconExternal } from './icons.js';

/**
 * The open pool, shown inside its row of the list: a 30 m crop of the
 * scanned imagery with a 10 m bar, the measurements, the position, and two
 * ways out (copy the position, or open it in Google Maps).
 */
export const PoolRecord = forwardRef<HTMLElement, { detection: RankedDetection }>(function PoolRecord({ detection: d }, ref) {
  const thumbs = useStore((s) => s.thumbs);
  const parts = useStore((s) => s.parts);
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [d.id]);

  const dims = dimsOf(d);
  const part = parts.length > 1 ? parts.find((p) => p.id === partOfDetection(d.id)) : undefined;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatLatLon(d.center.lat, d.center.lon, 6));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="rec" aria-label={`Pool ${d.rank}`} ref={ref}>
      <div className="rec-body">
        <PoolThumb detection={d} image={thumbFor(d, thumbs, thumbFrame(d, parts))} width={104} viewM={30} scaleM={10} className="crop" />
        <dl className="kv">
          <dt>Size</dt>
          <dd>{dims ? formatDims(dims) : 'Not measured'}</dd>
          {dims && (
            <>
              <dt>Heading</dt>
              <dd>{Math.round(dims.angleDeg) % 180}°</dd>
            </>
          )}
          <dt>Score</dt>
          <dd>{formatScore(d.confidence)}</dd>
          <dt>Lat</dt>
          <dd>{formatDegrees(d.center.lat, 6)}</dd>
          <dt>Lon</dt>
          <dd>{formatDegrees(d.center.lon, 6)}</dd>
          {part && (
            <>
              <dt>Imagery</dt>
              <dd className="trunc" title={part.providerName}>
                {part.providerName}
              </dd>
            </>
          )}
        </dl>
      </div>
      <div className="rec-acts">
        <button className="btn small" onClick={copy} aria-live="polite">
          {copied ? 'Position copied' : 'Copy position'}
        </button>
        <a className="btn small" href={googleMapsUrl(d.center.lat, d.center.lon)} target="_blank" rel="noreferrer">
          Open in Google Maps
          <IconExternal />
        </a>
      </div>
    </section>
  );
});
