import { useState } from 'react';
import { useStore } from '../state/store.js';

const KEY = 'marco-polo:imagery-hint-dismissed';

/**
 * One-time nudge, shown only while idle: the default Esri imagery is keyless
 * but dated in places; a free MapTiler/Mapbox key gives sharper, fresher tiles
 * and therefore better detections. Points the user at Settings → Imagery.
 */
export function ImageryHint({ onOpenSettings }: { onOpenSettings: () => void }) {
  const phase = useStore((s) => s.phase);
  const usingCustom = useStore((s) => s.settings.providerTemplate.trim().length > 0);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(KEY) === '1');

  if (dismissed || usingCustom || phase !== 'idle') return null;

  const close = () => {
    localStorage.setItem(KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="imagery-hint panel fade-up">
      <span className="ih-tag label">imagery</span>
      <span className="ih-text">
        Default is keyless Esri. For sharper, more recent tiles — and cleaner detections —
        add a free MapTiler or Mapbox key.
      </span>
      <button
        className="ih-link"
        onClick={() => {
          onOpenSettings();
          close();
        }}
      >
        settings →
      </button>
      <button className="ih-close" onClick={close} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
