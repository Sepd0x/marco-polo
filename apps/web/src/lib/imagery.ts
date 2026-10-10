import { ESRI_WORLD_IMAGERY, findProvider, type ImageryProvider, type ImagerySetting } from '@marco-polo/core';

/**
 * Source the map shows before an area is drawn: Esri for `auto`, or the fixed
 * choice when it exists and can be scanned.
 */
export function resolveImagery(setting: ImagerySetting): ImageryProvider {
  if (setting.mode === 'fixed') {
    const p = findProvider(setting.providerId);
    if (p?.scanAllowed) return p;
  }
  return ESRI_WORLD_IMAGERY;
}
