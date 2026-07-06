import { useState } from 'react';
import { useStore } from '../state/store.js';

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
        <div className="radar">
          <div className="ring" />
          <div className="ring r2" />
          <div className="ring r3" />
          <div className="beam" />
        </div>
        <h1>
          MARCO<span className="dot-sep">·</span>POLO
        </h1>
        <p className="tagline">
          Draw an area anywhere on Earth. The scanner sweeps the satellite imagery tile by tile,
          calls <em>marco</em> — and every swimming pool that answers <em>polo</em> gets found,
          measured and ranked.
        </p>
        <div className="steps">
          <div className="step">
            <div className="n">01</div>
            <div className="t">Frame a neighbourhood with the rectangle or polygon tool</div>
          </div>
          <div className="step">
            <div className="n">02</div>
            <div className="t">Watch the sweep inspect imagery and pools ping in live</div>
          </div>
          <div className="step">
            <div className="n">03</div>
            <div className="t">Inspect the ranking, open any pool in maps, export the data</div>
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
            ▭ draw an area
          </button>
          <button className="btn" onClick={close}>
            explore first
          </button>
        </div>
      </div>
    </div>
  );
}
