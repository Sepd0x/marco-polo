import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { formatArea, formatCount, formatDuration } from '../lib/format.js';
import { on } from '../lib/bus.js';

/** Dense sweep telemetry — a fixed instrument block on desktop, a strip on mobile. */
export function TelemetryBar() {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const currentTile = useStore((s) => s.currentTile);
  const pools = useStore((s) => s.ranked.length);
  const lastEvent = useStore((s) => s.lastEvent);

  if (phase !== 'scanning' && phase !== 'paused' && phase !== 'complete') return null;

  const pct = stats.tilesTotal > 0 ? (stats.tilesDone / stats.tilesTotal) * 100 : 0;

  return (
    <>
      <div className="progress-edge" style={{ width: `${pct}%` }} />
      <div className="telemetry panel">
        <div className="tl-head">
          <span className="label">sweep</span>
          <span className="tl-pct mono">{pct.toFixed(1)}%</span>
          <div className="tl-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="tl-grid mono">
          <Row k="tiles" v={`${formatCount(stats.tilesDone)}/${formatCount(stats.tilesTotal)}`} />
          <Row k="returns" v={formatCount(pools)} accent />
          <Row k="swept" v={formatArea(stats.scannedAreaM2)} />
          <Row k="elapsed" v={formatDuration(stats.elapsedMs)} />
          <Row
            k="eta"
            v={phase === 'scanning' && stats.etaMs != null ? formatDuration(stats.etaMs) : '—'}
          />
          {stats.tilesFailed > 0 && <Row k="failed" v={formatCount(stats.tilesFailed)} />}
          {stats.waterFiltered > 0 && <Row k="open water" v={formatCount(stats.waterFiltered)} />}
          {currentTile && (
            <Row k="tile" v={`z${currentTile.tile.z} ${currentTile.tile.x}/${currentTile.tile.y}`} />
          )}
        </div>
        {lastEvent && <div className="ticker">▸ {lastEvent}</div>}
      </div>
    </>
  );
}

function Row({ k, v, accent = false }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="tl-row">
      <span className="k">{k}</span>
      <span className={`v${accent ? ' accent' : ''}`}>{v}</span>
    </div>
  );
}

/** Live cursor coordinates, bottom-right (desktop only). */
export function CursorReadout() {
  const [pos, setPos] = useState<{ lon: number; lat: number } | null>(null);
  useEffect(() => on('cursor', setPos), []);
  if (!pos) return null;
  return (
    <div className="cursor-readout panel mono">
      {pos.lat.toFixed(5)}, {pos.lon.toFixed(5)}
    </div>
  );
}
