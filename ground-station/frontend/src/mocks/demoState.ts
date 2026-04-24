import type { LatLon } from '../lib/pathPlanning'

// Shared mutable state between DemoController (MissionContext subscriber)
// and the mock telemetry emitter (which can't use React hooks).
// The controller writes the path; the emitter reads it each tick.
export const demoState: {
  path: LatLon[]
  version: number  // incremented on every path change so the emitter detects updates
} = {
  path: [],
  version: 0,
}
