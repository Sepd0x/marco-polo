import { useStore } from '../state/store.js';
import { formatCount } from '../lib/format.js';

export function HUD() {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const estimate = useStore((s) => s.areaEstimate);
  const pools = useStore((s) => s.ranked.length);

  let text: string;
  switch (phase) {
    case 'idle':
      text = 'standing by — draw an area';
      break;
    case 'ready':
      text = estimate
        ? `area locked — ${formatCount(estimate.count)}${estimate.approximate ? '+' : ''} tiles queued`
        : 'area locked';
      break;
    case 'scanning':
      text = `calling… ${formatCount(stats.tilesDone)}/${formatCount(stats.tilesTotal)} answered`;
      break;
    case 'paused':
      text = 'paused — holding position';
      break;
    case 'complete':
      text = `scan complete — ${formatCount(pools)} returns`;
      break;
  }

  return (
    <div className="hud panel fade-up">
      <div className="word">
        MARCO<span className="dot-sep">·</span>POLO
      </div>
      <div className="sub label">Satellite pool scanner</div>
      <div className="status">
        <span className={`status-dot ${phase}`} />
        <span className="value">{text}</span>
      </div>
    </div>
  );
}
