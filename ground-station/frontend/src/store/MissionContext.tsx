import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import { useTelemetry } from './TelemetryContext'
import type { POI } from '../types'

interface MissionState {
  pois: POI[]
  addPoi:      (poi: POI) => void
  removePoi:   (id: string) => void
  clearPois:   () => void
  sendMission: (minTurnRadius: number) => void
}

const MissionContext = createContext<MissionState | null>(null)

export function MissionProvider({ children }: { children: ReactNode }) {
  const [pois, setPois] = useState<POI[]>([])
  const { send } = useTelemetry()

  const addPoi = useCallback((poi: POI) => {
    setPois((prev) => [...prev, poi])
  }, [])

  const removePoi = useCallback((id: string) => {
    setPois((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const clearPois = useCallback(() => setPois([]), [])

  const sendMission = useCallback(
    (minTurnRadius: number) => {
      send({
        type: 'command',
        payload: { type: 'send_mission', min_turn_radius: minTurnRadius, pois },
      })
    },
    [send, pois],
  )

  useEffect(() => {
    if (pois.length > 0) {
      send({
        type: 'command',
        payload: { type: 'send_mission', pois: pois.map(p => ({
          id: p.id, lat: p.lat, lon: p.lon, alt: p.alt,
          loiter_radius: p.loiter_radius, dwell_seconds: p.dwell_seconds,
        })) },
      })
    }
  }, [pois, send])

  return (
    <MissionContext.Provider value={{ pois, addPoi, removePoi, clearPois, sendMission }}>
      {children}
    </MissionContext.Provider>
  )
}

export function useMission(): MissionState {
  const ctx = useContext(MissionContext)
  if (!ctx) throw new Error('useMission must be used within MissionProvider')
  return ctx
}
