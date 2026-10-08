import { findProvider, type ImagerySetting, type TraversalOrder } from '@marco-polo/core';

export interface Settings {
  zoom: number;
  order: TraversalOrder;
  ratePerSec: number;
  follow: boolean;
  minConfidence: number;
  /** Hold each source to the threshold the model was calibrated to on it; off once the slider is moved. */
  recommendedScore: boolean;
  showHotTubs: boolean;
  labels: boolean;
  /** Accent colour over the dark base, hex. */
  accent: string;
  imagery: ImagerySetting;
}

export const DEFAULT_SETTINGS: Settings = {
  zoom: 19,
  order: 'serpentine',
  ratePerSec: 5,
  follow: true,
  minConfidence: 0.4,
  recommendedScore: true,
  showHotTubs: true,
  labels: true,
  accent: '#35e0ff',
  imagery: { mode: 'auto' },
};

export const SETTINGS_KEY = 'marco-polo:settings';
/** 'pending' after a migration dropped a template; 'seen' once the note was dismissed. */
export const IMAGERY_NOTICE_KEY = 'marco-polo:imagery-notice';

export const IMAGERY_NOTICE =
  'Imagery is now picked for each area. Mapbox, MapTiler and custom templates were removed.';

export interface Migration {
  settings: Settings;
  /** True when an old Mapbox, MapTiler or custom template was dropped. */
  droppedTemplate: boolean;
}

/**
 * Turn whatever is stored into current settings. Old builds kept a
 * `providerTemplate` string, sometimes with an API key inside; it is
 * dropped (never copied forward) and the choice becomes `auto`.
 */
export function migrateSettings(raw: unknown): Migration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { settings: { ...DEFAULT_SETTINGS }, droppedTemplate: false };
  }
  const { providerTemplate, imagery, ...rest } = raw as Record<string, unknown>;
  const droppedTemplate = typeof providerTemplate === 'string' && providerTemplate.trim().length > 0;
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key === 'imagery') continue;
    const v = rest[key];
    if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[key]) {
      (settings as unknown as Record<string, unknown>)[key] = v;
    }
  }
  settings.imagery = droppedTemplate ? { mode: 'auto' } : validImagery(imagery);
  return { settings, droppedTemplate };
}

function validImagery(v: unknown): ImagerySetting {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.mode === 'fixed' && typeof o.providerId === 'string') {
      const p = findProvider(o.providerId);
      if (p?.scanAllowed) return { mode: 'fixed', providerId: p.id };
    }
  }
  return { mode: 'auto' };
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read, migrate and write back, so a dropped template leaves storage at once. */
export function loadSettings(): Settings {
  const store = storage();
  if (!store) return { ...DEFAULT_SETTINGS };
  let raw: unknown = null;
  try {
    const text = store.getItem(SETTINGS_KEY);
    if (!text) return { ...DEFAULT_SETTINGS };
    raw = JSON.parse(text);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const { settings, droppedTemplate } = migrateSettings(raw);
  if (droppedTemplate) {
    try {
      store.setItem(IMAGERY_NOTICE_KEY, 'pending');
    } catch {
      // storage refused the write; the note is simply not shown
    }
  }
  persistSettings(settings);
  return settings;
}

export function persistSettings(s: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable, settings stay in this session
  }
}

export function imageryNoticePending(): boolean {
  try {
    return storage()?.getItem(IMAGERY_NOTICE_KEY) === 'pending';
  } catch {
    return false;
  }
}

export function dismissImageryNotice(): void {
  try {
    storage()?.setItem(IMAGERY_NOTICE_KEY, 'seen');
  } catch {
    // nothing to do
  }
}
