import { describe, expect, it } from 'vitest';
import { HALO_FROM, labelImageId, labelStyle } from '../../src/map/markers.js';

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

  it('names one image per style and rank', () => {
    expect(labelImageId('halo', 12)).toBe('rank:halo:12');
    expect(labelImageId('open', 1)).not.toBe(labelImageId('box', 1));
  });
});
