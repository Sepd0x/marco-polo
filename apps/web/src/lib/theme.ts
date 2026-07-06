/** Runtime accent theming over the pure-black OLED base. */

export interface AccentPreset {
  name: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'pool', hex: '#35e0ff' },
  { name: 'mono', hex: '#ffffff' },
  { name: 'signal', hex: '#55e6a5' },
  { name: 'amber', hex: '#ffc866' },
  { name: 'magenta', hex: '#ff5ce1' },
  { name: 'ember', hex: '#ff7a59' },
];

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Apply the accent to the document (CSS custom properties). */
export function applyAccent(hex: string): void {
  const rgb = parseHex(hex);
  if (!rgb) return;
  const root = document.documentElement.style;
  root.setProperty('--accent', hex.startsWith('#') ? hex : `#${hex}`);
  root.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
}

/** Slightly brighter variant for line work on the map. */
export function lighten(hex: string, amount = 0.35): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const l = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${((l(rgb.r) << 16) | (l(rgb.g) << 8) | l(rgb.b)).toString(16).padStart(6, '0')}`;
}
