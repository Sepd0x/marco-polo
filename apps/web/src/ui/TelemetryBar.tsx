import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { formatArea, formatCount, formatDuration } from '../lib/format.js';
import { on } from '../lib/bus.js';

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
        <div className="cells">
          <Cell label="tiles" value={`${formatCount(stats.tilesDone)}/${formatCount(stats.tilesTotal)}`} />
          <Cell label="coverage" value={`${pct.toFixed(1)}%`} />
          <Cell label="pools" value={formatCount(pools)} accent />
          <Cell label="swept" value={formatArea(stats.scannedAreaM2)} />
          <Cell label="elapsed" value={formatDuration(stats.elapsedMs)} />
          <Cell
            label="eta"
            value={phase === 'scanning' && stats.etaMs != null ? formatDuration(stats.etaMs) : '—'}
          />
          {stats.tilesFailed > 0 && <Cell label="failed" value={formatCount(stats.tilesFailed)} />}
          {stats.waterFiltered > 0 && <Cell label="open water" value={formatCount(stats.waterFiltered)} />}
          {currentTile && (
            <Cell
              label="tile"
              value={`z${currentTile.tile.z} ${currentTile.tile.x}/${currentTile.tile.y}`}
            />
          )}
        </div>
        {lastEvent && <div className="ticker">▸ {lastEvent}</div>}
      </div>
    </>
  );
}

function Cell({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cell">
      <span className="label">{label}</span>
      <span className={`v${accent ? ' accent' : ''}`}>{value}</span>
    </div>
  );
}

/** Live cursor coordinates, bottom-right. */
export function CursorReadout() {
  const [pos, setPos] = useState<{ lon: number; lat: number } | null>(null);
  useEffect(() => on('cursor', setPos), []);
  if (!pos) return null;
  return (
    <div className="cursor-readout panel">
      {pos.lat.toFixed(5)}, {pos.lon.toFixed(5)}
    </div>
  );
}
