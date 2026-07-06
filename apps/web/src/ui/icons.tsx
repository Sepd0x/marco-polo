/** Crisp 14px stroke icons — one visual voice for every control. */
import type { SVGProps } from 'react';

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 13,
    height: 13,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'square' as const,
    'aria-hidden': true,
    ...props,
  };
}

export const IconRect = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="2.5" y="4" width="11" height="8" />
  </svg>
);

export const IconPolygon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 2 L14 6.5 L11.5 13.5 L4.5 13.5 L2 6.5 Z" />
  </svg>
);

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 2.5 L13 8 L4 13.5 Z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3" width="3" height="10" fill="currentColor" stroke="none" />
    <rect x="9.5" y="3" width="3" height="10" fill="currentColor" stroke="none" />
  </svg>
);

export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="9" height="9" fill="currentColor" stroke="none" />
  </svg>
);

export const IconTarget = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5" />
    <path d="M8 0.5 V4 M8 12 V15.5 M0.5 8 H4 M12 8 H15.5" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2M3.4 3.4l1.6 1.6M11 11l1.6 1.6M12.6 3.4L11 5M5 11l-1.6 1.6" />
  </svg>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 2v8M4.5 6.5 L8 10 L11.5 6.5" />
    <path d="M2.5 13.5h11" />
  </svg>
);

export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 3H3v10h10v-3" />
    <path d="M9 2h5v5M14 2 8 8" />
  </svg>
);

export const IconGitHub = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} stroke="none" fill="currentColor">
    <path d="M8 .8a7.3 7.3 0 0 0-2.3 14.2c.4.1.5-.2.5-.4v-1.3c-2 .4-2.5-.9-2.5-.9-.3-.9-.8-1.1-.8-1.1-.7-.4 0-.4 0-.4.8 0 1.2.8 1.2.8.6 1.1 1.7.8 2.1.6 0-.5.2-.8.4-1-1.6-.2-3.3-.8-3.3-3.6 0-.8.3-1.5.8-2-.1-.2-.3-1 0-2 0 0 .6-.2 2 .8a7 7 0 0 1 3.7 0c1.4-1 2-.8 2-.8.4 1 .1 1.8 0 2 .5.5.8 1.2.8 2 0 2.8-1.7 3.4-3.3 3.6.3.2.5.7.5 1.4v2c0 .2.1.5.5.4A7.3 7.3 0 0 0 8 .8Z" />
  </svg>
);

export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 6 L8 11 L13 6" />
  </svg>
);

export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2.5v3h-3" />
  </svg>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const IconClear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </svg>
);
