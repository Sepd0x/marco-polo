import { describe, expect, it, vi } from 'vitest';
import { DGT_ORTOS2025, ESRI_WORLD_IMAGERY, PNOA, type Ring } from '@marco-polo/core';

vi.mock('maplibre-gl', () => ({ addProtocol: vi.fn() }));

const { BaseImagery, RasterSlot, ScannedImagery, scannedParts, ANCHORS, DETAIL_MIN_ZOOM } = await import('../../src/map/sourceLayer.js');
type MapLike = import('../../src/map/sourceLayer.js').MapLike;

/** Records what the map was told; enough of MapLibre for the imagery classes. */
class FakeMap implements MapLike {
  sources = new Map<string, Record<string, unknown>>();
  layers: { id: string; before?: string; layout: Record<string, unknown>; spec: Record<string, unknown> }[] = [];
  maxZoom = 22;
  zoom = 16;
  center = { lng: -8.38, lat: 41.57 };
  span = 0.01;
  addSource(id: string, s: Record<string, unknown>) {
    if (this.sources.has(id)) throw new Error(`source ${id} exists`);
    this.sources.set(id, s);
  }
  removeSource(id: string) {
    if (this.layers.some((l) => l.spec.source === id)) throw new Error(`source ${id} still in use`);
    this.sources.delete(id);
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addLayer(spec: { id: string } & Record<string, unknown>, before?: string) {
    this.layers.push({ id: spec.id, before, layout: {}, spec });
  }
  removeLayer(id: string) {
    this.layers = this.layers.filter((l) => l.id !== id);
  }
  getLayer(id: string) {
    return this.layers.find((l) => l.id === id);
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    const l = this.getLayer(id);
    if (!l) throw new Error(`no layer ${id}`);
    l.layout[name] = value;
  }
  setMaxZoom(z: number) {
    this.maxZoom = z;
  }
  getZoom() {
    return this.zoom;
  }
  getCenter() {
    return this.center;
  }
  getBounds() {
    const { lng, lat } = this.center;
    const s = this.span;
    return { getWest: () => lng - s, getEast: () => lng + s, getSouth: () => lat - s, getNorth: () => lat + s };
  }
  visible(id: string) {
    return this.getLayer(id)?.layout.visibility !== 'none';
  }
}

const DPR2 = { devicePixelRatio: 2, saveData: false };
const DPR1 = { devicePixelRatio: 1, saveData: false };

describe('RasterSlot', () => {
  it('swapping the source takes the old one off and puts the new one on with its own tile size, maxzoom and attribution', () => {
    const map = new FakeMap();
    const slot = new RasterSlot(map, 'base', ANCHORS[1]);
    slot.set(ESRI_WORLD_IMAGERY, DPR1);
    expect([...map.sources.keys()]).toEqual(['base', 'base-top']);
    expect(map.sources.get('base')).toMatchObject({ tileSize: 256, maxzoom: 19, attribution: ESRI_WORLD_IMAGERY.attribution });

    slot.set(PNOA, DPR2);
    expect([...map.sources.keys()]).toEqual(['base']);
    expect(map.sources.get('base')).toMatchObject({ tileSize: 128, maxzoom: PNOA.maxZoom, attribution: PNOA.attribution });
    expect((map.sources.get('base')!.tiles as string[])[0]).toContain('www.ign.es/wmts/pnoa-ma');
    expect(map.layers.map((l) => [l.id, l.before])).toEqual([['base', ANCHORS[1]]]);
  });

  it('setting the same source again changes nothing', () => {
    const map = new FakeMap();
    const slot = new RasterSlot(map, 'b', ANCHORS[0]);
    expect(slot.set(PNOA, DPR2)).toBe(true);
    const first = map.sources.get('b');
    expect(slot.set(PNOA, DPR2)).toBe(false);
    expect(map.sources.get('b')).toBe(first);
  });

  it('keeps a hidden slot hidden across a swap', () => {
    const map = new FakeMap();
    const slot = new RasterSlot(map, 'b', ANCHORS[0]);
    slot.set(PNOA, DPR2);
    slot.setVisible(false);
    slot.set(ESRI_WORLD_IMAGERY, DPR2);
    expect(map.visible('b')).toBe(false);
    slot.setVisible(true);
    expect(map.visible('b')).toBe(true);
  });

  it('a clipped source goes through the clip protocol and is bounded by the region', () => {
    const map = new FakeMap();
    const slot = new RasterSlot(map, 'c', ANCHORS[2]);
    const ring: Ring = [[-8.38, 41.57], [-8.37, 41.57], [-8.37, 41.58], [-8.38, 41.58]];
    slot.set(DGT_ORTOS2025, DPR2, { rings: [ring], cells: null }, 'x');
    const src = map.sources.get('c')!;
    expect((src.tiles as string[])[0]).toMatch(/^mpclip:\/\/c\d+\/256\/\{z\}\/\{x\}\/\{y\}$/);
    expect(src.bounds).toEqual([-8.38, 41.57, -8.37, 41.58]);
    slot.clear();
    expect(map.sources.size).toBe(0);
    expect(map.layers).toHaveLength(0);
  });
});

describe('BaseImagery', () => {
  it('shows only the world source below the detail zoom', () => {
    const map = new FakeMap();
    map.zoom = DETAIL_MIN_ZOOM - 0.5;
    const base = new BaseImagery(map, DPR2);
    base.update();
    expect(base.detail.provider).toBeNull();
    expect(base.atCentre.id).toBe(ESRI_WORLD_IMAGERY.id);
    expect(map.visible('base-world')).toBe(true);
    expect(map.maxZoom).toBe(18.5);
  });

  it('in Portugal shows the DGT and hides the world source when the screen is all inside', () => {
    const map = new FakeMap();
    const base = new BaseImagery(map, DPR2);
    base.update();
    expect(base.detail.provider?.id).toBe('dgt-ortos2025');
    expect(map.visible('base-world')).toBe(false);
    const detail = map.sources.get('base-detail')!;
    expect(detail.attribution).toBe(DGT_ORTOS2025.attribution);
    expect((detail.tiles as string[])[0]).toMatch(/^mpclip:\/\//);
  });

  it('keeps the world source under the detail at a border, and swaps the detail when the centre crosses it', () => {
    const map = new FakeMap();
    map.center = { lng: -8.645, lat: 42.04 };
    map.span = 0.05;
    const base = new BaseImagery(map, DPR2);
    base.update();
    const first = base.detail.provider!.id;
    expect(['dgt-ortos2025', 'pnoa']).toContain(first);
    expect(map.visible('base-world')).toBe(true);
    map.center = { lng: -3.82, lat: 40.43 };
    map.span = 0.01;
    base.update();
    expect(base.detail.provider?.id).toBe('pnoa');
    expect(map.visible('base-world')).toBe(false);
    expect([...map.sources.keys()].filter((k) => k.startsWith('base-detail'))).toEqual(['base-detail']);
  });

  it('far from any national source the detail band is empty', () => {
    const map = new FakeMap();
    map.center = { lng: -111.926, lat: 33.594 };
    const base = new BaseImagery(map, DPR2);
    base.update();
    expect(base.detail.provider).toBeNull();
    expect(map.visible('base-world')).toBe(true);
  });
});

describe('scanned parts', () => {
  const braga: Ring = [[-8.3798, 41.5713], [-8.3764, 41.5713], [-8.3764, 41.5738], [-8.3798, 41.5738]];
  const minho: Ring = [[-8.65, 42.035], [-8.64, 42.035], [-8.64, 42.042], [-8.65, 42.042]];

  it('one part, no cells, inside one source', () => {
    const parts = scannedParts(braga, { mode: 'auto' });
    expect(parts).toHaveLength(1);
    expect(parts[0].provider.id).toBe('dgt-ortos2025');
    expect(parts[0].cells).toBeNull();
  });

  it('a fixed source wins over the coverage', () => {
    expect(scannedParts(braga, { mode: 'fixed', providerId: 'esri-world-imagery' })[0].provider.id).toBe('esri-world-imagery');
  });

  it('two parts with their cells across the Minho', () => {
    const parts = scannedParts(minho, { mode: 'auto' });
    expect(parts.map((p) => p.provider.id).sort()).toEqual(['dgt-ortos2025', 'pnoa']);
    for (const p of parts) expect(p.cells!.tiles.length).toBeGreaterThan(0);
  });

  it('a part the base already shows is hidden, others shown', () => {
    const map = new FakeMap();
    const base = new BaseImagery(map, DPR2);
    base.update();
    const scanned = new ScannedImagery(map, DPR2);
    scanned.setParts(braga, scannedParts(braga, { mode: 'auto' }));
    scanned.sync(base);
    expect(scanned.visibleSourceIds).toEqual([]);
    scanned.setParts(braga, scannedParts(braga, { mode: 'fixed', providerId: 'esri-world-imagery' }));
    scanned.sync(base);
    expect(scanned.visibleSourceIds).toEqual(['scanned-p1']);
    expect(map.getLayer('scanned-p1')?.before).toBe(ANCHORS[2]);
    scanned.setParts(null, []);
    expect([...map.sources.keys()].some((k) => k.startsWith('scanned'))).toBe(false);
  });
});
