import { describe, expect, it } from 'vitest';
import { occluderPadding, occluderRects } from '../../src/map/padding.js';

function box(el: HTMLElement, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

describe('occluderPadding', () => {
  it('pads the side each panel sits against', () => {
    document.body.innerHTML = '<div id="map"></div><aside data-map-occluder id="r"></aside><header data-map-occluder id="t"></header>';
    const map = document.getElementById('map')!;
    box(map, 0, 0, 1280, 800);
    box(document.getElementById('r')!, 900, 80, 360, 600);
    box(document.getElementById('t')!, 0, 0, 1280, 56);
    expect(occluderPadding(map, 40)).toEqual({ top: 96, bottom: 40, left: 40, right: 420 });
  });

  it('never pads away more than 60% of the width', () => {
    document.body.innerHTML = '<div id="map"></div><aside data-map-occluder id="r"></aside>';
    const map = document.getElementById('map')!;
    box(map, 0, 0, 375, 812);
    box(document.getElementById('r')!, 75, 100, 300, 400);
    const p = occluderPadding(map, 20);
    expect(p.left + p.right).toBeCloseTo(375 * 0.6, 6);
  });

  it('with no panels, the margin all round', () => {
    document.body.innerHTML = '<div id="map"></div>';
    const map = document.getElementById('map')!;
    box(map, 0, 0, 800, 600);
    expect(occluderPadding(map, 30)).toEqual({ top: 30, bottom: 30, left: 30, right: 30 });
  });
});

describe('occluderRects', () => {
  it('gives the panels over the map in container px, and leaves out a strip under it', () => {
    document.body.innerHTML = '<div id="map"></div><div data-map-occluder id="tools"></div><div data-map-occluder id="strip"></div><div data-map-occluder id="gone"></div>';
    const map = document.getElementById('map')!;
    box(map, 430, 30, 820, 700);
    box(document.getElementById('tools')!, 442, 42, 32, 120);
    box(document.getElementById('strip')!, 430, 730, 820, 22);
    box(document.getElementById('gone')!, 0, 0, 0, 0);
    expect(occluderRects(map)).toEqual([{ left: 12, top: 12, right: 44, bottom: 132 }]);
  });
});
