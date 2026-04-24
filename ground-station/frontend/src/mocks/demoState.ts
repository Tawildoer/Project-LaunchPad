import type { LatLon } from '../lib/pathPlanning'

// Shared mutable state between DemoController (MissionContext subscriber)
// and the mock telemetry emitter (which can't use React hooks).
export const demoState: {
  path: LatLon[]
  version: number
  speedMs: number
  windStrength: number
  pathDistanceM: number
  activeMissionPath: LatLon[]
} = {
  path: [],
  version: 0,
  speedMs: 18,
  windStrength: 0,
  pathDistanceM: 0,
  activeMissionPath: [],
}
