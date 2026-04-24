import type { LatLon } from '../lib/pathPlanning'

// Shared mutable state between DemoController (MissionContext subscriber)
// and the mock telemetry emitter (which can't use React hooks).
export const demoState: {
  path: LatLon[]
  version: number
  speedMs: number
  windStrength: number
  firstPoi: { lat: number; lon: number; loiter_radius: number } | null
} = {
  path: [],
  version: 0,
  speedMs: 18,
  windStrength: 0,
  firstPoi: null,
}
