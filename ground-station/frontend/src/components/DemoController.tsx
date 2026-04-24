import { useEffect, useRef } from 'react'
import { useTelemetry } from '../store/TelemetryContext'
import { useMission } from '../store/MissionContext'
import { buildMissionPath, approachEntryAngle } from '../lib/pathPlanning'
import { demoState } from '../mocks/demoState'

const DEMO_MODE = !import.meta.env.VITE_WS_URL

export default function DemoController() {
  const { telemetry } = useTelemetry()
  const { pois } = useMission()
  const versionRef    = useRef(0)
  const prevCountRef  = useRef(0)
  const telemetryRef  = useRef(telemetry)
  telemetryRef.current = telemetry

  useEffect(() => {
    if (!DEMO_MODE) return

    const arcMode = pois.length > 0 ? pois[0].arc_mode : 'cw'

    const t = telemetryRef.current
    const ea = (t && pois.length > 0)
      ? approachEntryAngle(
          { lat: t.position.lat, lon: t.position.lon },
          { lat: pois[0].lat, lon: pois[0].lon },
          pois[0].loiter_radius,
          arcMode,
        )
      : undefined

    const path = buildMissionPath(pois, arcMode, ea)

    const poisAdded   = pois.length > prevCountRef.current
    const poisCleared = pois.length === 0

    if (poisAdded || poisCleared) {
      demoState.path = path
      demoState.version = ++versionRef.current
    }

    prevCountRef.current = pois.length
  }, [pois])

  return null
}
