import type { RankedDetection } from '@marco-polo/core';
import { chaikin, localMetres, THUMB_VIEW_M, type ThumbImage } from './model.js';

/**
 * A crop of the scanned imagery around one pool, always at the same ground
 * width, with the outline drawn on top. Ground the crop does not cover stays
 * neutral rather than being filled with other imagery.
 */
export function PoolThumb({
  detection,
  image,
  width,
  height = width,
  viewM = THUMB_VIEW_M,
  scaleM,
  className = '',
}: {
  detection: RankedDetection;
  image: ThumbImage | null;
  width: number;
  height?: number;
  viewM?: number;
  /** Length of a scale bar in metres; none when absent. */
  scaleM?: number;
  className?: string;
}) {
  const s = width / viewM;
  const toM = localMetres(detection.center);
  const toPx = (lon: number, lat: number): [number, number] => {
    const [mx, my] = toM(lon, lat);
    return [width / 2 + mx * s, height / 2 + my * s];
  };

  let img = null;
  if (image) {
    const [x0, y0] = toPx(image.bbox.west, image.bbox.north);
    const [x1, y1] = toPx(image.bbox.east, image.bbox.south);
    img = (
      <img
        src={image.url}
        alt=""
        draggable={false}
        style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}
      />
    );
  }

  const small = width < 80;
  const paths = detection.outline.map((ring) => {
    const pts = chaikin(ring.map(([lon, lat]) => toPx(lon, lat)));
    return pts.length ? `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z` : '';
  });

  return (
    <span className={`thumb ${className}`} style={{ width, height }}>
      {img}
      <svg className="thumb-outline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {paths.map((d, i) => (
          <path key={`c${i}`} d={d} className="casing" strokeWidth={small ? 2.4 : 3} />
        ))}
        {paths.map((d, i) => (
          <path key={`p${i}`} d={d} className="pool-line" strokeWidth={small ? 1.2 : 1.4} />
        ))}
      </svg>
      {scaleM != null && (
        <span className="mini-scale" aria-hidden="true">
          {scaleM} m
          <i style={{ width: Math.round(scaleM * s) }} />
        </span>
      )}
    </span>
  );
}
