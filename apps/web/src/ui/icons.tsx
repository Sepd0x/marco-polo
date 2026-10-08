import type { ReactNode } from 'react';

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconSearch = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.5" {...line} />
    <path d="M10.5 10.5 14 14" {...line} />
  </Icon>
);
export const IconMoon = () => (
  <Icon>
    <path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3Z" {...line} strokeWidth={1.4} />
  </Icon>
);
export const IconSun = () => (
  <Icon>
    <circle cx="8" cy="8" r="3" {...line} strokeWidth={1.4} />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" {...line} strokeWidth={1.4} />
  </Icon>
);
export const IconSliders = () => (
  <Icon>
    <path d="M2.5 4.5h11M2.5 11.5h11" {...line} strokeWidth={1.4} />
    <circle cx="10.5" cy="4.5" r="1.8" fill="var(--panel)" stroke="currentColor" strokeWidth={1.4} />
    <circle cx="5.5" cy="11.5" r="1.8" fill="var(--panel)" stroke="currentColor" strokeWidth={1.4} />
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
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
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
    <path
      d="M9 3h4v4M13 3 7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5"
      {...line}
      strokeWidth={1.4}
    />
  </Icon>
);
export const IconDownload = () => (
  <Icon>
    <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" {...line} strokeWidth={1.4} />
  </Icon>
);
export const IconChevron = () => (
  <Icon>
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" {...line} />
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
    <rect x="2.5" y="3.5" width="11" height="9" rx="1" {...line} strokeWidth={1.4} />
  </Icon>
);
export const IconShape = () => (
  <Icon>
    <path d="M3 5.5 7.5 2.5l5.5 3-1.5 7.5H4.5L3 5.5Z" {...line} strokeWidth={1.4} />
  </Icon>
);
export const IconView = () => (
  <Icon>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" {...line} strokeWidth={1.4} />
  </Icon>
);

/** Ink square with the pool colour inside: the product mark. */
export const Mark = () => (
  <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true" focusable="false" className="mark">
    <rect x="1.5" y="1.5" width="15" height="15" rx="4" fill="var(--ink)" />
    <rect x="4.5" y="6" width="9" height="6" rx="2" fill="var(--pool)" />
  </svg>
);
