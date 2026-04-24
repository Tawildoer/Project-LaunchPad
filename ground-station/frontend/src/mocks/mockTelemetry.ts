import type { Telemetry, ConnectionStatus } from '../types'

type TelemetryCallback = (t: Telemetry) => void
type StatusCallback = (s: ConnectionStatus) => void

const CENTER_LAT = 51.505
const CENTER_LON = -0.09
const ORBIT_RADIUS_DEG = 0.002

export function createMockTelemetryEmitter(
  onTelemetry: TelemetryCallback,
  onStatus: StatusCallback,
): () => void {
  let angle = 0
  let battery = 98

  onStatus('connected')

  const interval = setInterval(() => {
    angle = (angle + 0.5) % 360
    battery = Math.max(0, battery - 0.001)

    const rad = (angle * Math.PI) / 180
    onTelemetry({
      timestamp: Date.now(),
      armed: true,
      mode: 'LOITER',
      position: {
        lat: CENTER_LAT + ORBIT_RADIUS_DEG * Math.cos(rad),
        lon: CENTER_LON + ORBIT_RADIUS_DEG * Math.sin(rad),
        alt_msl: 150,
        alt_rel: 80,
      },
      attitude: {
        roll: Math.sin(rad) * 8,
        pitch: 2,
        yaw: (angle + 90) % 360,
      },
      velocity: {
        ground_speed: 18,
        air_speed: 22,
        climb_rate: 0.1,
      },
      battery: {
        voltage: 22.2,
        current: 12.5,
        remaining_pct: Math.round(battery),
      },
      gps: {
        fix_type: 3,
        satellites_visible: 12,
      },
    })
  }, 100)

  return () => clearInterval(interval)
}
