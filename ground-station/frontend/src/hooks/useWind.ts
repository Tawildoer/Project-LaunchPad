import { useState, useEffect, useRef } from 'react'

export interface WindData {
  speed_ms: number      // m/s at 10 m
  gusts_ms: number      // m/s
  direction_deg: number // meteorological: 0=N, 90=E, 180=S, 270=W
}

const FETCH_INTERVAL_MS = 5 * 60 * 1000   // re-fetch every 5 minutes
const MOVE_THRESHOLD_M  = 5000            // re-fetch if drone moves > 5 km

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const cosLat = Math.cos(lat1 * Math.PI / 180)
  return Math.sqrt(
    ((lon2 - lon1) * cosLat * 111320) ** 2 +
    ((lat2 - lat1) * 111320) ** 2,
  )
}

// Cardinal + intercardinal wind direction label
export function windDirLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}

export function useWind(lat: number | null, lon: number | null): WindData | null {
  const [wind, setWind] = useState<WindData | null>(null)
  const lastFetchPos = useRef<{ lat: number; lon: number } | null>(null)
  const lastFetchTime = useRef<number>(0)

  useEffect(() => {
    if (lat === null || lon === null) return

    const now = Date.now()
    const moved = lastFetchPos.current
      ? distMeters(lastFetchPos.current.lat, lastFetchPos.current.lon, lat, lon) > MOVE_THRESHOLD_M
      : true
    const stale = now - lastFetchTime.current > FETCH_INTERVAL_MS

    if (!moved && !stale) return

    lastFetchPos.current  = { lat, lon }
    lastFetchTime.current = now

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&wind_speed_unit=ms`

    fetch(url)
      .then(r => r.json())
      .then((data: { current?: { wind_speed_10m?: number; wind_direction_10m?: number; wind_gusts_10m?: number } }) => {
        const c = data.current
        if (c) {
          setWind({
            speed_ms:      c.wind_speed_10m      ?? 0,
            gusts_ms:      c.wind_gusts_10m      ?? 0,
            direction_deg: c.wind_direction_10m  ?? 0,
          })
        }
      })
      .catch(() => {}) // non-critical — just don't show wind data if API is unreachable
  }, [lat, lon])

  return wind
}
