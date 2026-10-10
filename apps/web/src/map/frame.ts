import type * as maplibregl from 'maplibre-gl';

/*
 * The map as a survey photograph: a neat line round the view, fiducial marks
 * at the corners and at the middle of each side, graduation and coordinates
 * in the margin, and a réseau of small crosses over the image. Everything is
 * worked out from the map on every move, so it follows pan and zoom. It is
 * only true because the map never rotates or tilts (MapView locks both).
 */

/** Steps the graduation can take, in degrees: 1, 2 and 5 times a power of ten. */
export function niceStep(minDeg: number): number {
  if (!(minDeg > 0) || !Number.isFinite(minDeg)) return 1;
  const p = 10 ** Math.floor(Math.log10(minDeg));
  for (const m of [1, 2, 5, 10]) if (m * p >= minDeg * (1 - 1e-9)) return m * p;
  return 10 * p;
}

/** Decimals that write every multiple of a step exactly: 0.0005 needs 4, 0.002 needs 3, 5 needs 0. */
export function stepDecimals(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

/** Multiples of `step` from a to b inclusive, rounded so they print exactly. */
export function multiples(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  const d = stepDecimals(step) + 2;
  for (let k = Math.ceil(a / step - 1e-9); k * step <= b + step * 1e-9; k++) out.push(Number((k * step).toFixed(d)));
  return out;
}

export function isMultiple(v: number, step: number): boolean {
  return Math.abs(v / step - Math.round(v / step)) < 1e-6;
}

/** A longitude brought back into -180 to 180, for display after the map crosses the antimeridian. */
export function wrapLongitude(lon: number): number {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lon > 0 ? 180 : w;
}

/** Decimal degrees with the typographic minus and the degree sign, as everywhere in the interface. */
export function formatDegrees(v: number, decimals: number): string {
  const s = (Math.abs(v) < 0.5 * 10 ** -decimals ? 0 : v).toFixed(decimals);
  return `${s.replace('-', '−')}°`;
}

/* Scale bar */

const NICE = [1, 2, 5];

/** The longest round ground length that fits in `maxPx`, and its length on screen. */
export function scaleFor(mPerPx: number, maxPx: number): { metres: number; px: number } {
  const maxM = mPerPx * maxPx;
  const p = 10 ** Math.floor(Math.log10(maxM));
  let metres = p;
  for (const n of NICE) if (n * p <= maxM) metres = n * p;
  return { metres, px: metres / mPerPx };
}

/** Ground metres per CSS pixel at a zoom and latitude, for MapLibre's 512 px tiles. */
export function metresPerPixel(zoom: number, lat: number): number {
  return (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

export interface FrameStyle {
  /** Coordinates in the top and left margins. */
  labels: boolean;
  /** Fiducial size and its gap to the neat line, px. */
  fid: number;
  gap: number;
  /** Half the arm of a réseau cross, px. */
  cross: number;
  /** Smallest distance between two labelled graduations, px. */
  labelEvery: number;
}

const NS = 'http://www.w3.org/2000/svg';
/** Width of a 12 px Martian Mono glyph at width 75, for label spacing. */
const CHAR_W = 7.2;

/**
 * Draws the frame in an SVG laid over the map container. The SVG overflows
 * the container into the margins of the frame around it, which the page
 * leaves free for it.
 */
export class FrameOverlay {
  private map: maplibregl.Map;
  private svg: SVGSVGElement;
  private style: () => FrameStyle;
  private raf = 0;

  constructor(map: maplibregl.Map, style: () => FrameStyle) {
    this.map = map;
    this.style = style;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'frame-svg');
    this.svg.setAttribute('aria-hidden', 'true');
    map.getContainer().parentElement?.appendChild(this.svg);
    map.on('move', this.schedule);
    map.on('resize', this.schedule);
    this.render();
  }

  private schedule = (): void => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  };

  render(): void {
    const c = this.map.getContainer();
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (W <= 0 || H <= 0) {
      this.svg.innerHTML = '';
      return;
    }
    const st = this.style();
    const nw = this.map.unproject([0, 0]);
    const se = this.map.unproject([W, H]);
    const west = nw.lng;
    const east = se.lng;
    const north = nw.lat;
    const south = se.lat;
    const midLat = (north + south) / 2;
    const midLon = (west + east) / 2;
    const xOf = (lon: number) => this.map.project([lon, midLat]).x;
    const yOf = (lat: number) => this.map.project([midLon, lat]).y;

    const pxPerDeg = W / Math.max(east - west, 1e-12);
    const step = niceStep(st.labelEvery / pxPerDeg);
    const minor = step / 5;
    const reseau = step * 2;
    const dec = stepDecimals(step);
    const cx = W / 2;
    const cy = H / 2;
    const half = st.fid * 0.55;
    const parts: string[] = [];

    // Réseau: white crosses on a dark casing, kept clear of the neat line.
    const crosses: string[] = [];
    const r = st.cross;
    for (const lon of multiples(west, east, reseau)) {
      const x = xOf(lon);
      if (x < 6 || x > W - 6) continue;
      for (const lat of multiples(south, north, reseau)) {
        const y = yOf(lat);
        if (y < 6 || y > H - 6) continue;
        crosses.push(`M${(x - r).toFixed(1)} ${y.toFixed(1)}h${2 * r}M${x.toFixed(1)} ${(y - r).toFixed(1)}v${2 * r}`);
      }
    }
    if (crosses.length) {
      const d = crosses.join('');
      parts.push(`<path class="reseau-casing" d="${d}"/><path class="reseau" d="${d}"/>`);
    }

    // Neat line and graduation, the same step on both axes.
    parts.push(`<rect class="neat" x="-0.5" y="-0.5" width="${W + 1}" height="${H + 1}"/>`);
    const ticks: string[] = [];
    for (const lon of multiples(west, east, minor)) {
      const x = Math.round(xOf(lon)) + 0.5;
      if (x < 0 || x > W || Math.abs(x - cx) < half + 2) continue;
      const L = isMultiple(lon, step) ? 7 : 3;
      ticks.push(`M${x} -1v${-L}M${x} ${H + 1}v${L}`);
    }
    for (const lat of multiples(south, north, minor)) {
      const y = Math.round(yOf(lat)) + 0.5;
      if (y < 0 || y > H || Math.abs(y - cy) < half + 2) continue;
      const L = isMultiple(lat, step) ? 7 : 3;
      ticks.push(`M-1 ${y}h${-L}M${W + 1} ${y}h${L}`);
    }
    parts.push(`<path class="ticks" d="${ticks.join('')}"/>`);

    if (st.labels) {
      const labels: string[] = [];
      let last = -Infinity;
      for (const lon of multiples(west, east, step)) {
        const x = xOf(lon);
        const text = formatDegrees(wrapLongitude(lon), dec);
        const w = text.length * CHAR_W;
        const lx = x + 4;
        // A label that would sit on the middle fiducial is left out: moved, it reads as the next tick's.
        if (lx < cx + half + 4 && lx + w > cx - half - 4) continue;
        if (x < 2 || lx < last + 10 || lx + w > W - 2) continue;
        labels.push(`<text x="${lx.toFixed(1)}" y="-11">${text}</text>`);
        last = lx + w;
      }
      last = Infinity;
      for (const lat of multiples(south, north, step)) {
        const y = yOf(lat);
        const text = formatDegrees(lat, dec);
        const w = text.length * CHAR_W;
        const ly = y - 4;
        if (ly > cy - half - 4 && ly - w < cy + half + 4) continue;
        if (y > H - 2 || ly > last - 10 || ly - w < 2) continue;
        labels.push(`<text transform="translate(-11 ${ly.toFixed(1)}) rotate(-90)">${text}</text>`);
        last = ly - w;
      }
      parts.push(`<g class="coords">${labels.join('')}</g>`);
    }

    // Fiducials: corner brackets and a triangle at the middle of each side.
    const F = st.fid;
    const g = st.gap;
    const k = 1.25;
    const corner = (x: number, y: number, dx: number, dy: number) =>
      `M${x} ${y}h${dx * F}v${dy * k}h${-dx * (F - k)}v${dy * (F - k)}h${-dx * k}Z`;
    const fid = [
      corner(-g, -g, -1, -1),
      corner(W + g, -g, 1, -1),
      corner(-g, H + g, -1, 1),
      corner(W + g, H + g, 1, 1),
      `M${cx - half} ${-g - F * 0.9}h${2 * half}l${-half} ${F * 0.9}Z`,
      `M${cx - half} ${H + g + F * 0.9}h${2 * half}l${-half} ${-F * 0.9}Z`,
      `M${-g - F * 0.9} ${cy - half}v${2 * half}l${F * 0.9} ${-half}Z`,
      `M${W + g + F * 0.9} ${cy - half}v${2 * half}l${-F * 0.9} ${-half}Z`,
    ];
    parts.push(`<path class="fid" d="${fid.join('')}"/>`);

    this.svg.setAttribute('width', String(W));
    this.svg.setAttribute('height', String(H));
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.innerHTML = parts.join('');
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.map.off('move', this.schedule);
    this.map.off('resize', this.schedule);
    this.svg.remove();
  }
}
