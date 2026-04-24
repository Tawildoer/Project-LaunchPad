import { useEffect, useRef } from 'react'
import { useMission } from '../store/MissionContext'
import { useSettings } from '../store/SettingsContext'
import { buildMissionPath } from '../lib/pathPlanning'
import { demoState } from '../mocks/demoState'

const DEMO_MODE = !import.meta.env.VITE_WS_URL

// Keeps demoState.path in sync with the current mission path.
// Rendered as a null component inside App so it has access to all contexts.
export default function DemoController() {
  const { pois } = useMission()
  const { settings } = useSettings()
  const versionRef = useRef(0)

  useEffect(() => {
    if (!DEMO_MODE) return
    const path = buildMissionPath(pois, settings.arcMode)
    demoState.path    = path
    demoState.version = ++versionRef.current
  }, [pois, settings.arcMode])

  return null
}
