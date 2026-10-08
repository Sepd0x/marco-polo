/**
 * Light and dark themes. With no saved choice the page follows the system
 * through CSS alone; a choice made with the toggle is saved and written to
 * `data-theme` on the root element.
 */

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'marco-polo:theme';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function savedTheme(): Theme | null {
  try {
    const v = storage()?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function currentTheme(): Theme {
  return savedTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function setTheme(theme: Theme): void {
  try {
    storage()?.setItem(THEME_KEY, theme);
  } catch {
    // storage refused; the choice lasts for this page only
  }
  applyTheme(theme);
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Mix a colour toward white. Still used by the map overlay. */
export function lighten(hex: string, amount = 0.35): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const l = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${((l(rgb.r) << 16) | (l(rgb.g) << 8) | l(rgb.b)).toString(16).padStart(6, '0')}`;
}

/** WCAG 2.x relative luminance of an sRGB hex colour. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`not a colour: ${hex}`);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
