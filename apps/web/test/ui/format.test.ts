import { describe, expect, it } from 'vitest';
import {
  formatArea,
  formatPoolArea,
  formatCaptureDate,
  formatDims,
  formatDuration,
  formatLandArea,
  formatLength,
  formatResolution,
  formatScore,
  formatTimeLeft,
} from '../../src/lib/format.js';
import { googleMapsUrl } from '../../src/lib/links.js';

describe('format', () => {
  it('writes pool areas in square metres', () => {
    expect(formatArea(100)).toBe('100 m²');
    expect(formatArea(1367.4)).toBe('1,367 m²');
    expect(formatArea(8.46)).toBe('8.5 m²');
    expect(formatArea(0)).toBe('0 m²');
  });

  it('writes one pool to a tenth, so the list column lines up', () => {
    expect(formatPoolArea(92.46)).toBe('92.5 m²');
    expect(formatPoolArea(9.7)).toBe('9.7 m²');
    expect(formatPoolArea(1367.44)).toBe('1,367.4 m²');
  });

  it('writes the drawn area in hectares or square kilometres', () => {
    expect(formatLandArea(131_000)).toBe('13.1 ha');
    expect(formatLandArea(2_350_000)).toBe('2.35 km²');
    expect(formatLandArea(211_296_480_000)).toBe('211,296 km²');
  });

  it('writes ground lengths in metres, then kilometres', () => {
    expect(formatLength(64.4)).toBe('64 m');
    expect(formatLength(2345)).toBe('2.35 km');
    expect(formatLength(505_340)).toBe('505 km');
  });

  it('gives measured sizes from the outline and says when there is none', () => {
    expect(formatDims({ lengthM: 10.46, widthM: 5.5, angleDeg: 30 })).toBe('10.5 × 5.5 m');
    expect(formatDims(null)).toBe('Size not measured');
  });

  it('never shows the score as a percentage', () => {
    expect(formatScore(0.955)).toBe('0.95');
    expect(formatScore(0.5)).toBe('0.50');
  });

  it('writes durations and time left in words people use', () => {
    expect(formatDuration(9000)).toBe('9 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatDuration(3_840_000)).toBe('1 h 4 min');
    expect(formatTimeLeft(3200)).toBe('About 3 s left');
    expect(formatTimeLeft(240_000)).toBe('About 4 min left');
    expect(formatTimeLeft(null)).toBe('Working out the time left');
  });

  it('writes resolution and capture dates', () => {
    expect(formatResolution(0.25)).toBe('25 cm');
    expect(formatResolution(null)).toBeNull();
    expect(formatCaptureDate('2025')).toBe('2025');
    expect(formatCaptureDate('2023-09')).toBe('Sep 2023');
  });
});

describe('Google Maps link', () => {
  it('uses the Maps URLs search format with six decimals', () => {
    const url = googleMapsUrl(37.0819712345, -8.109254321);
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=37.081971%2C-8.109254');
    const q = new URL(url).searchParams;
    expect(q.get('api')).toBe('1');
    expect(q.get('query')).toBe('37.081971,-8.109254');
  });
});
