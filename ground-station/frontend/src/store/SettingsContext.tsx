import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { IdleMode } from '../types'
import type { ArcMode } from '../lib/pathPlanning'

export type { ArcMode }

interface WebRtcSettings {
  stunUrl: string
  icePolicy: 'all' | 'relay'
}

export interface RecentConnection {
  id: string
  address: string
  connectedAt: string
}

export interface Settings {
  idleMode: IdleMode
  loiterRadius: number
  arcMode: ArcMode
  webrtc: WebRtcSettings
  recentConnections: RecentConnection[]
}

const STORAGE_KEY = 'launchpad-settings'

const DEFAULTS: Settings = {
  idleMode: 'LOITER',
  loiterRadius: 100,
  arcMode: 'cw',
  webrtc: {
    stunUrl: 'stun:stun.l.google.com:19302',
    icePolicy: 'all',
  },
  recentConnections: [],
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Record<string, unknown>
      // Migrate old minTurnRadius key
      if ('minTurnRadius' in stored && !('loiterRadius' in stored)) {
        stored.loiterRadius = stored.minTurnRadius
      }
      return { ...DEFAULTS, ...stored }
    }
  } catch {}
  return DEFAULTS
}

function save(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

interface SettingsContextValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  addRecentConnection: (conn: Omit<RecentConnection, 'connectedAt'>) => void
  clearRecentConnections: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }, [])

  const addRecentConnection = useCallback((conn: Omit<RecentConnection, 'connectedAt'>) => {
    setSettings(prev => {
      const filtered = prev.recentConnections.filter(c => c.address !== conn.address)
      const updated: RecentConnection = { ...conn, connectedAt: new Date().toISOString() }
      const next = { ...prev, recentConnections: [updated, ...filtered].slice(0, 5) }
      save(next)
      return next
    })
  }, [])

  const clearRecentConnections = useCallback(() => {
    update({ recentConnections: [] })
  }, [update])

  return (
    <SettingsContext.Provider value={{ settings, update, addRecentConnection, clearRecentConnections }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
