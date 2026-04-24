export interface LatLon {
  lat: number
  lon: number
}

/**
 * Generates a Catmull-Rom spline through the given points.
 * Returns an array of interpolated LatLon points.
 * samplesPerSegment controls curve smoothness.
 */
export function catmullRomSpline(
  points: LatLon[],
  samplesPerSegment: number,
): LatLon[] {
  if (points.length < 2) return []

  // Extend with phantom points at each end so the curve passes through all real points
  const pts = [points[0], ...points, points[points.length - 1]]
  const result: LatLon[] = []

  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2]

    for (let s = 0; s <= samplesPerSegment; s++) {
      const t  = s / samplesPerSegment
      const t2 = t * t
      const t3 = t2 * t

      const lat =
        0.5 *
        (2 * p1.lat +
          (-p0.lat + p2.lat) * t +
          (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
          (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3)
      const lon =
        0.5 *
        (2 * p1.lon +
          (-p0.lon + p2.lon) * t +
          (2 * p0.lon - 5 * p1.lon + 4 * p2.lon - p3.lon) * t2 +
          (-p0.lon + 3 * p1.lon - 3 * p2.lon + p3.lon) * t3)

      result.push({ lat, lon })
    }
  }

  return result
}
