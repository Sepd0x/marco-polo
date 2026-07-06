import { useState } from 'react';
import { useStore } from '../state/store.js';
import { IconRect } from './icons.js';

const SEEN_KEY = 'marco-polo:intro-seen';

export function IntroOverlay() {
  const phase = useStore((s) => s.phase);
  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(SEEN_KEY) === '1');

  if (dismissed || phase !== 'idle' || drawMode !== null) return null;

  const close = () => {
    sessionStorage.setItem(SEEN_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="intro-backdrop" onClick={close}>
      <div className="intro panel" onClick={(e) => e.stopPropagation()}>
        <div className="intro-head">
          <div className="radar">
            <div className="ring" />
            <div className="ring r2" />
            <div className="beam" />
          </div>
          <div>
            <h1>
              MARCO<span className="dot-sep">·</span>POLO
            </h1>
            <div className="label">satellite pool scanner · briefing</div>
          </div>
        </div>
        <p className="tagline">
          Select an area of interest anywhere on Earth. The scanner sweeps its satellite imagery
          tile by tile — every swimming pool that answers is detected, measured, geolocated and
          ranked, live.
        </p>
        <div className="steps mono">
          <div className="step">
            <span className="n">01</span>
            <span className="t">AOI — drag a rectangle or place a polygon</span>
          </div>
          <div className="step">
            <span className="n">02</span>
            <span className="t">SWEEP — live detection, telemetry, ranking</span>
          </div>
          <div className="step">
            <span className="n">03</span>
            <span className="t">EXPORT — GeoJSON · CSV · local archive</span>
          </div>
        </div>
        <div className="actions">
          <button
            className="btn primary"
            onClick={() => {
              close();
              setDrawMode('rect');
            }}
          >
            <IconRect /> select aoi
          </button>
          <button className="btn" onClick={close}>
            skip
          </button>
        </div>
      </div>
    </div>
  );
}
