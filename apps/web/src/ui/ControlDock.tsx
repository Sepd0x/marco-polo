import { estimateTileCount, ringAreaM2 } from '@marco-polo/core';
import { useStore } from '../state/store.js';
import { cancelScan, pauseScan, resumeScan, startScan } from '../scan/session.js';
import { DEMO_AREAS } from '../lib/demoAreas.js';
import { formatArea, formatCount } from '../lib/format.js';
import { emit } from '../lib/bus.js';

export function ControlDock() {
  const phase = useStore((s) => s.phase);
  const drawMode = useStore((s) => s.drawMode);
  const area = useStore((s) => s.area);
  const estimate = useStore((s) => s.areaEstimate);
  const settings = useStore((s) => s.settings);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const setArea = useStore((s) => s.setArea);
  const resetScan = useStore((s) => s.resetScan);
  const updateSettings = useStore((s) => s.updateSettings);

  if (phase === 'idle') {
    return (
      <div className="dock panel fade-up">
        <button
          className={`btn ${drawMode === 'rect' ? 'active' : ''}`}
          onClick={() => setDrawMode(drawMode === 'rect' ? null : 'rect')}
          title="Drag a rectangle (R)"
        >
          ▭ rectangle
        </button>
        <button
          className={`btn ${drawMode === 'polygon' ? 'active' : ''}`}
          onClick={() => setDrawMode(drawMode === 'polygon' ? null : 'polygon')}
          title="Click vertices, Enter or double-click to close (P)"
        >
          ⬠ polygon
        </button>
        <div className="sep" />
        <div className="demo-chips">
          <span className="label">try</span>
          {DEMO_AREAS.map((d) => (
            <button
              key={d.name}
              className="chip"
              title={d.hint}
              onClick={() => {
                const est = estimateTileCount(d.ring, useStore.getState().settings.zoom);
                setArea(d.ring, est);
                emit('flyto', { center: [d.center[1], d.center[0]], zoom: 14.6 });
              }}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (phase === 'ready' && area) {
    const areaM2 = ringAreaM2(area);
    return (
      <div className="dock panel fade-up">
        <div className="area-info">
          <span className="label">Area</span>
          <span className="big">{formatArea(areaM2)}</span>
        </div>
        <div className="area-info">
          <span className="label">Tiles @ z{settings.zoom}</span>
          <span className="big">
            {estimate ? `${formatCount(estimate.count)}${estimate.approximate ? '+' : ''}` : '—'}
          </span>
        </div>
        <div className="sep" />
        <button className="btn big primary" onClick={startScan}>
          ▶ start scan
        </button>
        <button className="btn" onClick={() => setArea(null)}>
          clear
        </button>
      </div>
    );
  }

  if (phase === 'scanning' || phase === 'paused') {
    return (
      <div className="dock panel">
        {phase === 'scanning' ? (
          <button className="btn" onClick={pauseScan}>
            ❚❚ pause
          </button>
        ) : (
          <button className="btn primary" onClick={resumeScan}>
            ▶ resume
          </button>
        )}
        <button className="btn danger" onClick={cancelScan}>
          ■ abort
        </button>
        <div className="sep" />
        <button
          className={`btn ${settings.follow ? 'active' : ''}`}
          onClick={() => updateSettings({ follow: !settings.follow })}
          title="Camera follows the sweep"
        >
          ◎ follow
        </button>
      </div>
    );
  }

  // complete
  return (
    <div className="dock panel fade-up">
      <button className="btn big primary" onClick={resetScan}>
        + new scan
      </button>
      <button
        className="btn"
        onClick={() => {
          if (useStore.getState().area) startScan();
        }}
        title="Scan the same area again (tiles come from local cache)"
      >
        ↻ rescan area
      </button>
    </div>
  );
}
