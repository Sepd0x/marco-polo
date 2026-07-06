/** Minimal typed event bus for UI → map commands that don't belong in the store. */

export interface FlyToEvent {
  bbox?: [number, number, number, number]; // west, south, east, north
  center?: [number, number]; // lon, lat
  zoom?: number;
}

type Events = {
  flyto: FlyToEvent;
  cursor: { lon: number; lat: number };
};

type Handler<T> = (payload: T) => void;

const handlers = new Map<string, Set<Handler<never>>>();

export function on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as Handler<never>);
  return () => set!.delete(handler as Handler<never>);
}

export function emit<K extends keyof Events>(event: K, payload: Events[K]): void {
  const set = handlers.get(event);
  if (set) for (const h of set) (h as Handler<Events[K]>)(payload);
}
