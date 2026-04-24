import { useTelemetry } from '../store/TelemetryContext'
import { useWind, windDirLabel } from '../hooks/useWind'

export default function CommandBar() {
  const { telemetry, send } = useTelemetry()
  const wind = useWind(
    telemetry?.position.lat ?? null,
    telemetry?.position.lon ?? null,
  )

  const arm    = () => send({ type: 'command', payload: { type: 'arm' } })
  const disarm = () => send({ type: 'command', payload: { type: 'disarm' } })
  const rtl    = () => send({ type: 'command', payload: { type: 'return_home' } })

  const alt  = telemetry ? `${Math.round(telemetry.position.alt_rel)}m` : '--'
  const spd  = telemetry ? `${Math.round(telemetry.velocity.ground_speed)}m/s` : '--'
  const bat  = telemetry ? `${telemetry.battery.remaining_pct}%` : '--'
  const mode = telemetry?.mode ?? '--'

  const windStr = wind
    ? `${wind.speed_ms.toFixed(1)}m/s ${windDirLabel(wind.direction_deg)}`
    : '--'
  const gustStr = wind ? `G${wind.gusts_ms.toFixed(1)}` : ''

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      borderTop: '1px solid var(--border)',
      height: '100%',
      fontSize: 'var(--text-sm)',
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={arm}>ARM</button>
        <button onClick={disarm}>DISARM</button>
        <button onClick={rtl}>RTL</button>
      </div>
      <div style={{ display: 'flex', gap: 20, color: 'var(--fg-dim)', letterSpacing: '0.05em' }}>
        <span>ALT: <span style={{ color: 'var(--fg)' }}>{alt}</span></span>
        <span>SPD: <span style={{ color: 'var(--fg)' }}>{spd}</span></span>
        <span>BAT: <span style={{ color: 'var(--fg)' }}>{bat}</span></span>
        <span>MODE: <span style={{ color: 'var(--fg)' }}>{mode}</span></span>
        <span>
          WIND: <span style={{ color: 'var(--fg)' }}>{windStr}</span>
          {gustStr && <span style={{ color: 'var(--fg-dim)' }}> {gustStr}</span>}
        </span>
      </div>
    </div>
  )
}
