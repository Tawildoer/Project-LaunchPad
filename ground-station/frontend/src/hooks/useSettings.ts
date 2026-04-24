import { useState, useCallback } from 'react'
import type { IdleMode } from '../types'

interface Settings {
  idleMode: IdleMode
  minTurnRadius: number
}

const STORAGE_KEY = 'launchpad-settings'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Settings
  } catch {
    // ignore parse errors
  }
  return { idleMode: 'LOITER', minTurnRadius: 50 }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { settings, update }
}
