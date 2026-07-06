/**
 * Browser-side tile fetching with a persistent Cache API layer.
 * Re-running a scan over the same area hits the local cache instead of the
 * imagery provider — polite to the provider, instant for the user.
 */

const CACHE_NAME = 'marco-polo-tiles-v1';

let cachePromise: Promise<Cache | null> | null = null;

function getCache(): Promise<Cache | null> {
  if (!cachePromise) {
    cachePromise =
      typeof caches !== 'undefined'
        ? caches.open(CACHE_NAME).catch(() => null)
        : Promise.resolve(null);
  }
  return cachePromise;
}

export async function fetchTileBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const cache = await getCache();
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.blob();
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal, mode: 'cors' });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new FatalTileError(`HTTP ${res.status}`);
      if (cache) {
        try {
          await cache.put(url, res.clone());
        } catch {
          // storage quota — carry on uncached
        }
      }
      return await res.blob();
    } catch (err) {
      if (err instanceof FatalTileError) throw err;
      if (signal?.aborted) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 200));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export class FatalTileError extends Error {}

export async function clearTileCache(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
  cachePromise = null;
}
