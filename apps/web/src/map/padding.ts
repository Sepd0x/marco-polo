/**
 * Map padding that keeps a framed area clear of the panels floating over the
 * map. Panels mark themselves with `data-map-occluder`.
 */
export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function occluderPadding(container: HTMLElement, margin: number, root: ParentNode = document): Padding {
  const pad: Padding = { top: margin, bottom: margin, left: margin, right: margin };
  const box = container.getBoundingClientRect();
  const w = box.width;
  const h = box.height;
  if (w <= 0 || h <= 0) return pad;
  for (const el of root.querySelectorAll<HTMLElement>('[data-map-occluder]')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    // A panel pads the side it takes the least from: a sidebar its side, a top bar the top.
    const reach = {
      left: r.right - box.left,
      right: box.right - r.left,
      top: r.bottom - box.top,
      bottom: box.bottom - r.top,
    };
    const side = (Object.keys(reach) as (keyof Padding)[]).reduce((a, b) => (reach[b] < reach[a] ? b : a));
    pad[side] = Math.max(pad[side], reach[side] + margin);
  }
  // Never pad away more than 60% of either axis; a small screen still shows the area.
  const fit = (a: number, b: number, size: number): [number, number] => {
    const max = size * 0.6;
    if (a + b <= max) return [a, b];
    const k = max / (a + b);
    return [a * k, b * k];
  };
  [pad.left, pad.right] = fit(pad.left, pad.right, w);
  [pad.top, pad.bottom] = fit(pad.top, pad.bottom, h);
  return pad;
}

/** The panels over the map as rectangles in container px; the numbers on the map keep off them. */
export function occluderRects(container: HTMLElement, root: ParentNode = document): { left: number; top: number; right: number; bottom: number }[] {
  const box = container.getBoundingClientRect();
  const out: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-map-occluder]')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const rect = { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top };
    // Only what lies over the map; a strip under it covers nothing.
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= box.width || rect.top >= box.height) continue;
    out.push(rect);
  }
  return out;
}
