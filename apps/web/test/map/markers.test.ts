import { describe, expect, it } from 'vitest';
import { BOX_FROM_ZOOM, HALO_FROM, labelImageId, labelStyle, RANK_MIN_ZOOM } from '../../src/map/markers.js';

describe('pool labels', () => {
  it('boxes the numbers below 30 pools and keeps a halo from 30 on', () => {
    expect(HALO_FROM).toBe(30);
    expect(labelStyle(29, false)).toBe('box');
    expect(labelStyle(30, false)).toBe('halo');
    expect(labelStyle(500, false)).toBe('halo');
  });

  it('always boxes the open pool in the accent', () => {
    expect(labelStyle(5, true)).toBe('open');
    expect(labelStyle(50, true)).toBe('open');
  });

  it('shows bare numbers from zoom 15 and boxes from 17, where a box no longer covers a pool', () => {
    expect(RANK_MIN_ZOOM).toBe(15);
    expect(BOX_FROM_ZOOM).toBe(17);
  });

  it('names one image per style and rank', () => {
    expect(labelImageId('halo', 12)).toBe('rank:halo:12');
    expect(labelImageId('open', 1)).not.toBe(labelImageId('box', 1));
  });
});
