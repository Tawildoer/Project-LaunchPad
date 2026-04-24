import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { createMockTelemetryEmitter } from '../mocks/mockTelemetry'
import type { Telemetry, ConnectionStatus, WsMessage } from '../types'

interface TelemetryState {
  telemetry: Telemetry | null
  connectionStatus: ConnectionStatus
  send: (msg: WsMessage) => void
}

const TelemetryContext = createContext<TelemetryState | null>(null)

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? null

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected')

  const handleMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'telemetry') {
      setTelemetry(msg.payload as Telemetry)
    }
    if (msg.type === 'connection_status') {
      const p = msg.payload as { status: ConnectionStatus }
      setConnectionStatus(p.status)
    }
  }, [])

  const { send } = useWebSocket(WS_URL, handleMessage)

  useEffect(() => {
    if (WS_URL) return
    const stop = createMockTelemetryEmitter(
      (t) => setTelemetry(t),
      (s) => setConnectionStatus(s),
    )
    return stop
  }, [])

  return (
    <TelemetryContext.Provider value={{ telemetry, connectionStatus, send }}>
      {children}
    </TelemetryContext.Provider>
  )
}

export function useTelemetry(): TelemetryState {
  const ctx = useContext(TelemetryContext)
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider')
  return ctx
}
