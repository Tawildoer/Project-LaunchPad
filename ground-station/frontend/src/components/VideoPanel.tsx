import { useRef } from 'react'
import { useTelemetry } from '../store/TelemetryContext'

export default function VideoPanel() {
  const { telemetry } = useTelemetry()
  const videoRef = useRef<HTMLVideoElement>(null)

  const activePoi = telemetry?.mission?.active_poi_id ?? null

  return (
    <div className="video-panel">
      {activePoi && (
        <div className="gimbal-label">LOCKED: {activePoi}</div>
      )}

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'none' }}
      />

      <div className="no-signal">
        <span>[ NO SIGNAL ]</span>
        <div className="no-signal-dots">
          <span>●</span>
          <span>●</span>
          <span>●</span>
        </div>
        <span style={{ fontSize: '10px' }}>WEBRTC PENDING</span>
      </div>
    </div>
  )
}
