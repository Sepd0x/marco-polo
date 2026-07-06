export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
}

export function bingMapsUrl(lat: number, lon: number): string {
  return `https://www.bing.com/maps?cp=${lat.toFixed(6)}~${lon.toFixed(6)}&lvl=19&style=a`;
}

export function osmUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=19/${lat.toFixed(6)}/${lon.toFixed(6)}`;
}
