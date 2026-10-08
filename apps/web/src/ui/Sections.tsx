import { useId } from 'react';
import { estimateTileCount, type RankedDetection } from '@marco-polo/core';
import { useStore } from '../state/store.js';
import { cancelScan, currentScan, openArchived, pauseScan, resumeScan, retryFailed, startScan } from '../scan/session.js';
import { deleteScan } from '../scan/persist.js';
import { download, toCSV, toGeoJSON } from '../lib/export.js';
import { DEMO_AREAS } from '../lib/demoAreas.js';
import { emit } from '../lib/bus.js';
import {
  formatArea,
  formatCaptureDate,
  formatCount,
  formatDuration,
  formatLandArea,
  formatResolution,
  formatScore,
  formatTimeLeft,
  formatWhen,
  plural,
} from '../lib/format.js';
import { cutoffsInUse } from '../lib/score.js';
import { cellStates, MAX_CELLS, sortPools, thresholdToShowAll, viewRing, type AreaFacts, type SourceFacts } from './model.js';
import { useAreaFacts, useMapView, usePools, useScanSources } from './hooks.js';
import { useUi } from './uiState.js';
import { PoolList } from './PoolList.js';
import { IconDownload, IconPause, IconPlay, IconRect, IconShape, IconStop, IconView } from './icons.js';

/** Why the last scan could not start, until the area changes. */
export function ScanError() {
  const message = useStore((s) => s.scanError);
  if (!message) return null;
  return (
    <p className="warn" role="alert">
      {message}
    </p>
  );
}

/** Put a ring in the store as the area to scan. */
export function useSetArea() {
  const setArea = useStore((s) => s.setArea);
  return (ring: Parameters<typeof setArea>[0]) => {
    if (!ring) return setArea(null);
    setArea(ring, estimateTileCount(ring, useStore.getState().settings.zoom));
  };
}

export function DrawSection({ compact = false }: { compact?: boolean }) {
  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const view = useMapView();
  const setArea = useSetArea();

  const hint =
    drawMode === 'rect'
      ? 'Drag on the map to draw a rectangle.'
      : drawMode === 'polygon'
        ? 'Click each corner on the map, then click the first one to close the shape.'
        : compact
          ? 'Mark the place to scan on the map.'
          : 'Mark the place to scan on the map. Every pool inside is found, measured and listed by size.';

  return (
    <section className="sec" aria-labelledby="draw-h">
      <div className="sec-h">
        <h2 id="draw-h">Draw an area</h2>
      </div>
      <p className="lead" aria-live="polite">
        {hint}
      </p>
      <ScanError />
      <div className="btns wrap">
        <button
          className="btn"
          aria-pressed={drawMode === 'rect'}
          aria-keyshortcuts="R"
          onClick={() => setDrawMode(drawMode === 'rect' ? null : 'rect')}
        >
          <IconRect />
          Rectangle
          {!compact && <kbd>R</kbd>}
        </button>
        <button
          className="btn"
          aria-pressed={drawMode === 'polygon'}
          aria-keyshortcuts="P"
          onClick={() => setDrawMode(drawMode === 'polygon' ? null : 'polygon')}
        >
          <IconShape />
          Shape
          {!compact && <kbd>P</kbd>}
        </button>
        <button
          className="btn"
          aria-keyshortcuts="V"
          disabled={!view}
          onClick={() => view && setArea(viewRing(view.bbox))}
        >
          <IconView />
          Scan this view
          {!compact && <kbd>V</kbd>}
        </button>
      </div>
      {drawMode && <p className="note-inline">Esc cancels.</p>}
      <h3 className="sub">Or try an example</h3>
      <ul className="examples">
        {DEMO_AREAS.map((d) => (
          <li key={d.name}>
            <button
              className="example"
              title={compact ? `${d.name}. ${d.hint}` : undefined}
              onClick={() => {
                setArea(d.ring);
                emit('flyto', { center: [d.center[1], d.center[0]], zoom: 16 });
              }}
            >
              <span className="ex-name">{compact ? d.short : d.name}</span>
              {!compact && <span className="ex-hint">{d.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function sourceText(s: SourceFacts): string {
  const res = formatResolution(s.resM);
  return res ? `${s.name}, ${res}` : s.name;
}

function tilesText(facts: AreaFacts): string {
  const n = `${facts.approximate ? 'About ' : ''}${formatCount(facts.tiles)}`;
  if (facts.sources.length === 1) return `${n} at zoom ${facts.sources[0].zoom}`;
  if (facts.sources.length > 1) return `${n} from ${facts.sources.length} sources`;
  return n;
}

export function AreaFactsList({ facts, showTime }: { facts: AreaFacts; showTime: boolean }) {
  return (
    <dl className="facts">
      <dt>Size</dt>
      <dd>{formatLandArea(facts.areaM2)}</dd>
      <dt>Tiles</dt>
      <dd>{tilesText(facts)}</dd>
      <dt>Imagery</dt>
      <dd>
        {facts.sources.length === 0 && 'Worked out when the scan starts'}
        {facts.sources.map((s) => (
          <span className="src" key={s.id}>
            <i className="dot-src" aria-hidden="true" />
            {sourceText(s)}
          </span>
        ))}
      </dd>
      <dt>Speed</dt>
      <dd>{plural(facts.rate, 'tile')} per second</dd>
      {showTime && (
        <>
          <dt>Time</dt>
          <dd>About {formatDuration(facts.seconds * 1000)}</dd>
        </>
      )}
    </dl>
  );
}

export function AreaSection() {
  const phase = useStore((s) => s.phase);
  const planned = useAreaFacts();
  const scanned = useScanSources();
  const total = useStore((s) => s.stats.tilesTotal);
  const setArea = useSetArea();
  if (!planned) return null;
  const ready = phase === 'ready';
  // Once a scan runs, the facts are the scan's own: its sources and its tile count.
  const facts: AreaFacts = ready
    ? planned
    : {
        ...planned,
        tiles: total,
        approximate: false,
        sources: scanned,
        rate: scanned.length ? Math.min(...scanned.map((s) => s.rate)) : planned.rate,
      };
  const blocked = facts.level === 'block';

  return (
    <section className="sec" aria-labelledby="area-h">
      <div className="sec-h">
        <h2 id="area-h">Your area</h2>
      </div>
      <AreaFactsList facts={facts} showTime={ready} />
      {ready && <ScanError />}
      {ready && facts.level === 'warn' && (
        <p className="warn">A large area. It takes about {formatDuration(facts.seconds * 1000)} at this speed.</p>
      )}
      {ready && blocked && (
        <p className="warn" role="alert">
          Too large to scan. Here the limit is about {formatLandArea(facts.maxAreaM2)}; draw a smaller area.
        </p>
      )}
      {ready && (
        <div className="btns">
          <button className="btn primary" onClick={startScan} disabled={blocked}>
            <IconPlay />
            Start scan
          </button>
          <button className="btn quiet" onClick={() => setArea(null)}>
            Clear
          </button>
        </div>
      )}
    </section>
  );
}

export function Cells({ total, done, current, paused }: { total: number; done: number; current: number | null; paused: boolean }) {
  if (total > MAX_CELLS) {
    const pct = total ? (done / total) * 100 : 0;
    return (
      <div className="bar-line" aria-hidden="true">
        <i className="done" style={{ width: `${pct}%` }} />
        {!paused && done < total && <i className="busy" style={{ left: `${pct}%` }} />}
      </div>
    );
  }
  const states = cellStates(total, done, current, paused);
  return (
    <div className="cells" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${Math.max(total, 1)}, 1fr)` }}>
      {states.map((s, i) => (
        <i key={i} className={s} />
      ))}
    </div>
  );
}

export function ProgressSection({ phone = false }: { phone?: boolean }) {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const current = useStore((s) => s.currentTile?.index ?? null);
  const facts = useAreaFacts();
  const sources = useScanSources();
  const paused = phase === 'paused';
  const cached = (stats as { tilesCached?: number }).tilesCached;

  const metaRight = phone
    ? [facts ? formatLandArea(facts.areaM2) : null, sources[0]?.name].filter(Boolean).join(', ')
    : [plural(stats.tilesFailed, 'failed', 'failed'), cached != null ? `${formatCount(cached)} from cache` : null]
        .filter(Boolean)
        .join(', ');

  return (
    <section className="sec" aria-labelledby="prog-h">
      <div className="prog-row">
        <h2 id="prog-h">{paused ? 'Paused' : 'Scanning'}</h2>
        <span>
          {formatCount(stats.tilesDone)} of {plural(stats.tilesTotal, 'tile')}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Tiles scanned"
        aria-valuemin={0}
        aria-valuemax={stats.tilesTotal}
        aria-valuenow={stats.tilesDone}
      >
        <Cells total={stats.tilesTotal} done={stats.tilesDone} current={current} paused={paused} />
      </div>
      <div className="prog-meta">
        <span>{paused ? 'Waiting for you' : formatTimeLeft(stats.etaMs)}</span>
        <span>{metaRight}</span>
      </div>
      {phone && stats.tilesFailed > 0 && <p className="warn">{plural(stats.tilesFailed, 'tile')} failed.</p>}
      <div className="btns">
        {paused ? (
          <button className={`btn${phone ? ' grow' : ''}`} onClick={resumeScan}>
            <IconPlay />
            Resume
          </button>
        ) : (
          <button className={`btn${phone ? ' grow' : ''}`} onClick={pauseScan}>
            <IconPause />
            Pause
          </button>
        )}
        <button className={`btn quiet${phone ? ' grow edge' : ''}`} onClick={cancelScan}>
          <IconStop />
          Stop
        </button>
      </div>
    </section>
  );
}

function exportPools(pools: RankedDetection[], kind: 'csv' | 'geojson') {
  if (kind === 'csv') download('pools.csv', toCSV(pools), 'text/csv');
  else download('pools.geojson', toGeoJSON(pools), 'application/geo+json');
}

export function SourceLine({ sources }: { sources: SourceFacts[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="imgline">
      <i className="dot-src" aria-hidden="true" />
      <span>
        {sources.map((s, i) => {
          const bits = [s.kind, formatResolution(s.resM), formatCaptureDate(s.date)].filter(Boolean);
          return (
            <span key={s.id}>
              {i > 0 && '; '}
              <b>{s.name}</b>
              {bits.length ? `, ${bits.join(', ')}` : ''}
            </span>
          );
        })}
        . The map inside your area shows this same imagery.
      </span>
    </p>
  );
}

/** How the list's minimum reads in a sentence. */
function cutoffText(cutoffs: number[], recommended: boolean): string {
  const values = cutoffs.map(formatScore).join(' or ');
  return recommended ? `the recommended minimum (${values})` : values;
}

export function SummarySection({ compact = false }: { compact?: boolean }) {
  const stats = useStore((s) => s.stats);
  const settings = useStore((s) => s.settings);
  const parts = useStore((s) => s.parts);
  const update = useStore((s) => s.updateSettings);
  const cutoffs = cutoffsInUse(settings, parts);
  const minText = cutoffText(cutoffs, settings.recommendedScore);
  const resetScan = useStore((s) => s.resetScan);
  const sources = useScanSources();
  const facts = useAreaFacts();
  const { shown, below, lowestBelow } = usePools();

  const stopped = stats.tilesTotal > 0 && stats.tilesDone < stats.tilesTotal;
  const poolArea = shown.reduce((a, d) => a + d.areaM2, 0);
  const landArea = facts?.areaM2 ?? stats.areaM2;
  const noCoverage = sources.reduce((a, s) => a + (s.noCoverage ?? 0), 0);
  const missing = stats.tilesFailed + noCoverage;
  const finishedAt = stats.startedAt ? stats.startedAt + stats.elapsedMs : null;
  const scanId = useStore((s) => s.scanId);
  // Only the scan this page ran can retry: an archived scan keeps no tile list.
  const canRetry = !stopped && stats.tilesFailed > 0 && scanId != null && currentScan()?.scanId === scanId;
  const scanned = stats.tilesDone - stats.tilesFailed - noCoverage;
  let problem: string | null = null;
  if (!stopped && stats.tilesTotal > 0 && scanned <= 0) {
    problem =
      stats.tilesFailed > 0
        ? 'No tile could be loaded. Check your connection, then retry.'
        : 'The imagery has nothing here. Try another place or another source.';
  } else if (stats.tilesFailed > 0) {
    problem = `${plural(stats.tilesFailed, 'tile')} could not be loaded, so pools there are missing.`;
  }

  let tilesNote = 'none missing';
  if (stopped) tilesNote = `${formatCount(stats.tilesTotal - stats.tilesDone)} not scanned`;
  else if (missing > 0)
    tilesNote = [stats.tilesFailed ? `${formatCount(stats.tilesFailed)} failed` : null, noCoverage ? `${formatCount(noCoverage)} no imagery` : null]
      .filter(Boolean)
      .join(', ');

  return (
    <section className="sec" aria-labelledby="sum-h">
      <div className="done-h">
        <div>
          <h2 id="sum-h">{stopped ? 'Scan stopped' : 'Scan complete'}</h2>
          {finishedAt != null && (
            <p>
              {stopped
                ? `After ${formatCount(stats.tilesDone)} of ${plural(stats.tilesTotal, 'tile')}, ${formatWhen(finishedAt)}`
                : `Finished in ${formatDuration(stats.elapsedMs)}, ${formatWhen(finishedAt)}`}
            </p>
          )}
        </div>
        <button className="btn" onClick={resetScan}>
          New scan
        </button>
      </div>
      <div className="big" aria-live="polite">
        <b>{formatCount(shown.length)}</b>
        <span>{shown.length === 1 ? 'pool' : 'pools'}</span>
      </div>
      <p className="more">
        {below > 0 ? (
          <>
            {formatCount(below)} more scored below {minText}.{' '}
            <button
              className="link"
              onClick={() =>
                lowestBelow != null && update({ minConfidence: thresholdToShowAll(lowestBelow), recommendedScore: false })
              }
            >
              Show {below === 1 ? 'it' : 'them'}
            </button>
          </>
        ) : (
          <>None below {minText}.</>
        )}
      </p>
      {!compact && (
        <div className="stats">
          <div>
            <b>{formatArea(poolArea)}</b>
            <span>pool area</span>
          </div>
          <div>
            <b>{formatLandArea(landArea)}</b>
            <span>scanned</span>
          </div>
          <div>
            <b>{plural(stats.tilesTotal, 'tile')}</b>
            <span>{tilesNote}</span>
          </div>
        </div>
      )}
      {problem && (
        <div className="warn-row" role="alert">
          <p className="warn">{problem}</p>
          {canRetry && (
            <button className="btn small" onClick={() => void retryFailed()}>
              Retry failed
            </button>
          )}
        </div>
      )}
      <SourceLine sources={sources} />
      <div className="btns">
        <button className="btn" disabled={shown.length === 0} onClick={() => exportPools(shown, 'csv')}>
          <IconDownload />
          CSV
        </button>
        <button className="btn" disabled={shown.length === 0} onClick={() => exportPools(shown, 'geojson')}>
          <IconDownload />
          GeoJSON
        </button>
      </div>
    </section>
  );
}

export function ThresholdSection() {
  const settings = useStore((s) => s.settings);
  const parts = useStore((s) => s.parts);
  const update = useStore((s) => s.updateSettings);
  const id = useId();
  const cutoffs = cutoffsInUse(settings, parts);
  const value = cutoffs[0];
  const recommended = settings.recommendedScore;
  return (
    <section className="sec">
      <div className="slider">
        <label htmlFor={id}>Minimum score</label>
        <input
          id={id}
          type="range"
          min={0}
          max={0.95}
          step={0.05}
          value={value}
          aria-valuetext={recommended ? `Recommended, ${cutoffs.map(formatScore).join(' or ')}` : formatScore(value)}
          onChange={(e) => update({ minConfidence: Number(e.target.value), recommendedScore: false })}
          style={{ ['--fill' as string]: `${(value / 0.95) * 100}%` }}
        />
        <output htmlFor={id}>{cutoffs.map(formatScore).join('/')}</output>
      </div>
      <p className="slider-note">
        {recommended ? (
          cutoffs.length > 1 ? (
            'Recommended for each source.'
          ) : (
            'Recommended for this imagery.'
          )
        ) : (
          <>
            Set by you.{' '}
            <button className="link" onClick={() => update({ recommendedScore: true })}>
              Use the recommended minimum
            </button>
          </>
        )}
      </p>
    </section>
  );
}

export function SortControl() {
  const sort = useUi((s) => s.sort);
  const setSort = useUi((s) => s.setSort);
  return (
    <span className="seg" role="group" aria-label="Sort pools">
      <button aria-pressed={sort === 'largest'} onClick={() => setSort('largest')}>
        Largest
      </button>
      <button aria-pressed={sort === 'score'} onClick={() => setSort('score')}>
        Score
      </button>
    </span>
  );
}

export function ListSection({ limit, onPick }: { limit?: number; onPick?: (id: string) => void }) {
  const phase = useStore((s) => s.phase);
  const sort = useUi((s) => s.sort);
  const { shown, newest, below } = usePools();
  const live = phase === 'scanning' || phase === 'paused';
  const list = live ? shown : sortPools(shown, sort);
  const minScore = useStore((s) => s.settings.minConfidence);

  return (
    <section className="list-sec" aria-labelledby="list-h">
      <div className="list-h">
        <h2 id="list-h">
          {live ? 'Found so far' : 'Pools'} <span className="count">{formatCount(shown.length)}</span>
        </h2>
        {live ? <span className="aside">Largest first</span> : <SortControl />}
      </div>
      {shown.length === 0 && (
        <p className="note">
          {live
            ? 'No pools yet. They appear here as tiles finish.'
            : below > 0
              ? `No pools at or above ${formatScore(minScore)}.`
              : 'No pools in this area.'}
        </p>
      )}
      <PoolList pools={list} newest={newest} label="Pools" limit={limit} onPick={onPick} />
      {live && shown.length > 1 && <p className="note">The order can still change until the scan ends.</p>}
    </section>
  );
}

export function SavedScans() {
  const archive = useStore((s) => s.archive);
  const setArchive = useStore((s) => s.setArchive);
  if (archive.length === 0) return null;
  return (
    <section className="sec" aria-labelledby="saved-h">
      <div className="sec-h">
        <h2 id="saved-h">Saved scans</h2>
        <span className="aside">On this device</span>
      </div>
      <ul className="saved">
        {archive.map((a) => (
          <li key={a.id}>
            <span className="saved-main">
              <span className="saved-name">{a.name}</span>
              <span className="saved-sub">
                {plural(a.pools, 'pool')}, {formatLandArea(a.areaM2)}, {formatWhen(a.savedAt)}
              </span>
            </span>
            <button
              className="btn small"
              onClick={() => void openArchived(a.id)}
            >
              Open
            </button>
            <button
              className="btn small quiet"
              aria-label={`Delete ${a.name}`}
              onClick={async () => setArchive(await deleteScan(a.id))}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
