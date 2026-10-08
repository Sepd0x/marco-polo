import {
  coverageContains,
  ESRI_WORLD_IMAGERY,
  findAnyProvider,
  estimateTileCount,
  PLAN_LIMITS,
  pickProvider,
  ringBBox,
  splitPlanBySource,
  type ImageryProvider,
  type ImagerySetting,
  type Ring,
  type TileCoord,
} from '@marco-polo/core';
import { registerClip, regionBounds, unregisterClip, type ClipRegion } from './clip.js';
import { mapMaxZoom, rasterPieces, type DisplayOptions, type RasterPiece } from './sources.js';

/**
 * Imagery layers. Three bands, bottom to top, each above an empty anchor
 * layer so a swap never reorders them:
 *   world    Esri, everywhere;
 *   detail   the source `auto` gives for the centre of the screen, cut to its
 *            coverage (the Esri underneath fills the rest);
 *   scanned  inside the drawn area, the source each part is scanned on.
 */

export const ANCHORS = ['anchor-world', 'anchor-detail', 'anchor-scanned'] as const;

/** Below this zoom the world source alone is shown: national sources are for close views. */
export const DETAIL_MIN_ZOOM = 11;

/** The part of MapLibre's map these classes use, so tests can pass a stand-in. */
export interface MapLike {
  addSource(id: string, source: RasterPiece['source']): unknown;
  removeSource(id: string): unknown;
  getSource(id: string): unknown;
  addLayer(layer: RasterPiece['layer'], beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  getLayer(id: string): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): unknown;
  setMaxZoom(zoom: number): unknown;
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  getBounds(): { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number };
}

/** Empty layers that keep the imagery bands in order. Add before anything else. */
export function anchorLayers(): { id: string; type: 'background'; paint: Record<string, unknown> }[] {
  return ANCHORS.map((id) => ({ id, type: 'background', paint: { 'background-opacity': 0 } }));
}

/** One provider on the map, as one or two raster pieces, swapped as a whole. */
export class RasterSlot {
  provider: ImageryProvider | null = null;
  private pieces: RasterPiece[] = [];
  private clipKey: string | null = null;
  private key = '';
  private visible = true;

  constructor(
    private map: MapLike,
    private prefix: string,
    private beforeId: string,
  ) {}

  /**
   * Shows `provider`, cut to `region` when given. Same provider and region:
   * nothing happens. Returns true when the layers changed.
   */
  set(provider: ImageryProvider | null, display: DisplayOptions, region: ClipRegion | null = null, regionKey = ''): boolean {
    const key = provider ? `${provider.id}|${display.devicePixelRatio}|${display.saveData}|${regionKey}` : '';
    if (key === this.key) return false;
    this.clear();
    this.key = key;
    this.provider = provider;
    if (!provider) return true;
    let bounds: [number, number, number, number] | undefined;
    if (region) bounds = regionBounds(region);
    const keys: string[] = [];
    this.pieces = rasterPieces(this.prefix, provider, display, {
      bounds,
      url: region
        ? (_template, px) => {
            const c = registerClip(provider, region, px);
            keys.push(c.key);
            return c.url;
          }
        : undefined,
    });
    this.clipKey = keys.join(',') || null;
    for (const p of this.pieces) {
      this.map.addSource(p.sourceId, p.source);
      this.map.addLayer(p.layer, this.beforeId);
      if (!this.visible) this.map.setLayoutProperty(p.layer.id, 'visibility', 'none');
    }
    return true;
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    for (const p of this.pieces) {
      if (this.map.getLayer(p.layer.id)) this.map.setLayoutProperty(p.layer.id, 'visibility', on ? 'visible' : 'none');
    }
  }

  get isVisible(): boolean {
    return this.visible && this.provider !== null;
  }

  /** Source ids now on the map, for tests and debugging. */
  get sourceIds(): string[] {
    return this.pieces.map((p) => p.sourceId);
  }

  clear(): void {
    for (const p of this.pieces) {
      if (this.map.getLayer(p.layer.id)) this.map.removeLayer(p.layer.id);
      if (this.map.getSource(p.sourceId)) this.map.removeSource(p.sourceId);
    }
    if (this.clipKey) for (const k of this.clipKey.split(',')) unregisterClip(k);
    this.pieces = [];
    this.clipKey = null;
    this.provider = null;
    this.key = '';
  }
}

function coverageRegion(provider: ImageryProvider): ClipRegion | null {
  return provider.coverage ? { rings: provider.coverage.polygons, cells: null } : null;
}

/** True when the whole screen lies in the provider's coverage. */
function screenCovered(map: MapLike, provider: ImageryProvider): boolean {
  if (!provider.coverage) return true;
  const b = map.getBounds();
  const w = b.getWest();
  const e = b.getEast();
  const s = b.getSouth();
  const n = b.getNorth();
  const mx = (w + e) / 2;
  const my = (s + n) / 2;
  const pts: [number, number][] = [
    [w, s], [e, s], [e, n], [w, n],
    [mx, s], [mx, n], [w, my], [e, my],
  ];
  return pts.every(([lon, lat]) => coverageContains(provider.coverage, lon, lat));
}

/** The world and detail bands. Call `update` after every move. */
export class BaseImagery {
  readonly world: RasterSlot;
  readonly detail: RasterSlot;

  constructor(
    private map: MapLike,
    private display: DisplayOptions,
  ) {
    this.world = new RasterSlot(map, 'base-world', ANCHORS[0]);
    this.detail = new RasterSlot(map, 'base-detail', ANCHORS[1]);
    this.world.set(ESRI_WORLD_IMAGERY, display);
  }

  /** Source the screen centre shows outside any scanned area. */
  get atCentre(): ImageryProvider {
    return this.detail.provider ?? ESRI_WORLD_IMAGERY;
  }

  update(): void {
    const c = this.map.getCenter();
    let detail: ImageryProvider | null = null;
    if (this.map.getZoom() >= DETAIL_MIN_ZOOM) {
      const p = pickProvider({ lon: c.lng, lat: c.lat });
      if (p.id !== ESRI_WORLD_IMAGERY.id) detail = p;
    }
    if (detail) {
      const region = coverageRegion(detail);
      this.detail.set(detail, this.display, region, 'coverage');
    } else {
      this.detail.set(null, this.display);
    }
    this.world.setVisible(!detail || !screenCovered(this.map, detail));
    this.map.setMaxZoom(mapMaxZoom(this.atCentre));
  }

  clear(): void {
    this.world.clear();
    this.detail.clear();
  }
}

/** A part of the scanned area on one source. */
export interface ScannedPart {
  id: string;
  provider: ImageryProvider;
  /** Owned grid cells when the area is split between sources, else null. */
  cells: { zoom: number; tiles: TileCoord[] } | null;
}

/**
 * Parts of an area the way the scan splits them. Areas too large to scan
 * are not split (the scan refuses them anyway): the centre's source covers
 * the whole area.
 */
export function scannedParts(area: Ring, setting: ImagerySetting): ScannedPart[] {
  const est = estimateTileCount(area, 19);
  if (est.approximate || est.count > PLAN_LIMITS.blockTiles) {
    const b = ringBBox(area);
    return [{ id: 'p1', provider: pickProvider({ lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 }, setting), cells: null }];
  }
  const split = splitPlanBySource(area, setting);
  if (split.parts.length === 1) return [{ id: split.parts[0].id, provider: split.parts[0].provider, cells: null }];
  return split.parts.map((p) => ({ id: p.id, provider: p.provider, cells: { zoom: p.cellZoom, tiles: p.cells } }));
}

/** A part as the scan reports it: the source it really used (after any fallback). */
export interface ReportedPart {
  id: string;
  providerId: string;
  zoom: number;
  tiles: { tile: TileCoord }[];
}

/**
 * Parts to show inside the area. Before a scan, the split the scan would
 * make. Once a scan reports its parts (live or archived), each part shows the
 * source it was scanned on, which differs from the split when a part fell
 * back to another source.
 */
export function mapParts(area: Ring, setting: ImagerySetting, reported: readonly ReportedPart[]): ScannedPart[] {
  const planned = scannedParts(area, setting);
  if (reported.length === 0) return planned;
  if (reported.length === 1) {
    const p = findAnyProvider(reported[0].providerId);
    return p ? [{ id: reported[0].id, provider: p, cells: null }] : planned;
  }
  const byId = new Map(planned.map((p) => [p.id, p]));
  const out: ScannedPart[] = [];
  for (const r of reported) {
    const provider = findAnyProvider(r.providerId);
    if (!provider) continue;
    const same = byId.get(r.id);
    // Archived parts keep no tile list; the planned split gives their cells.
    const cells = same?.cells ?? (r.tiles.length ? { zoom: r.zoom, tiles: r.tiles.map((t) => t.tile) } : null);
    out.push({ id: r.id, provider, cells });
  }
  return out.length ? out : planned;
}

/**
 * The scanned band: one clipped slot per part. A part is hidden while the
 * base band already shows its source, so the same tiles are not fetched twice.
 */
export class ScannedImagery {
  private slots = new Map<string, RasterSlot>();
  private version = 0;

  constructor(
    private map: MapLike,
    private display: DisplayOptions,
  ) {}

  setParts(area: Ring | null, parts: ScannedPart[]): void {
    this.clear();
    if (!area) return;
    this.version++;
    for (const part of parts) {
      const slot = new RasterSlot(this.map, `scanned-${part.id}`, ANCHORS[2]);
      const region: ClipRegion = {
        rings: [area],
        cells: part.cells ? { zoom: part.cells.zoom, keys: new Set(part.cells.tiles.map((t) => `${t.x},${t.y}`)) } : null,
      };
      slot.set(part.provider, this.display, region, `v${this.version}`);
      this.slots.set(part.id, slot);
    }
  }

  /** Hide parts whose source the base already shows at the centre. */
  sync(base: BaseImagery): void {
    for (const slot of this.slots.values()) {
      const p = slot.provider;
      const sameAsBase = p !== null && p.id === base.atCentre.id && (base.atCentre === ESRI_WORLD_IMAGERY ? base.world.isVisible : true);
      slot.setVisible(!sameAsBase);
    }
  }

  get providers(): ImageryProvider[] {
    return [...this.slots.values()].map((s) => s.provider).filter((p): p is ImageryProvider => p !== null);
  }

  get visibleSourceIds(): string[] {
    return [...this.slots.values()].filter((s) => s.isVisible).flatMap((s) => s.sourceIds);
  }

  clear(): void {
    for (const s of this.slots.values()) s.clear();
    this.slots.clear();
  }
}
