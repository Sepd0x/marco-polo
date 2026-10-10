/**
 * Where a pool number may go, worked out per zoom level so that MapLibre
 * never puts a number where it could be read as another pool's.
 *
 * MapLibre lays out the symbols of a tile once per integer zoom n and keeps
 * label offsets fixed in screen px until n + 1, while the pools keep growing.
 * So every size here is the pool's size at n + 1, the largest it gets in the
 * level. Two rules come out of this module:
 * - a keep-out box per pool (an invisible icon the numbers collide with),
 *   as large as the pool at n + 1;
 * - per level, the anchors whose label centre lies nearer to its own pool
 *   centre than to any other. Centres move apart as the zoom grows inside a
 *   level and the offsets stay, so a check at n holds for the whole level.
 *
 * Pure: no DOM, no MapLibre, so the unit tests run it directly.
 */

export type Anchor = 'left' | 'right' | 'top' | 'bottom';

/** Label to the right first (reading order), then left, below, above. MapLibre anchors name the label side at the point. */
export const ANCHORS: readonly Anchor[] = ['left', 'right', 'top', 'bottom'];

/** World size in px at zoom 0 (MapLibre tiles are 512 px). */
export const WORLD_PX = 512;

/** text-size of the rank layer: one em of text-offset is this many px. */
export const EM_PX = 12;

/** Collision padding MapLibre adds around an icon and around a text (its defaults). */
export const ICON_PADDING = 2;
export const TEXT_PADDING = 2;

/**
 * MapLibre pulls a text with a top anchor up, and one with a bottom anchor
 * down, by 7/24 em (its baseline shift for glyphs). An image label has no
 * baseline, so the offsets add it back.
 */
const BASELINE_EM = 7 / 24;

/** Extra px between the own keep-out and the number, so rounding never makes them touch. */
const GAP = 1;

/** A label centre must be this many px nearer to its own pool centre than to any other. */
export const NEAREST_MARGIN = 2;

/** Long side of every keep-out image, px. */
export const KEEPOUT_LONG = 64;

/** Aspect ratios of the keep-out images; a pool takes the largest not above its own, so the box always covers it. */
const ASPECTS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 6] as const;

export interface KeepoutImage {
  id: string;
  width: number;
  height: number;
}

/** Every keep-out image, so the map can hold them all before the first pool. */
export function keepoutImages(): KeepoutImage[] {
  const out: KeepoutImage[] = [];
  for (const a of ASPECTS) {
    const short = Math.ceil(KEEPOUT_LONG / a);
    out.push({ id: `keepout:${KEEPOUT_LONG}x${short}`, width: KEEPOUT_LONG, height: short });
    if (a !== 1) out.push({ id: `keepout:${short}x${KEEPOUT_LONG}`, width: short, height: KEEPOUT_LONG });
  }
  return out;
}

export interface LonLatBox {
  west: number;
  east: number;
  south: number;
  north: number;
}

export function worldX(lon: number): number {
  return ((lon + 180) / 360) * WORLD_PX;
}

export function worldY(lat: number): number {
  const phi = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * WORLD_PX;
}

/** A pool in world px at zoom 0: its centre and the half size of its keep-out box. */
export interface PoolBox {
  x: number;
  y: number;
  /** Half width and half height of the keep-out box at zoom 0. */
  hw: number;
  hh: number;
  /** Keep-out image and the icon-size that makes it the box at zoom 0 (doubles each zoom). */
  image: string;
  size0: number;
  /** Larger side of the pool's own box at zoom 0, for the dot. */
  extent0: number;
}

export function poolBox(center: { lon: number; lat: number }, bbox: LonLatBox): PoolBox {
  const x = worldX(center.lon);
  const y = worldY(center.lat);
  // Half sizes that hold the whole outline around the centre, which need not be the box middle.
  const w = 2 * Math.max(Math.abs(worldX(bbox.east) - x), Math.abs(x - worldX(bbox.west)));
  const h = 2 * Math.max(Math.abs(worldY(bbox.south) - y), Math.abs(y - worldY(bbox.north)));
  const long = Math.max(w, h, 1e-9);
  const short = Math.max(Math.min(w, h), 1e-12);
  let aspect: number = ASPECTS[0];
  for (const a of ASPECTS) if (a <= long / short) aspect = a;
  const shortPx = Math.ceil(KEEPOUT_LONG / aspect);
  const wide = w >= h;
  const imgW = wide ? KEEPOUT_LONG : shortPx;
  const imgH = wide ? shortPx : KEEPOUT_LONG;
  const size0 = long / KEEPOUT_LONG;
  return {
    x,
    y,
    hw: (imgW * size0) / 2,
    hh: (imgH * size0) / 2,
    image: `keepout:${imgW}x${imgH}`,
    size0,
    extent0: long,
  };
}

export interface LabelSize {
  width: number;
  height: number;
}

/** An anchor list as MapLibre's text-variable-anchor-offset takes it: anchor, [x, y] in ems, and so on. */
export type AnchorList = (string | [number, number])[];

/**
 * When no anchor is safe, the number goes on its own pool centre, where its
 * own keep-out box always collides with it, so MapLibre hides it.
 */
export const HIDDEN: AnchorList = ['center', [0, 0]];

/** Offset in px from the pool centre to the label centre, and the em offset MapLibre takes, for one anchor. */
export function anchorGeometry(
  anchor: Anchor,
  halfW: number,
  halfH: number,
  label: LabelSize,
): { dx: number; dy: number; offset: [number, number] } {
  const ox = halfW + ICON_PADDING + GAP;
  const oy = halfH + ICON_PADDING + GAP;
  const cx = ox + TEXT_PADDING + label.width / 2;
  const cy = oy + TEXT_PADDING + label.height / 2;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  switch (anchor) {
    case 'left':
      return { dx: cx, dy: 0, offset: [round(ox / EM_PX), 0] };
    case 'right':
      return { dx: -cx, dy: 0, offset: [round(-ox / EM_PX), 0] };
    case 'top':
      return { dx: 0, dy: cy, offset: [0, round(oy / EM_PX + BASELINE_EM)] };
    case 'bottom':
      return { dx: 0, dy: -cy, offset: [0, round(-oy / EM_PX - BASELINE_EM)] };
  }
}

/**
 * The anchor list of every pool at zoom level n: the anchors whose label
 * centre is nearer, by NEAREST_MARGIN, to its own pool centre than to any
 * other pool centre. Checked with the centres at n and the boxes at n + 1.
 */
export function levelAnchors(pools: PoolBox[], labels: LabelSize[], level: number): AnchorList[] {
  const scale = 2 ** level;
  const boxScale = 2 ** (level + 1);
  const xs = pools.map((p) => p.x * scale);
  const ys = pools.map((p) => p.y * scale);
  const cell = 128;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  pools.forEach((_, i) => {
    const k = key(Math.floor(xs[i] / cell), Math.floor(ys[i] / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });

  return pools.map((p, i) => {
    const out: AnchorList = [];
    for (const anchor of ANCHORS) {
      const g = anchorGeometry(anchor, p.hw * boxScale, p.hh * boxScale, labels[i]);
      const lx = xs[i] + g.dx;
      const ly = ys[i] + g.dy;
      const own = Math.hypot(g.dx, g.dy);
      const reach = own + NEAREST_MARGIN;
      let clear = true;
      const x0 = Math.floor((lx - reach) / cell);
      const x1 = Math.floor((lx + reach) / cell);
      const y0 = Math.floor((ly - reach) / cell);
      const y1 = Math.floor((ly + reach) / cell);
      for (let gx = x0; gx <= x1 && clear; gx++) {
        for (let gy = y0; gy <= y1 && clear; gy++) {
          for (const j of grid.get(key(gx, gy)) ?? []) {
            if (j !== i && Math.hypot(xs[j] - lx, ys[j] - ly) < reach) {
              clear = false;
              break;
            }
          }
        }
      }
      if (clear) out.push(anchor, g.offset);
    }
    return out.length ? out : HIDDEN;
  });
}
