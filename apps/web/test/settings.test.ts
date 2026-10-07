import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  dismissImageryNotice,
  IMAGERY_NOTICE_KEY,
  imageryNoticePending,
  loadSettings,
  migrateSettings,
  SETTINGS_KEY,
} from '../src/state/settings.js';
import { resolveImagery } from '../src/lib/imagery.js';
import { ESRI_WORLD_IMAGERY } from '@marco-polo/core';

const MAPBOX = 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=pk.secret123';
const MAPTILER = 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=abc123';

describe('settings migration', () => {
  it('runs in jsdom', () => {
    expect(typeof window).toBe('object');
    expect(typeof localStorage.setItem).toBe('function');
  });

  it('turns a Mapbox template into auto and drops the token from storage', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zoom: 18, ratePerSec: 3, providerTemplate: MAPBOX }));
    const s = loadSettings();
    expect(s.imagery).toEqual({ mode: 'auto' });
    expect(s.zoom).toBe(18);
    expect(s.ratePerSec).toBe(3);
    expect(s).not.toHaveProperty('providerTemplate');
    const stored = localStorage.getItem(SETTINGS_KEY)!;
    expect(stored).not.toContain('secret123');
    expect(stored).not.toContain('providerTemplate');
    expect(imageryNoticePending()).toBe(true);
  });

  it('migrates MapTiler and custom templates the same way', () => {
    for (const t of [MAPTILER, 'https://tiles.example.com/{z}/{x}/{y}.png']) {
      const m = migrateSettings({ providerTemplate: t });
      expect(m.droppedTemplate).toBe(true);
      expect(m.settings.imagery).toEqual({ mode: 'auto' });
    }
  });

  it('shows the note once', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ providerTemplate: MAPTILER }));
    loadSettings();
    expect(imageryNoticePending()).toBe(true);
    dismissImageryNotice();
    expect(imageryNoticePending()).toBe(false);
    loadSettings();
    expect(imageryNoticePending()).toBe(false);
    expect(localStorage.getItem(IMAGERY_NOTICE_KEY)).toBe('seen');
  });

  it('gives no note to people on the default imagery', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ providerTemplate: '', follow: false }));
    const s = loadSettings();
    expect(s.follow).toBe(false);
    expect(s.imagery).toEqual({ mode: 'auto' });
    expect(imageryNoticePending()).toBe(false);
  });

  it('keeps a valid fixed source and resets an unknown one', () => {
    const ok = migrateSettings({ imagery: { mode: 'fixed', providerId: ESRI_WORLD_IMAGERY.id } });
    expect(ok.settings.imagery).toEqual({ mode: 'fixed', providerId: ESRI_WORLD_IMAGERY.id });
    const gone = migrateSettings({ imagery: { mode: 'fixed', providerId: 'mapbox-satellite' } });
    expect(gone.settings.imagery).toEqual({ mode: 'auto' });
  });

  it('ignores values of the wrong type and garbage storage', () => {
    expect(migrateSettings({ zoom: '19', follow: 'yes' }).settings).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings(null).settings).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings([1, 2]).settings).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('resolves auto to a scannable source', () => {
    const p = resolveImagery({ mode: 'auto' });
    expect(p.scanAllowed).toBe(true);
    expect(resolveImagery({ mode: 'fixed', providerId: 'nope' })).toBe(ESRI_WORLD_IMAGERY);
  });
});
