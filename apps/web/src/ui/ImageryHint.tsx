import { useState } from 'react';
import { useStore } from '../state/store.js';
import { dismissImageryNotice, IMAGERY_NOTICE, imageryNoticePending } from '../state/settings.js';

/**
 * Shown once, and only to people whose saved settings pointed at a
 * Mapbox, MapTiler or custom template that this version removed.
 */
export function ImageryHint({ onOpenSettings }: { onOpenSettings: () => void }) {
  const phase = useStore((s) => s.phase);
  const [pending, setPending] = useState(imageryNoticePending);

  if (!pending || phase !== 'idle') return null;

  const close = () => {
    dismissImageryNotice();
    setPending(false);
  };

  return (
    <div className="imagery-hint panel fade-up" role="status">
      <span className="ih-tag label">imagery</span>
      <span className="ih-text">{IMAGERY_NOTICE}</span>
      <button
        className="ih-link"
        onClick={() => {
          onOpenSettings();
          close();
        }}
      >
        settings
      </button>
      <button className="ih-close" onClick={close} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
