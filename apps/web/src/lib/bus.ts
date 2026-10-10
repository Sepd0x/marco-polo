/** Minimal typed event bus for UI to map commands that don't belong in the store. */

export interface FlyToEvent {
  bbox?: [number, number, number, number]; // west, south, east, north
  center?: [number, number]; // lon, lat
  zoom?: number;
}

type Events = {
  flyto: FlyToEvent;
  /** Zoom the map in (positive) or out (negative) by this many levels. */
  zoomby: { delta: number };
  /** The pointer over the map, or null once it leaves. */
  cursor: { lon: number; lat: number } | null;
  /** The camera while it moves, for the scale. */
  camera: { zoom: number; lat: number };
  /** The shape being drawn: size of a rectangle in metres, and its area; null when no draft. */
  draft: { widthM: number | null; heightM: number | null; areaM2: number } | null;
  /** The imagery the map shows outside any area, by provider id. */
  basesource: { id: string };
  /** The element the map's credits go in, or null when it leaves the page. */
  attribslot: { el: HTMLElement | null };
  /** The map finished loading and its store subscriptions are in place. */
  mapready: Record<string, never>;
  /** The map view after it settles: west, south, east, north, and the zoom. */
  view: { bbox: [number, number, number, number]; zoom: number };
};

/** Events a late subscriber still receives: their last payload is replayed. */
const STICKY: ReadonlySet<keyof Events> = new Set(['mapready', 'camera', 'basesource', 'attribslot']);

type Handler<T> = (payload: T) => void;

const handlers = new Map<string, Set<Handler<never>>>();
const last = new Map<string, unknown>();

export function on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as Handler<never>);
  if (STICKY.has(event) && last.has(event)) handler(last.get(event) as Events[K]);
  return () => set!.delete(handler as Handler<never>);
}

export function emit<K extends keyof Events>(event: K, payload: Events[K]): void {
  if (STICKY.has(event)) last.set(event, payload);
  const set = handlers.get(event);
  if (set) for (const h of [...set]) (h as Handler<Events[K]>)(payload);
}

/** Forget sticky payloads (a map was torn down; tests). */
export function resetSticky(event?: keyof Events): void {
  if (event) last.delete(event);
  else last.clear();
}
