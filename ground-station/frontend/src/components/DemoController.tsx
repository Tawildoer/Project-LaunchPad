import { useEffect, useRef } from 'react'
import { useMission } from '../store/MissionContext'
import { useSettings } from '../store/SettingsContext'
import { buildMissionPath } from '../lib/pathPlanning'
import type { ArcMode } from '../lib/pathPlanning'
import { demoState } from '../mocks/demoState'

const DEMO_MODE = !import.meta.env.VITE_WS_URL

// Keeps demoState.path in sync with the current mission path.
// Crucially: version only increments when POIs are ADDED or arc mode changes,
// NOT when POIs are completed — so the drone keeps flying the original activePath
// rather than recalculating from its current position.
export default function DemoController() {
  const { pois } = useMission()
  const { settings } = useSettings()
  const versionRef    = useRef(0)
  const prevCountRef  = useRef(0)
  const prevArcRef    = useRef<ArcMode>(settings.arcMode)

  useEffect(() => {
    if (!DEMO_MODE) return

    const path = buildMissionPath(pois, settings.arcMode)
    demoState.path     = path
    demoState.firstPoi = pois.length > 0
      ? { lat: pois[0].lat, lon: pois[0].lon, loiter_radius: pois[0].loiter_radius }
      : null

    const poisAdded    = pois.length > prevCountRef.current
    const poisCleared  = pois.length === 0
    const modeChanged  = settings.arcMode !== prevArcRef.current

    if (poisAdded || poisCleared || modeChanged) {
      demoState.version = ++versionRef.current
    }

    prevCountRef.current = pois.length
    prevArcRef.current   = settings.arcMode
  }, [pois, settings.arcMode])

  return null
}
