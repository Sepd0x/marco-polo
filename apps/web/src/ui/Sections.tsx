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
  formatClock,
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
import { allTilesFailed, failureHint } from '../lib/tileOutcome.js';
import { cellStates, MAX_CELLS, scoreBins, sortPools, thresholdToShowAll, viewRing, type AreaFacts, type SourceFacts } from './model.js';
import { useAreaFacts, useMapView, usePools, useScanSources, useTileCounts } from './hooks.js';
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
          : 'Mark the place to scan on the map. Pools inside are found, measured and listed by size.';

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
    <dl className="kv">
      <dt>Size</dt>
      <dd>{formatLandArea(facts.areaM2)}</dd>
      <dt>Tiles</dt>
      <dd>{tilesText(facts)}</dd>
      <dt>Imagery</dt>
      <dd>
        {facts.sources.length === 0 && 'Worked out when the scan starts'}
        {facts.sources.map((s) => (
          <span className="src" key={s.id}>
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
        <span>{paused ? 'Resume to go on' : formatTimeLeft(stats.etaMs)}</span>
        <span>{metaRight}</span>
      </div>
      {phone && stats.tilesFailed > 0 && <p className="warn">{plural(stats.tilesFailed, 'tile')} failed.</p>}
      <div className="btns">
        {paused ? (
          <button className={`btn primary${phone ? ' grow' : ''}`} onClick={resumeScan}>
            <IconPlay />
            Resume
          </button>
        ) : (
          <button className={`btn${phone ? ' grow' : ''}`} onClick={pauseScan}>
            <IconPause />
            Pause
          </button>
        )}
        <button className={`btn quiet${phone ? ' grow' : ''}`} onClick={cancelScan}>
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

/** The list's minimum as the summary writes it: one value, or one per source. */
function cutoffText(cutoffs: number[]): string {
  return cutoffs.map(formatScore).join(' or ');
}

export function ExportButtons({ pools }: { pools: RankedDetection[] }) {
  return (
    <>
      <button className="btn small" disabled={pools.length === 0} onClick={() => exportPools(pools, 'csv')}>
        <IconDownload />
        CSV
      </button>
      <button className="btn small" disabled={pools.length === 0} onClick={() => exportPools(pools, 'geojson')}>
        <IconDownload />
        GeoJSON
      </button>
    </>
  );
}

export function SummarySection({ phone = false }: { phone?: boolean }) {
  const stats = useStore((s) => s.stats);
  const settings = useStore((s) => s.settings);
  const parts = useStore((s) => s.parts);
  const update = useStore((s) => s.updateSettings);
  const scanName = useStore((s) => s.scanName);
  const minText = cutoffText(cutoffsInUse(settings, parts));
  const resetScan = useStore((s) => s.resetScan);
  const facts = useAreaFacts();
  const tiles = useTileCounts();
  const { shown, below, lowestBelow } = usePools();

  const stopped = tiles.stopped;
  // Stopped before the first tile: nothing was scanned, and the summary says only that.
  const nothing = stopped && stats.tilesDone === 0;
  const poolArea = shown.reduce((a, d) => a + d.areaM2, 0);
  const landArea = facts?.areaM2 ?? stats.areaM2;
  const finishedAt = stats.startedAt ? stats.startedAt + stats.elapsedMs : null;
  const scanId = useStore((s) => s.scanId);
  const offline = useStore((s) => s.offline);
  // Only the scan this page ran can retry: an archived scan keeps no tile list.
  const canRetry = !stopped && stats.tilesFailed > 0 && scanId != null && currentScan()?.scanId === scanId;
  let problem: string | null = null;
  // A stopped scan that read tiles but got no imagery from any says so too.
  if (stats.tilesTotal > 0 && (!stopped || stats.tilesDone > 0) && tiles.ok <= 0) {
    problem =
      stats.tilesFailed > 0
        ? failureHint(offline)
        : 'The imagery has nothing here. Try another place or another source.';
  } else if (stats.tilesFailed > 0) {
    problem = offline
      ? `${plural(stats.tilesFailed, 'tile')} could not be loaded because your device went offline, so pools there are missing. They are retried when you are back online.`
      : `${plural(stats.tilesFailed, 'tile')} could not be loaded, so pools there are missing.`;
  }

  const tileParts = [
    stopped ? `${formatCount(stats.tilesTotal - stats.tilesDone)} not scanned` : null,
    tiles.failed ? `${formatCount(tiles.failed)} failed` : null,
    tiles.noCoverage ? `${formatCount(tiles.noCoverage)} no imagery` : null,
  ].filter(Boolean);
  const tilesNote = tileParts.length ? tileParts.join(', ') : 'none missing';

  // Every tile failed (offline, say): nothing was read, and the summary does not call it complete.
  const failed = allTilesFailed(tiles);
  // A stopped scan counts the ground of the tiles it read, out of the whole area.
  const scannedText = failed
    ? `none of ${formatLandArea(landArea)}`
    : stopped
      ? `${formatLandArea(stats.scannedAreaM2)} of ${formatLandArea(landArea)}`
      : formatLandArea(landArea);

  let when: string | null = null;
  if (finishedAt != null) {
    if (phone)
      when = stopped
        ? `${formatCount(stats.tilesDone)} of ${plural(stats.tilesTotal, 'tile')}`
        : `${formatDuration(stats.elapsedMs)}, ${formatClock(finishedAt)}`;
    else
      when = stopped
        ? `After ${formatCount(stats.tilesDone)} of ${plural(stats.tilesTotal, 'tile')}, ${formatWhen(finishedAt)}`
        : `Finished in ${formatDuration(stats.elapsedMs)}, ${formatWhen(finishedAt)}`;
  }
  const meta = [scanName.trim() || null, when].filter(Boolean).join('. ');

  return (
    <section className="sec summary" aria-labelledby="sum-h">
      <div className="sec-h">
        <h2 id="sum-h">{stopped ? 'Scan stopped' : failed ? 'Scan failed' : 'Scan complete'}</h2>
        {phone && meta && <span className="meta-inline trunc">{meta}</span>}
        <span className="grow" />
        <button className="btn small" onClick={resetScan}>
          New scan
        </button>
      </div>
      {!phone && meta && <p className="meta">{meta}</p>}
      {nothing ? (
        <p className="lead stopped-note">Stopped before the first tile was read. Nothing was scanned, so there are no pools to list.</p>
      ) : (
        <>
          <div className="readout">
            <div className="big" aria-live="polite">
              <b>{formatCount(shown.length)}</b>
              <span>{shown.length === 1 ? 'pool' : 'pools'}</span>
            </div>
            <dl className="stats">
              <div>
                <dt>pool area</dt>
                <dd>{formatArea(poolArea)}</dd>
              </div>
              <div>
                <dt>scanned</dt>
                <dd>{scannedText}</dd>
              </div>
              <div>
                <dt>{tilesNote}</dt>
                <dd>{plural(stats.tilesTotal, 'tile')}</dd>
              </div>
            </dl>
          </div>
          {(below > 0 || (!stopped && !failed)) && (
            <p className="more">
              {below > 0 ? (
                <>
                  {formatCount(below)} more below {minText}.{' '}
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
          )}
        </>
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
      {!phone && !nothing && (
        <div className="export-row">
          <span className="k">Export</span>
          <span className="grow" />
          <ExportButtons pools={shown} />
        </div>
      )}
    </section>
  );
}

/** Histogram of the scores over the slider: listed pools in ink, the ones below the minimum lighter. */
function ScoreHistogram() {
  const { shown, under } = usePools();
  const bins = scoreBins(shown, under);
  const max = Math.max(1, ...bins.map((b) => b.above + b.below));
  return (
    <div className="hist" aria-hidden="true">
      {bins.map((b, i) =>
        b.above + b.below === 0 ? null : (
          <span key={i} className="bin" style={{ left: `${i + 0.5}%`, height: `${Math.max(8, ((b.above + b.below) / max) * 100)}%` }}>
            {b.above > 0 && <i style={{ flexGrow: b.above }} />}
            {b.below > 0 && <i className="lo" style={{ flexGrow: b.below }} />}
          </span>
        ),
      )}
    </div>
  );
}

/** The slider stops at 0.95; the track drawn under it runs to 1.00 so the histogram fits. */
const SLIDER_MAX = 0.95;
const TICKS = Array.from({ length: 21 }, (_, i) => i * 5);

export function ThresholdSection({ phone = false }: { phone?: boolean }) {
  const settings = useStore((s) => s.settings);
  const parts = useStore((s) => s.parts);
  const update = useStore((s) => s.updateSettings);
  const id = useId();
  const cutoffs = cutoffsInUse(settings, parts);
  const value = cutoffs[0];
  const recommended = settings.recommendedScore;
  return (
    <section className="sec threshold">
      <div className="slider-h">
        <label htmlFor={id}>Minimum score</label>
        <span className="grow" />
        {recommended && <span className="k">{cutoffs.length > 1 ? 'recommended for each source' : 'recommended'}</span>}
        <output htmlFor={id}>{cutoffs.map(formatScore).join('/')}</output>
      </div>
      <div className="score-track" style={{ ['--v' as string]: `${value * 100}%` }}>
        <ScoreHistogram />
        <div className="rail" aria-hidden="true">
          <i />
        </div>
        <div className="ticks" aria-hidden="true">
          {TICKS.map((t) => (
            <i key={t} className={t % 25 === 0 ? 'm' : undefined} style={{ left: `${t}%` }} />
          ))}
        </div>
        <input
          id={id}
          type="range"
          min={0}
          max={SLIDER_MAX}
          step={0.05}
          value={value}
          aria-valuetext={recommended ? `Recommended, ${cutoffs.map(formatScore).join(' or ')}` : formatScore(value)}
          onChange={(e) => update({ minConfidence: Number(e.target.value), recommendedScore: false })}
        />
      </div>
      <div className="scale-l" aria-hidden="true">
        <span style={{ left: 0 }}>0.00</span>
        {phone ? (
          value > 0.12 && value < 0.88 && <span style={{ left: `${value * 100}%` }}>{formatScore(value)}</span>
        ) : (
          <>
            <span style={{ left: '25%' }}>0.25</span>
            <span style={{ left: '50%' }}>0.50</span>
            <span style={{ left: '75%' }}>0.75</span>
          </>
        )}
        <span style={{ left: '100%' }}>1.00</span>
      </div>
      {!recommended && (
        <p className="slider-note">
          Set by you.{' '}
          <button className="link" onClick={() => update({ recommendedScore: true })}>
            Use the recommended minimum
          </button>
        </p>
      )}
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

export function ListSection({ limit, phone = false }: { limit?: number; phone?: boolean }) {
  const phase = useStore((s) => s.phase);
  const sort = useUi((s) => s.sort);
  const { shown, newest, below } = usePools();
  const live = phase === 'scanning' || phase === 'paused';
  const list = live ? shown : sortPools(shown, sort);
  const minScore = useStore((s) => s.settings.minConfidence);
  const tiles = useTileCounts();

  return (
    <section className="list-sec" aria-labelledby="list-h">
      <div className="list-h">
        <h2 id="list-h">
          {live ? 'Found so far' : 'Pools'} <span className="count">{formatCount(shown.length)}</span>
        </h2>
        <span className="grow" />
        {live ? <span className="aside">Largest first</span> : <SortControl />}
        {phone && !live && <ExportButtons pools={shown} />}
      </div>
      {shown.length === 0 && (
        <p className="note">
          {live
            ? 'No pools yet. They appear here as tiles finish.'
            : below > 0
              ? `No pools at or above ${formatScore(minScore)}.`
              : tiles.stopped
                ? 'No pools in the part scanned.'
                : tiles.failed > 0 && tiles.ok <= 0
                  ? 'No tile could be read, so there are no pools to list.'
                  : 'No pools in this area.'}
        </p>
      )}
      <PoolList pools={list} newest={newest} label="Pools" limit={limit} />
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
              <span className="saved-name" title={a.name}>
                {a.name}
              </span>
              <span className="saved-sub">
                {plural(a.pools, 'pool')}, {formatLandArea(a.areaM2)}, {formatWhen(a.savedAt)}
              </span>
            </span>
            <button className="btn small" onClick={() => void openArchived(a.id)}>
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
