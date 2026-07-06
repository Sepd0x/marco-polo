import maplibregl from 'maplibre-gl';
import type { Ring } from '@marco-polo/core';

type Mode = 'rect' | 'polygon' | null;

interface DraftGeoJSON {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
}

const EMPTY: DraftGeoJSON = { type: 'FeatureCollection', features: [] };

/**
 * Custom area-drawing tool: shift-free rectangle drag and click-vertex polygon,
 * rendered through a `draft` GeoJSON source so its look matches the product.
 */
export class DrawTool {
  private map: maplibregl.Map;
  private mode: Mode = null;
  private rectStart: [number, number] | null = null;
  private vertices: [number, number][] = [];
  private cursor: [number, number] | null = null;
  private onCommit: (ring: Ring) => void;
  private onDraftChange: (active: boolean) => void;

  constructor(
    map: maplibregl.Map,
    onCommit: (ring: Ring) => void,
    onDraftChange: (active: boolean) => void = () => {},
  ) {
    this.map = map;
    this.onCommit = onCommit;
    this.onDraftChange = onDraftChange;

    map.on('mousedown', this.onMouseDown);
    map.on('mousemove', this.onMouseMove);
    map.on('mouseup', this.onMouseUp);
    map.on('click', this.onClick);
    map.on('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKey);
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.reset();
    this.mode = mode;
    const container = this.map.getContainer();
    container.classList.toggle('drawing', mode !== null);
    if (mode === 'rect') this.map.dragPan.disable();
    else this.map.dragPan.enable();
    if (mode === 'polygon') this.map.doubleClickZoom.disable();
    else this.map.doubleClickZoom.enable();
  }

  dispose(): void {
    this.map.off('mousedown', this.onMouseDown);
    this.map.off('mousemove', this.onMouseMove);
    this.map.off('mouseup', this.onMouseUp);
    this.map.off('click', this.onClick);
    this.map.off('dblclick', this.onDblClick);
    window.removeEventListener('keydown', this.onKey);
  }

  private reset(): void {
    this.rectStart = null;
    this.vertices = [];
    this.cursor = null;
    this.setDraft(EMPTY);
    this.onDraftChange(false);
  }

  private onMouseDown = (e: maplibregl.MapMouseEvent): void => {
    if (this.mode !== 'rect' || e.originalEvent.button !== 0) return;
    this.rectStart = [e.lngLat.lng, e.lngLat.lat];
    this.onDraftChange(true);
  };

  private onMouseMove = (e: maplibregl.MapMouseEvent): void => {
    this.cursor = [e.lngLat.lng, e.lngLat.lat];
    if (this.mode === 'rect' && this.rectStart) {
      this.renderRect(this.rectStart, this.cursor);
    } else if (this.mode === 'polygon' && this.vertices.length > 0) {
      this.renderPolygon();
    }
  };

  private onMouseUp = (e: maplibregl.MapMouseEvent): void => {
    if (this.mode !== 'rect' || !this.rectStart) return;
    const start = this.rectStart;
    const end: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    this.rectStart = null;
    // Require a drag of at least ~12 px to avoid accidental micro-areas.
    const p1 = this.map.project(start);
    const p2 = this.map.project(end);
    if (Math.abs(p1.x - p2.x) < 12 || Math.abs(p1.y - p2.y) < 12) {
      this.reset();
      return;
    }
    const ring: Ring = [
      [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
      [Math.max(start[0], end[0]), Math.min(start[1], end[1])],
      [Math.max(start[0], end[0]), Math.max(start[1], end[1])],
      [Math.min(start[0], end[0]), Math.max(start[1], end[1])],
    ];
    this.reset();
    this.onCommit(ring);
  };

  private onClick = (e: maplibregl.MapMouseEvent): void => {
    if (this.mode !== 'polygon') return;
    const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    // Close when clicking near the first vertex.
    if (this.vertices.length >= 3) {
      const first = this.map.project(this.vertices[0]);
      const here = this.map.project(pt);
      if (Math.hypot(first.x - here.x, first.y - here.y) < 12) {
        this.commitPolygon();
        return;
      }
    }
    this.vertices.push(pt);
    this.onDraftChange(true);
    this.renderPolygon();
  };

  private onDblClick = (e: maplibregl.MapMouseEvent): void => {
    if (this.mode !== 'polygon') return;
    e.preventDefault();
    if (this.vertices.length >= 3) this.commitPolygon();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (this.mode === null) return;
    if (e.key === 'Escape') this.reset();
    if (e.key === 'Enter' && this.mode === 'polygon' && this.vertices.length >= 3) {
      this.commitPolygon();
    }
  };

  private commitPolygon(): void {
    const ring = this.vertices.slice() as Ring;
    this.reset();
    this.onCommit(ring);
  }

  private renderRect(a: [number, number], b: [number, number]): void {
    const ring = [
      [a[0], a[1]],
      [b[0], a[1]],
      [b[0], b[1]],
      [a[0], b[1]],
      [a[0], a[1]],
    ];
    this.setDraft({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
      ],
    });
  }

  private renderPolygon(): void {
    const pts = this.cursor ? [...this.vertices, this.cursor] : this.vertices;
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: pts },
      },
      ...this.vertices.map(
        (v): GeoJSON.Feature => ({
          type: 'Feature',
          properties: { vertex: 1 },
          geometry: { type: 'Point', coordinates: v },
        }),
      ),
    ];
    if (pts.length >= 3) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] },
      });
    }
    this.setDraft({ type: 'FeatureCollection', features });
  }

  private setDraft(data: DraftGeoJSON): void {
    const src = this.map.getSource('draft') as maplibregl.GeoJSONSource | undefined;
    src?.setData(data as GeoJSON.FeatureCollection);
  }
}
