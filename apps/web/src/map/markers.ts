import maplibregl from 'maplibre-gl';
import type { RankedDetection } from '@marco-polo/core';

/** Cap on DOM markers to keep the map fluid on huge result sets. */
const MARKER_LIMIT = 250;

/**
 * DOM markers for detections: a glowing core, a one-shot radar ping on first
 * appearance, and a live rank chip that re-numbers as the ranking shifts.
 */
export class DetectionMarkers {
  private map: maplibregl.Map;
  private markers = new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>();
  private onSelect: (id: string) => void;

  constructor(map: maplibregl.Map, onSelect: (id: string) => void) {
    this.map = map;
    this.onSelect = onSelect;
  }

  sync(list: RankedDetection[], selectedId: string | null): void {
    const visible = list.slice(0, MARKER_LIMIT);
    const keep = new Set(visible.map((d) => d.id));

    for (const [id, entry] of this.markers) {
      if (!keep.has(id)) {
        entry.marker.remove();
        this.markers.delete(id);
      }
    }

    for (const d of visible) {
      let entry = this.markers.get(d.id);
      if (!entry) {
        const el = document.createElement('div');
        el.className = `det-marker ${d.kind}`;
        el.innerHTML = `<div class="ping"></div><div class="core"></div><div class="rank-chip"></div>`;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.onSelect(d.id);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([d.center.lon, d.center.lat])
          .addTo(this.map);
        entry = { marker, el };
        this.markers.set(d.id, entry);
      } else {
        entry.marker.setLngLat([d.center.lon, d.center.lat]);
      }
      // classList only — assigning className would strip the maplibregl-marker
      // class and with it the absolute positioning markers rely on.
      entry.el.classList.toggle('hot_tub', d.kind === 'hot_tub');
      entry.el.classList.toggle('pool', d.kind === 'pool');
      entry.el.classList.toggle('selected', d.id === selectedId);
      const chip = entry.el.querySelector('.rank-chip') as HTMLDivElement;
      if (chip) chip.textContent = `#${d.rank}`;
    }
  }

  clear(): void {
    for (const { marker } of this.markers.values()) marker.remove();
    this.markers.clear();
  }
}
