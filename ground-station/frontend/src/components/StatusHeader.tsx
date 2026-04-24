import { useEffect, useState } from 'react'
import { useTelemetry } from '../store/TelemetryContext'
import type { ConnectionStatus } from '../types'

const STATUS_COLOURS: Record<ConnectionStatus, string> = {
  connected:    'var(--fg)',
  reconnecting: 'var(--amber)',
  disconnected: 'var(--red)',
}

const DEMO_MODE = !import.meta.env.VITE_WS_URL

function Clock() {
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 8))
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toTimeString().slice(0, 8)), 1000)
    return () => clearInterval(id)
  }, [])
  return <span>{time}</span>
}

interface Props {
  onSettingsToggle?: () => void
}

export default function StatusHeader({ onSettingsToggle }: Props) {
  const { connectionStatus } = useTelemetry()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      borderBottom: '1px solid var(--border)',
      height: '100%',
      fontSize: 'var(--text-sm)',
      letterSpacing: '0.1em',
      gap: 12,
    }}>
      <span style={{ flex: 1 }}>▌ <span>PROJECT LAUNCHPAD</span></span>
      <span style={{ color: DEMO_MODE ? 'var(--fg-dim)' : STATUS_COLOURS[connectionStatus] }}>
        ● <span>{DEMO_MODE ? 'DEMO' : connectionStatus.toUpperCase()}</span>
      </span>
      <Clock />
      <button onClick={onSettingsToggle} style={{ letterSpacing: '0.08em' }}>⚙ SETTINGS</button>
    </div>
  )
}
