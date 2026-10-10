/**
 * Colour of the pool outlines and the tools to measure a candidate colour
 * against real surfaces (pool water, roof tiles, grass, sampled from DGT,
 * PNOA and IGN tiles) with CIEDE2000.
 *
 * The outline is the magenta of the design (#FF52FF) over a dark casing
 * (#140814). On these samples it keeps a difference above 30 from roof tiles
 * and above 40 from grass. Against water it comes closer (about 17, the lime
 * used before kept about 31), so the casing carries the edge there.
 * test/map/outline.test.ts pins these numbers.
 */

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];

export const OUTLINE_CANDIDATES: readonly string[] = [
  '#ffffff',
  '#ffe14d',
  '#c6ff3d',
  '#ff52ff',
  '#ff8a1f',
  '#ff3b3b',
  '#3de8ff',
  '#a970ff',
];

export const POOL_OUTLINE = '#ff52ff';

/** Dark line drawn under every outline. */
export const OUTLINE_CASING = '#140814';

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0 to 255) to CIELAB, D65 white. */
export function rgbToLab([r8, g8, b8]: Rgb): Lab {
  const r = linear(r8);
  const g = linear(g8);
  const b = linear(b8);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const RAD = Math.PI / 180;

/** CIEDE2000 colour difference (Sharma, Wu and Dalal, 2005), kL = kC = kH = 1. */
export function ciede2000(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (bb: number, aa: number) => {
    if (bb === 0 && aa === 0) return 0;
    const h = Math.atan2(bb, aa) / RAD;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
  const Lmp = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hmp = (h1p + h2p) / 2;
    else hmp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hmp - 30) * RAD) +
    0.24 * Math.cos(2 * hmp * RAD) +
    0.32 * Math.cos((3 * hmp + 6) * RAD) -
    0.2 * Math.cos((4 * hmp - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

export interface SurfaceSample {
  class: string;
  rgb: Rgb;
}

export interface CandidateScore {
  colour: string;
  /** Smallest difference against any sample. */
  worst: number;
  /** Smallest difference per surface class. */
  byClass: Record<string, number>;
}

/** Scores every candidate, best first (largest worst-case difference). */
export function scoreOutlineColours(candidates: readonly string[], samples: readonly SurfaceSample[]): CandidateScore[] {
  if (samples.length === 0) throw new Error('no surface samples');
  const labs = samples.map((s) => ({ cls: s.class, lab: rgbToLab(s.rgb) }));
  return candidates
    .map((colour) => {
      const lab = rgbToLab(hexToRgb(colour));
      const byClass: Record<string, number> = {};
      let worst = Infinity;
      for (const s of labs) {
        const d = ciede2000(lab, s.lab);
        worst = Math.min(worst, d);
        byClass[s.cls] = Math.min(byClass[s.cls] ?? Infinity, d);
      }
      return { colour, worst, byClass };
    })
    .sort((a, b) => b.worst - a.worst);
}

export function pickOutlineColour(candidates: readonly string[], samples: readonly SurfaceSample[]): string {
  return scoreOutlineColours(candidates, samples)[0].colour;
}

/**
 * Corner cutting (Chaikin) for drawing only. A traced mask outline is a
 * staircase; two passes round it for the eye. Areas and sizes always come
 * from the mask, never from this ring. Returns a new ring, open like the
 * input (first point not repeated).
 */
export function chaikin(ring: readonly (readonly [number, number])[], iterations = 2): [number, number][] {
  let pts = ring.map(([x, y]) => [x, y] as [number, number]);
  if (pts.length > 1) {
    const [fx, fy] = pts[0];
    const [lx, ly] = pts[pts.length - 1];
    if (fx === lx && fy === ly) pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return pts;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    pts = next;
  }
  return pts;
}
