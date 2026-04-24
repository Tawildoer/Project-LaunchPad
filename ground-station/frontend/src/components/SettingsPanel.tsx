import { useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useTelemetry } from '../store/TelemetryContext'

export default function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const { settings, update } = useSettings()
  const { send } = useTelemetry()

  const setIdleMode = (mode: 'LOITER' | 'QLOITER') => {
    update({ idleMode: mode })
    send({ type: 'command', payload: { type: 'set_idle_mode', idle_mode: mode } })
  }

  return (
    <>
      <button
        style={{ position: 'absolute', top: 0, right: 0, zIndex: 2001, margin: '6px 8px' }}
        onClick={() => setOpen((v) => !v)}
      >
        ⚙ SETTINGS
      </button>

      {open && (
        <div className="settings-overlay">
          <div style={{ letterSpacing: '0.1em', marginBottom: 14, color: 'var(--green)' }}>
            SETTINGS
          </div>

          <div className="settings-row">
            <span className="settings-label">IDLE MODE</span>
            <div className="toggle-group">
              <button
                className={settings.idleMode === 'LOITER' ? 'active' : ''}
                onClick={() => setIdleMode('LOITER')}
                title="Fixed-wing glide circles — energy efficient"
              >
                LOITER
              </button>
              <button
                className={settings.idleMode === 'QLOITER' ? 'active' : ''}
                onClick={() => setIdleMode('QLOITER')}
                title="Multirotor hover — precise position hold"
              >
                QLOITER
              </button>
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-label">MIN TURN RADIUS (m)</span>
            <input
              type="number"
              value={settings.minTurnRadius}
              min={10}
              max={500}
              style={{ width: 64, textAlign: 'right' }}
              onChange={(e) => update({ minTurnRadius: Number(e.target.value) })}
            />
          </div>
        </div>
      )}
    </>
  )
}
