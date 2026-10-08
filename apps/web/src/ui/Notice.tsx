import { useState } from 'react';
import { dismissImageryNotice, IMAGERY_NOTICE, imageryNoticePending } from '../state/settings.js';
import { IconClose } from './icons.js';

/**
 * Shown once, only to people whose saved settings pointed at a Mapbox,
 * MapTiler or custom template that this version removed.
 */
export function ImageryNotice() {
  const [pending, setPending] = useState(imageryNoticePending);
  if (!pending) return null;
  return (
    <div className="notice" role="status">
      <p>{IMAGERY_NOTICE}</p>
      <button
        className="icon-btn"
        aria-label="Dismiss"
        onClick={() => {
          dismissImageryNotice();
          setPending(false);
        }}
      >
        <IconClose />
      </button>
    </div>
  );
}
