import type { ReactNode } from 'react';

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'butt', strokeLinejoin: 'miter' } as const;

export const IconSearch = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.5" {...line} />
    <path d="M10.5 10.5 14 14" {...line} />
  </Icon>
);
export const IconMoon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" {...line} />
    <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />
  </Icon>
);
export const IconSun = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" {...line} />
    <path d="M8 2.5a5.5 5.5 0 0 0 0 11Z" fill="currentColor" />
  </Icon>
);
export const IconSliders = () => (
  <Icon>
    <path d="M2 4.5h12M2 11.5h12" {...line} />
    <rect x="9.5" y="2.5" width="2.5" height="4" fill="var(--panel)" stroke="currentColor" strokeWidth={1.25} />
    <rect x="4" y="9.5" width="2.5" height="4" fill="var(--panel)" stroke="currentColor" strokeWidth={1.25} />
  </Icon>
);
export const IconLayers = () => (
  <Icon>
    <path d="m8 2 6 3.2-6 3.2-6-3.2L8 2Z" {...line} strokeWidth={1.4} />
    <path d="m2 8.4 6 3.2 6-3.2" {...line} strokeWidth={1.4} />
  </Icon>
);
export const IconPause = () => (
  <Icon>
    <path d="M5.5 3.5v9M10.5 3.5v9" {...line} strokeWidth={1.8} />
  </Icon>
);
export const IconPlay = () => (
  <Icon>
    <path d="M5 3.2v9.6L12.5 8 5 3.2Z" fill="currentColor" />
  </Icon>
);
export const IconStop = () => (
  <Icon>
    <rect x="4" y="4" width="8" height="8" fill="currentColor" />
  </Icon>
);
export const IconPrev = () => (
  <Icon>
    <path d="M10 3.5 5.5 8l4.5 4.5" {...line} />
  </Icon>
);
export const IconNext = () => (
  <Icon>
    <path d="M6 3.5 10.5 8 6 12.5" {...line} />
  </Icon>
);
export const IconClose = () => (
  <Icon>
    <path d="m4 4 8 8M12 4l-8 8" {...line} />
  </Icon>
);
export const IconCopy = () => (
  <Icon>
    <rect x="5" y="5" width="8" height="8" rx="1.5" {...line} strokeWidth={1.3} />
    <path d="M3 10.5V4a1 1 0 0 1 1-1h6.5" {...line} strokeWidth={1.3} />
  </Icon>
);
export const IconCheck = () => (
  <Icon>
    <path d="m3.5 8.5 3 3 6-7" {...line} />
  </Icon>
);
export const IconExternal = () => (
  <Icon>
    <path d="M6 3.5h6.5V10M12.5 3.5 3.5 12.5" {...line} />
  </Icon>
);
export const IconDownload = () => (
  <Icon>
    <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10" {...line} />
  </Icon>
);
export const IconChevron = () => (
  <Icon>
    <path d="m4.5 6 3.5 3.5L11.5 6" {...line} />
  </Icon>
);
export const IconList = () => (
  <Icon>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" {...line} strokeWidth={1.4} />
    <circle cx="2.6" cy="4" r="1" fill="currentColor" />
    <circle cx="2.6" cy="8" r="1" fill="currentColor" />
    <circle cx="2.6" cy="12" r="1" fill="currentColor" />
  </Icon>
);
export const IconRect = () => (
  <Icon>
    <rect x="2.5" y="4.5" width="11" height="7" {...line} />
  </Icon>
);
export const IconShape = () => (
  <Icon>
    <path d="M2.5 5.5 8.5 2.5l5 4.5-3 6.5-7-2Z" {...line} />
  </Icon>
);
export const IconView = () => (
  <Icon>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" {...line} strokeWidth={1.4} />
  </Icon>
);

/**
 * The mark: an M drawn as a photogrammetric flight plan, one line flown strip
 * by strip the way a scan covers its tiles. The last strip, still being flown,
 * is the accent and stops halfway down.
 */
export const Mark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="mark">
    <path d="M5.5 27V6.5H12.5V18.5H19.5V6.5H28" fill="none" stroke="var(--ink)" strokeWidth="3" />
    <rect x="25" y="8" width="3" height="12" fill="var(--accent)" />
  </svg>
);

export const IconPlus = () => (
  <Icon>
    <path d="M8 2.5v11M2.5 8h11" {...line} strokeWidth={1.3} strokeLinecap="butt" />
  </Icon>
);
export const IconMinus = () => (
  <Icon>
    <path d="M2.5 8h11" {...line} strokeWidth={1.3} strokeLinecap="butt" />
  </Icon>
);
