import { useSettings } from '../store/SettingsContext'
import { useTelemetry } from '../store/TelemetryContext'

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

interface Props {
  open: boolean
}

export default function SettingsPanel({ open }: Props) {
  const { settings, update, clearRecentConnections } = useSettings()
  const { send } = useTelemetry()

  const setIdleMode = (mode: 'LOITER' | 'QLOITER') => {
    update({ idleMode: mode })
    send({ type: 'command', payload: { type: 'set_idle_mode', idle_mode: mode } })
  }

  if (!open) return null

  return (
    <div className="settings-overlay">
      <div style={{ letterSpacing: '0.1em', marginBottom: 14, color: 'var(--fg)' }}>
        SETTINGS
      </div>

      {/* FLIGHT */}
      <div className="settings-section-title">FLIGHT</div>

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

      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <span className="settings-label">LOITER RADIUS</span>
          <span style={{ color: 'var(--fg)', fontSize: 'var(--text-sm)' }}>{settings.loiterRadius}m</span>
        </div>
        <input
          type="range"
          min={30}
          max={500}
          step={10}
          value={settings.loiterRadius}
          onChange={(e) => update({ loiterRadius: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">ARC MODE</span>
        <div className="toggle-group">
          <button
            className={settings.arcMode === 'cw' ? 'active' : ''}
            onClick={() => update({ arcMode: 'cw' })}
            title="Always clockwise — circles kept to the right (ArduPilot default)"
          >
            CW
          </button>
          <button
            className={settings.arcMode === 'short' ? 'active' : ''}
            onClick={() => update({ arcMode: 'short' })}
            title="Take the shorter arc at each intermediate waypoint"
          >
            SHORT
          </button>
          <button
            className={settings.arcMode === 'long' ? 'active' : ''}
            onClick={() => update({ arcMode: 'long' })}
            title="Take the longer arc — more time over each waypoint"
          >
            LONG
          </button>
          <button
            className={settings.arcMode === 'ccw' ? 'active' : ''}
            onClick={() => update({ arcMode: 'ccw' })}
            title="Always counter-clockwise — circles kept to the left"
          >
            CCW
          </button>
        </div>
      </div>

      <div className="settings-row">
        <span className="settings-label">TRAIL</span>
        <div className="toggle-group">
          <button
            className={settings.trailMode === 'solid' ? 'active' : ''}
            onClick={() => update({ trailMode: 'solid' })}
          >
            SOLID
          </button>
          <button
            className={settings.trailMode === 'fading' ? 'active' : ''}
            onClick={() => update({ trailMode: 'fading' })}
          >
            FADING
          </button>
          <button
            className={settings.trailMode === 'off' ? 'active' : ''}
            onClick={() => update({ trailMode: 'off' })}
          >
            OFF
          </button>
        </div>
      </div>

      {/* WEBRTC */}
      <div className="settings-section-title">WEBRTC</div>

      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <span className="settings-label">STUN SERVER</span>
        <input
          type="text"
          value={settings.webrtc.stunUrl}
          style={{ width: '100%' }}
          onChange={(e) => update({ webrtc: { ...settings.webrtc, stunUrl: e.target.value } })}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">ICE TRANSPORT</span>
        <div className="toggle-group">
          <button
            className={settings.webrtc.icePolicy === 'all' ? 'active' : ''}
            onClick={() => update({ webrtc: { ...settings.webrtc, icePolicy: 'all' } })}
            title="Use all candidates including direct P2P"
          >
            ALL
          </button>
          <button
            className={settings.webrtc.icePolicy === 'relay' ? 'active' : ''}
            onClick={() => update({ webrtc: { ...settings.webrtc, icePolicy: 'relay' } })}
            title="Relay only — useful behind strict NAT"
          >
            RELAY
          </button>
        </div>
      </div>

      {/* RECENT CONNECTIONS */}
      <div className="settings-section-title">RECENT CONNECTIONS</div>

      {settings.recentConnections.length === 0 ? (
        <div style={{ color: 'var(--fg-dim)', marginBottom: 12 }}>
          no connections recorded
        </div>
      ) : (
        <>
          {settings.recentConnections.map((conn) => (
            <div key={conn.id} className="recent-connection-item">
              <div>
                <div className="recent-connection-addr">{conn.address}</div>
                <div className="recent-connection-time">
                  {conn.id} · {formatRelativeTime(conn.connectedAt)}
                </div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <button onClick={clearRecentConnections}>CLEAR</button>
          </div>
        </>
      )}
    </div>
  )
}
