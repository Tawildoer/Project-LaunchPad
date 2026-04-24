import type { Telemetry, ConnectionStatus } from '../types'
import { demoState } from './demoState'

type TelemetryCallback = (t: Telemetry) => void
type StatusCallback   = (s: ConnectionStatus) => void

const CENTER_LAT = -37.854   // Glen Iris, Melbourne, Australia
const CENTER_LON = 145.059
const ORBIT_RADIUS_M = 220   // default orbit when no path
const SPEED_MS = 18          // m/s along path
const TICK_MS  = 100         // update interval

// Haversine-free flat-earth distance (fine for ~10km scale)
function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const cosLat = Math.cos(a.lat * Math.PI / 180)
  const dx = (b.lon - a.lon) * cosLat * 111320
  const dy = (b.lat - a.lat) * 111320
  return Math.sqrt(dx * dx + dy * dy)
}

// Interpolate position that is `d` metres along the polyline
function posAtDistance(path: { lat: number; lon: number }[], d: number): { lat: number; lon: number } {
  let acc = 0
  for (let i = 0; i < path.length - 1; i++) {
    const seg = distM(path[i], path[i + 1])
    if (acc + seg >= d) {
      const frac = seg > 0 ? (d - acc) / seg : 0
      return {
        lat: path[i].lat + frac * (path[i + 1].lat - path[i].lat),
        lon: path[i].lon + frac * (path[i + 1].lon - path[i].lon),
      }
    }
    acc += seg
  }
  return path[path.length - 1]
}

// Total polyline length in metres
function pathLength(path: { lat: number; lon: number }[]): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i++) total += distM(path[i], path[i + 1])
  return total
}

export function createMockTelemetryEmitter(
  onTelemetry: TelemetryCallback,
  onStatus: StatusCallback,
): () => void {
  let orbitAngle = 0
  let battery    = 98

  // Path-following state
  let seenVersion    = -1   // last demoState.version we processed
  let activePath: { lat: number; lon: number }[] = []
  let activeLength   = 0
  let traveledM      = 0
  let curLat         = CENTER_LAT
  let curLon         = CENTER_LON

  onStatus('connected')

  const interval = setInterval(() => {
    battery = Math.max(0, battery - 0.001)

    const { path, version } = demoState

    if (path.length > 1) {
      // Path updated — prepend current position so the drone glides to the start
      if (version !== seenVersion) {
        seenVersion  = version
        activePath   = [{ lat: curLat, lon: curLon }, ...path]
        activeLength = pathLength(activePath)
        traveledM    = 0
      }

      traveledM += SPEED_MS * (TICK_MS / 1000)
      // Loop: the last POI is a continuous orbit so the path never truly ends,
      // but clamp just in case
      if (traveledM >= activeLength) traveledM = activeLength

      const pos = posAtDistance(activePath, traveledM)
      curLat = pos.lat
      curLon = pos.lon

      // Yaw: bearing to next point for realism
      const aheadPos = posAtDistance(activePath, Math.min(traveledM + 5, activeLength))
      const dLon = aheadPos.lon - curLon
      const dLat = aheadPos.lat - curLat
      const yaw = ((Math.atan2(dLon, dLat) * 180 / Math.PI) + 360) % 360

      onTelemetry({
        timestamp: Date.now(),
        armed: true,
        mode: 'AUTO',
        position: { lat: curLat, lon: curLon, alt_msl: 150, alt_rel: 80 },
        attitude: { roll: 8, pitch: 2, yaw },
        velocity: { ground_speed: SPEED_MS, air_speed: SPEED_MS + 4, climb_rate: 0 },
        battery: { voltage: 22.2, current: 12.5, remaining_pct: Math.round(battery) },
        gps: { fix_type: 3, satellites_visible: 12 },
      })
    } else {
      // No path — orbit the centre
      if (seenVersion !== version) {
        seenVersion = version
        activePath  = []
      }

      orbitAngle = (orbitAngle + 0.5) % 360
      const rad = (orbitAngle * Math.PI) / 180
      const rlat = ORBIT_RADIUS_M / 111320
      const rlon = ORBIT_RADIUS_M / (111320 * Math.cos(CENTER_LAT * Math.PI / 180))
      curLat = CENTER_LAT + rlat * Math.cos(rad)
      curLon = CENTER_LON + rlon * Math.sin(rad)

      onTelemetry({
        timestamp: Date.now(),
        armed: true,
        mode: 'LOITER',
        position: { lat: curLat, lon: curLon, alt_msl: 150, alt_rel: 80 },
        attitude: { roll: Math.sin(rad) * 8, pitch: 2, yaw: (orbitAngle + 90) % 360 },
        velocity: { ground_speed: 18, air_speed: 22, climb_rate: 0.1 },
        battery: { voltage: 22.2, current: 12.5, remaining_pct: Math.round(battery) },
        gps: { fix_type: 3, satellites_visible: 12 },
      })
    }
  }, TICK_MS)

  return () => clearInterval(interval)
}
