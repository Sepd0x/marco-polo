/** Minimal typed event bus for UI to map commands that don't belong in the store. */

export interface FlyToEvent {
  bbox?: [number, number, number, number]; // west, south, east, north
  center?: [number, number]; // lon, lat
  zoom?: number;
}

type Events = {
  flyto: FlyToEvent;
  cursor: { lon: number; lat: number };
  /** The map finished loading and its store subscriptions are in place. */
  mapready: Record<string, never>;
};

/** Events a late subscriber still receives: their last payload is replayed. */
const STICKY: ReadonlySet<keyof Events> = new Set(['mapready']);

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
