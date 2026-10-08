import type * as maplibregl from 'maplibre-gl';

export const CONTEXT_LOST_TEXT = 'The map lost its graphics context. It comes back when the browser allows it.';

/**
 * When the browser takes the WebGL context away (GPU reset, too many tabs,
 * a phone in the background), MapLibre stops drawing until it is restored.
 * Say so over the map instead of leaving a frozen picture, and offer a
 * reload in case the context never comes back.
 */
export function watchContextLoss(map: Pick<maplibregl.Map, 'on' | 'off' | 'getContainer' | 'triggerRepaint'>): () => void {
  let note: HTMLDivElement | null = null;

  const onLost = () => {
    if (note) return;
    note = document.createElement('div');
    note.className = 'map-context-lost';
    note.setAttribute('role', 'status');
    Object.assign(note.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(11, 15, 20, 0.86)',
      color: '#f4f6f8',
      font: '14px system-ui, sans-serif',
      textAlign: 'center',
      padding: '24px',
      zIndex: '5',
    });
    const text = document.createElement('p');
    text.textContent = CONTEXT_LOST_TEXT;
    text.style.margin = '0';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload the page';
    reload.addEventListener('click', () => window.location.reload());
    note.append(text, reload);
    map.getContainer().append(note);
  };

  const onRestored = () => {
    note?.remove();
    note = null;
    map.triggerRepaint();
  };

  map.on('webglcontextlost', onLost);
  map.on('webglcontextrestored', onRestored);
  return () => {
    map.off('webglcontextlost', onLost);
    map.off('webglcontextrestored', onRestored);
    note?.remove();
  };
}
