import { ESRI_WORLD_IMAGERY, findProvider, type ImageryProvider, type ImagerySetting } from '@marco-polo/core';

/**
 * Source for the current setting. `auto` falls back to Esri until the
 * per-area picker lands; a fixed choice must still exist and be scannable.
 */
export function resolveImagery(setting: ImagerySetting): ImageryProvider {
  if (setting.mode === 'fixed') {
    const p = findProvider(setting.providerId);
    if (p?.scanAllowed) return p;
  }
  return ESRI_WORLD_IMAGERY;
}
