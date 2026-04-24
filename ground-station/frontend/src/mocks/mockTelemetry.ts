import type { Telemetry, ConnectionStatus } from '../types'
import { demoState } from './demoState'

type TelemetryCallback = (t: Telemetry) => void
type StatusCallback   = (s: ConnectionStatus) => void

const CENTER_LAT = -37.854
const CENTER_LON = 145.059
const ORBIT_RADIUS_M = 220
const TICK_MS = 100

function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const cosLat = Math.cos(a.lat * Math.PI / 180)
  const dx = (b.lon - a.lon) * cosLat * 111320
  const dy = (b.lat - a.lat) * 111320
  return Math.sqrt(dx * dx + dy * dy)
}

function posAtDistance(
  path: { lat: number; lon: number }[],
  d: number,
): { lat: number; lon: number } {
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
  let seenVersion  = -1
  let activePath: { lat: number; lon: number }[] = []
  let activeLength = 0
  let traveledM    = 0
  let curLat       = CENTER_LAT
  let curLon       = CENTER_LON

  // Wind perturbation state (2D drift in N/E metres)
  let windAngle       = Math.random() * 360
  let windOffsetNorth = 0
  let windOffsetEast  = 0

  onStatus('connected')

  const interval = setInterval(() => {
    battery = Math.max(0, battery - 0.001)

    const { path, version, windStrength } = demoState
    const speedMs = Math.max(1, demoState.speedMs)

    if (path.length > 1) {
      if (version !== seenVersion) {
        seenVersion  = version
        activePath   = [{ lat: curLat, lon: curLon }, ...path]
        activeLength = pathLength(activePath)
        traveledM    = 0
      }

      traveledM = Math.min(traveledM + speedMs * (TICK_MS / 1000), activeLength)

      const pos = posAtDistance(activePath, traveledM)
      curLat = pos.lat
      curLon = pos.lon

      const aheadPos = posAtDistance(activePath, Math.min(traveledM + 5, activeLength))
      const yaw = ((Math.atan2(aheadPos.lon - curLon, aheadPos.lat - curLat) * 180 / Math.PI) + 360) % 360

      // Apply wind perturbation
      windAngle += (Math.random() - 0.5) * 15
      if (windStrength > 0) {
        const rad = windAngle * Math.PI / 180
        const force = windStrength * (TICK_MS / 1000)
        windOffsetNorth = windOffsetNorth * 0.92 + force * Math.sin(rad)
        windOffsetEast  = windOffsetEast  * 0.92 + force * Math.cos(rad)
      } else {
        windOffsetNorth *= 0.85
        windOffsetEast  *= 0.85
      }

      const cosLat = Math.cos(curLat * Math.PI / 180)
      const emitLat = curLat + windOffsetNorth / 111320
      const emitLon = curLon + windOffsetEast  / (111320 * cosLat)

      onTelemetry({
        timestamp: Date.now(),
        armed: true,
        mode: traveledM < activeLength ? 'AUTO' : 'LOITER',
        position: { lat: emitLat, lon: emitLon, alt_msl: 150, alt_rel: 80 },
        attitude: { roll: 8, pitch: 2, yaw },
        velocity: { ground_speed: speedMs, air_speed: speedMs + 4, climb_rate: 0 },
        battery: { voltage: 22.2, current: 12.5, remaining_pct: Math.round(battery) },
        gps: { fix_type: 3, satellites_visible: 12 },
      })
    } else {
      if (seenVersion !== version) {
        seenVersion = version
        activePath  = []
      }

      orbitAngle = (orbitAngle + (demoState.speedMs / 18) * 0.5) % 360
      const rad  = (orbitAngle * Math.PI) / 180
      const rlat = ORBIT_RADIUS_M / 111320
      const rlon = ORBIT_RADIUS_M / (111320 * Math.cos(CENTER_LAT * Math.PI / 180))
      curLat = CENTER_LAT + rlat * Math.cos(rad)
      curLon = CENTER_LON + rlon * Math.sin(rad)

      windAngle += (Math.random() - 0.5) * 15
      if (windStrength > 0) {
        const wrad  = windAngle * Math.PI / 180
        const force = windStrength * (TICK_MS / 1000)
        windOffsetNorth = windOffsetNorth * 0.92 + force * Math.sin(wrad)
        windOffsetEast  = windOffsetEast  * 0.92 + force * Math.cos(wrad)
      } else {
        windOffsetNorth *= 0.85
        windOffsetEast  *= 0.85
      }

      const cosLat  = Math.cos(curLat * Math.PI / 180)
      const emitLat = curLat + windOffsetNorth / 111320
      const emitLon = curLon + windOffsetEast  / (111320 * cosLat)

      onTelemetry({
        timestamp: Date.now(),
        armed: true,
        mode: 'LOITER',
        position: { lat: emitLat, lon: emitLon, alt_msl: 150, alt_rel: 80 },
        attitude: { roll: Math.sin(rad) * 8, pitch: 2, yaw: (orbitAngle + 90) % 360 },
        velocity: { ground_speed: demoState.speedMs, air_speed: demoState.speedMs + 4, climb_rate: 0.1 },
        battery: { voltage: 22.2, current: 12.5, remaining_pct: Math.round(battery) },
        gps: { fix_type: 3, satellites_visible: 12 },
      })
    }
  }, TICK_MS)

  return () => clearInterval(interval)
}
