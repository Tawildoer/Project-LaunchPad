export interface LatLon {
  lat: number
  lon: number
  poiId?: string | null
}

export interface POIPath {
  lat: number
  lon: number
  loiter_radius: number
  id?: string
}

/**
 * arcMode controls the orbit direction and tangent geometry:
 *   'cw'   / 'short' — RHS external tangent + CW arcs (ArduPilot default)
 *   'ccw'  / 'long'  — LHS external tangent + CCW arcs
 *
 * RHS and LHS arc spans at any intermediate circle sum to exactly 360°, so
 * 'long' always produces the complementary (larger) arc compared to 'cw'.
 * The path is smooth (tangent) at every transition point in both modes.
 */
export type ArcMode = 'cw' | 'ccw' | 'short' | 'long'

function normDeg(a: number): number {
  return ((a % 360) + 360) % 360
}

function pointOnCircle(center: LatLon, radiusMeters: number, angleDeg: number): LatLon {
  const rlat = radiusMeters / 111320
  const rlon = radiusMeters / (111320 * Math.cos((center.lat * Math.PI) / 180))
  const rad = (angleDeg * Math.PI) / 180
  return {
    lat: center.lat + rlat * Math.sin(rad),
    lon: center.lon + rlon * Math.cos(rad),
  }
}

function distanceMeters(a: LatLon, b: LatLon): number {
  const cosLat = Math.cos(a.lat * Math.PI / 180)
  const dx = (b.lon - a.lon) * cosLat * 111320
  const dy = (b.lat - a.lat) * 111320
  return Math.sqrt(dx * dx + dy * dy)
}

function mathBearingDeg(from: LatLon, to: LatLon): number {
  const cosLat = Math.cos(from.lat * Math.PI / 180)
  return Math.atan2(to.lat - from.lat, (to.lon - from.lon) * cosLat) * (180 / Math.PI)
}

// CW arc: decreasing angle (clockwise on map)
function cwArc(center: LatLon, r: number, start: number, end: number, n: number): LatLon[] {
  const s = normDeg(start)
  const e = normDeg(end)
  const span = s >= e ? s - e : s + 360 - e
  return Array.from({ length: n + 1 }, (_, i) => pointOnCircle(center, r, s - (span * i) / n))
}

// CCW arc: increasing angle (counter-clockwise on map)
function ccwArc(center: LatLon, r: number, start: number, end: number, n: number): LatLon[] {
  const s = normDeg(start)
  const e = normDeg(end)
  const span = e >= s ? e - s : e + 360 - s
  return Array.from({ length: n + 1 }, (_, i) => pointOnCircle(center, r, s + (span * i) / n))
}

/**
 * RHS external tangent: circles to the RIGHT of the flight path.
 * Drone orbits CW. Touch-point angle = bearing + α + 90°.
 */
function rhsTangentAngle(c1: LatLon, r1: number, c2: LatLon, r2: number): number {
  const d = distanceMeters(c1, c2)
  if (d < 1) return 0
  const theta = mathBearingDeg(c1, c2)
  const alphaDeg = Math.asin(Math.max(-1, Math.min(1, (r1 - r2) / d))) * (180 / Math.PI)
  return normDeg(theta + alphaDeg + 90)
}

/**
 * LHS external tangent: circles to the LEFT of the flight path.
 * Drone orbits CCW. Touch-point angle = bearing + α - 90°.
 *
 * The RHS and LHS touch-point angles at any intermediate circle are exactly 180°
 * apart, so RHS CW arc span + LHS CCW arc span = 360° at every waypoint.
 * This makes 'long' (LHS/CCW) always the geometric complement of 'cw' (RHS/CW).
 */
function lhsTangentAngle(c1: LatLon, r1: number, c2: LatLon, r2: number): number {
  const d = distanceMeters(c1, c2)
  if (d < 1) return 0
  const theta = mathBearingDeg(c1, c2)
  const alphaDeg = Math.asin(Math.max(-1, Math.min(1, (r1 - r2) / d))) * (180 / Math.PI)
  return normDeg(theta + alphaDeg - 90)
}

export function approachEntryAngle(
  drone: LatLon,
  center: LatLon,
  radius: number,
  arcMode: ArcMode,
): number | undefined {
  const d = distanceMeters(drone, center)
  if (d <= radius) return undefined

  const theta = mathBearingDeg(center, drone)
  const beta = Math.acos(Math.min(1, radius / d)) * (180 / Math.PI)

  const useCW = arcMode === 'cw' || arcMode === 'short'
  return normDeg(useCW ? theta - beta : theta + beta)
}

export function buildMissionPath(pois: POIPath[], arcMode: ArcMode = 'cw', entryAngle?: number): LatLon[] {
  if (pois.length === 0) return []

  const S = 128  // arc samples
  const result: LatLon[] = []
  const useLHS = arcMode === 'ccw' || arcMode === 'long'
  const tangFn = useLHS ? lhsTangentAngle : rhsTangentAngle
  const arcFn  = useLHS ? ccwArc : cwArc
  const loopDir = useLHS ? 1 : -1  // +1 = CCW (increasing angle), -1 = CW

  const tag = (pts: LatLon[], poiId: string | null): LatLon[] =>
    pts.map(p => ({ ...p, poiId }))

  if (pois.length === 1) {
    const c: LatLon = { lat: pois[0].lat, lon: pois[0].lon }
    const N = S * 2
    const startAngle = entryAngle !== undefined ? entryAngle : 90
    for (let k = 0; k <= N; k++) {
      result.push({ ...pointOnCircle(c, pois[0].loiter_radius, startAngle + loopDir * (360 * k) / N), poiId: pois[0].id ?? null })
    }
    return result
  }

  const tangAngles = pois.slice(0, -1).map((poi, i) =>
    tangFn(
      { lat: poi.lat, lon: poi.lon }, poi.loiter_radius,
      { lat: pois[i + 1].lat, lon: pois[i + 1].lon }, pois[i + 1].loiter_radius,
    ),
  )

  const c0: LatLon = { lat: pois[0].lat, lon: pois[0].lon }
  const firstArcStart = entryAngle !== undefined ? entryAngle : normDeg(tangAngles[0] + 180)
  result.push(...tag(arcFn(c0, pois[0].loiter_radius, firstArcStart, tangAngles[0], S), pois[0].id ?? null))

  for (let i = 1; i < pois.length; i++) {
    const center: LatLon = { lat: pois[i].lat, lon: pois[i].lon }
    const arrival = tangAngles[i - 1]

    const prev = result[result.length - 1]
    const next = pointOnCircle(center, pois[i].loiter_radius, arrival)
    const tangentLen = distanceMeters(prev, next)
    const SPACING = 15
    const steps = Math.max(1, Math.floor(tangentLen / SPACING))
    for (let s = 1; s < steps; s++) {
      const f = s / steps
      result.push({ lat: prev.lat + f * (next.lat - prev.lat), lon: prev.lon + f * (next.lon - prev.lon), poiId: null })
    }

    if (i === pois.length - 1) {
      const N = S * 2
      for (let k = 0; k <= N; k++) {
        result.push({ ...pointOnCircle(center, pois[i].loiter_radius, arrival + loopDir * (360 * k) / N), poiId: pois[i].id ?? null })
      }
    } else {
      result.push(...tag(arcFn(center, pois[i].loiter_radius, arrival, tangAngles[i], S), pois[i].id ?? null))
    }
  }

  return result
}

// Kept for tests — use buildMissionPath for mission visualization
export function catmullRomSpline(points: LatLon[], samplesPerSegment: number): LatLon[] {
  if (points.length < 2) return []
  const pts = [points[0], ...points, points[points.length - 1]]
  const result: LatLon[] = []
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2]
    for (let s = 0; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment, t2 = t * t, t3 = t2 * t
      result.push({
        lat: 0.5 * (2*p1.lat + (-p0.lat+p2.lat)*t + (2*p0.lat-5*p1.lat+4*p2.lat-p3.lat)*t2 + (-p0.lat+3*p1.lat-3*p2.lat+p3.lat)*t3),
        lon: 0.5 * (2*p1.lon + (-p0.lon+p2.lon)*t + (2*p0.lon-5*p1.lon+4*p2.lon-p3.lon)*t2 + (-p0.lon+3*p1.lon-3*p2.lon+p3.lon)*t3),
      })
    }
  }
  return result
}
