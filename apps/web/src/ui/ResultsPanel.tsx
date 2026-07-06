import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RankedDetection } from '@marco-polo/core';
import { useStore, visibleRanked } from '../state/store.js';
import { approxDims, formatArea, formatCount } from '../lib/format.js';
import { googleMapsUrl } from '../lib/links.js';
import { fragKey } from '../lib/fragKey.js';
import { download, toCSV, toGeoJSON } from '../lib/export.js';
import { deleteScan, loadScan } from '../scan/persist.js';
import { IconChevron, IconDownload, IconExternal } from './icons.js';

const RENDER_CAP = 200;

export function ResultsPanel() {
  const phase = useStore((s) => s.phase);
  const ranked = useStore((s) => s.ranked);
  const settings = useStore((s) => s.settings);
  const archive = useStore((s) => s.archive);
  const [tab, setTab] = useState<'results' | 'archive'>('results');
  const [sheetOpen, setSheetOpen] = useState(false);

  const scanActive = phase === 'scanning' || phase === 'paused' || phase === 'complete';
  const open = scanActive || archive.length > 0;
  useEffect(() => {
    if (scanActive) setTab('results');
  }, [scanActive]);

  if (!open) return null;

  const visible = visibleRanked({ ranked, settings });
  const totalArea = visible.reduce((a, d) => a + d.areaM2, 0);

  return (
    <aside className={`results panel fade-up${sheetOpen ? ' open' : ''}`}>
      <header onClick={() => setSheetOpen((v) => !v)}>
        <span className="title">
          POLO <span className="title-dim">/ returns</span>
        </span>
        <span className="count mono">
          {formatCount(visible.length)} · {formatArea(totalArea)}
        </span>
        <button
          className="sheet-toggle"
          aria-label={sheetOpen ? 'Collapse results' : 'Expand results'}
          onClick={(e) => {
            e.stopPropagation();
            setSheetOpen((v) => !v);
          }}
        >
          <IconChevron style={{ transform: sheetOpen ? 'rotate(0deg)' : 'rotate(180deg)' }} />
        </button>
      </header>
      <div className="r-body">
        <div className="tabs">
          <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>
            results
          </button>
          <button className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}>
            archive · {archive.length}
          </button>
        </div>
        {tab === 'results' ? <ResultsTab visible={visible} /> : <ArchiveTab />}
      </div>
    </aside>
  );
}

function ResultsTab({ visible }: { visible: RankedDetection[] }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const phase = useStore((s) => s.phase);

  return (
    <>
      <div className="filters">
        <span className="label">conf ≥</span>
        <input
          type="range"
          min={0}
          max={0.9}
          step={0.05}
          value={settings.minConfidence}
          onChange={(e) => updateSettings({ minConfidence: Number(e.target.value) })}
          aria-label="Minimum confidence"
        />
        <span className="val mono">{settings.minConfidence.toFixed(2)}</span>
        <button
          className={`toggle ${settings.showHotTubs ? 'on' : ''}`}
          onClick={() => updateSettings({ showHotTubs: !settings.showHotTubs })}
          title="Include hot tubs"
          aria-label="Include hot tubs"
        />
        <span className="label">tubs</span>
      </div>
      <DetectionList visible={visible} />
      <div className="footer">
        <button
          className="btn"
          disabled={visible.length === 0}
          onClick={() => download('marco-polo-pools.geojson', toGeoJSON(visible), 'application/geo+json')}
        >
          <IconDownload /> geojson
        </button>
        <button
          className="btn"
          disabled={visible.length === 0}
          onClick={() => download('marco-polo-pools.csv', toCSV(visible), 'text/csv')}
        >
          <IconDownload /> csv
        </button>
      </div>
      {phase === 'complete' && visible.length === 0 && (
        <div className="empty-note">
          No returns above the confidence filter.
          <br />
          Lower the threshold or select a denser AOI.
        </div>
      )}
    </>
  );
}

function DetectionList({ visible }: { visible: RankedDetection[] }) {
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const thumbs = useStore((s) => s.thumbs);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const shown = visible.slice(0, RENDER_CAP);

  return (
    <div className="list scroll" ref={listRef}>
      {shown.length === 0 && (
        <div className="empty-note">
          Listening for returns…
          <br />
          Detections stream in as the sweep finds water.
        </div>
      )}
      <AnimatePresence initial={false}>
        {shown.map((d) => {
          const thumb = thumbs[fragKey(d.primary.tile, d.primary.bboxPx)];
          return (
            <motion.button
              key={d.id}
              data-id={d.id}
              layout="position"
              initial={{ opacity: 0, x: 22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 22 }}
              transition={{ duration: 0.18 }}
              className={`det-row ${d.kind}${d.id === selectedId ? ' selected' : ''}`}
              onClick={() => select(d.id)}
            >
              <span className="rank mono">{d.rank}</span>
              {thumb ? (
                <img className="thumb" src={thumb} alt="" loading="lazy" />
              ) : (
                <span className="thumb empty mono">z{d.primary.tile.z}</span>
              )}
              <span className="meta">
                <span className="area mono">
                  {formatArea(d.areaM2)}
                  {d.truncated ? <span className="trunc" title="May extend beyond scanned imagery"> ⌐</span> : ''}
                </span>
                <span className="info mono">
                  <span className="conf-bar">
                    <i style={{ width: `${Math.round(d.confidence * 100)}%` }} />
                  </span>
                  {Math.round(d.confidence * 100)}
                  {d.kind === 'hot_tub' ? ' · tub' : ''} · {approxDims(d.areaM2)}
                </span>
              </span>
              <a
                className="ext"
                href={googleMapsUrl(d.center.lat, d.center.lon)}
                target="_blank"
                rel="noreferrer"
                title="Open in Google Maps"
                aria-label="Open in Google Maps"
                onClick={(e) => e.stopPropagation()}
              >
                <IconExternal />
              </a>
            </motion.button>
          );
        })}
      </AnimatePresence>
      {visible.length > RENDER_CAP && (
        <div className="more-note mono">
          +{formatCount(visible.length - RENDER_CAP)} more — export for the full set
        </div>
      )}
    </div>
  );
}

function ArchiveTab() {
  const archive = useStore((s) => s.archive);
  const setArchive = useStore((s) => s.setArchive);
  const loadArchived = useStore((s) => s.loadArchived);

  return (
    <div className="list scroll">
      {archive.length === 0 && (
        <div className="empty-note">
          Completed scans are stored locally
          <br />
          and survive reloads.
        </div>
      )}
      {archive.map((a) => (
        <div className="arch-row" key={a.id}>
          <div>
            <div className="name mono">{a.name}</div>
            <div className="sub mono">
              {new Date(a.savedAt).toLocaleString()} · {a.pools} returns · {formatArea(a.areaM2)} · z
              {a.zoom}
            </div>
          </div>
          <div className="actions">
            <button
              onClick={async () => {
                const rec = await loadScan(a.id);
                if (rec) {
                  loadArchived({
                    id: rec.id,
                    name: rec.name,
                    area: rec.area,
                    detections: rec.detections,
                    thumbs: rec.thumbs,
                    stats: rec.stats,
                  });
                }
              }}
            >
              open
            </button>
            <button onClick={async () => setArchive(await deleteScan(a.id))}>del</button>
          </div>
        </div>
      ))}
    </div>
  );
}
