import {
  createContext,
  useContext,
  useState,
  useCallback,
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

function pathCost(pois: POI[]): number {
  let total = 0
  for (let i = 0; i < pois.length - 1; i++) {
    const cosLat = Math.cos(pois[i].lat * Math.PI / 180)
    const dx = (pois[i + 1].lon - pois[i].lon) * cosLat * 111320
    const dy = (pois[i + 1].lat - pois[i].lat) * 111320
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

function twoOpt(pois: POI[]): POI[] {
  if (pois.length < 3) return pois
  let best = [...pois]
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 2; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i + 1),
          ...best.slice(i + 1, j + 1).reverse(),
          ...best.slice(j + 1),
        ]
        if (pathCost(candidate) < pathCost(best)) {
          best = candidate
          improved = true
        }
      }
    }
  }
  return best
}

export function MissionProvider({ children }: { children: ReactNode }) {
  const [pois, setPois] = useState<POI[]>([])
  const { send } = useTelemetry()

  const addPoi = useCallback((poi: POI) => {
    setPois((prev) => {
      const updated = [...prev, poi]
      return updated.length >= 3 ? twoOpt(updated) : updated
    })
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
