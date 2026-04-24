import { useState, useCallback, useRef } from 'react'
import StatusHeader from './components/StatusHeader'
import CommandBar from './components/CommandBar'
import MapPanel from './components/MapPanel'
import VideoPanel from './components/VideoPanel'

export default function App() {
  const [leftPct, setLeftPct] = useState(50)
  const dragging = useRef(false)
  const panelsRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback(() => {
    dragging.current = true

    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !panelsRef.current) return
      const rect = panelsRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(80, Math.max(20, pct)))
    }

    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="app" style={{ position: 'relative' }}>
      <StatusHeader />
      <div className="panels" ref={panelsRef}>
        <div className="panel" style={{ width: `${leftPct}%` }}>
          <MapPanel />
        </div>
        <div
          className="panel-divider"
          onMouseDown={onMouseDown}
        />
        <div className="panel" style={{ flex: 1 }}>
          <VideoPanel />
        </div>
      </div>
      <CommandBar />
      <div style={{ borderTop: '1px solid var(--border)', padding: '0 12px', display: 'flex', alignItems: 'center' }}>
        COPILOT BAR
      </div>
    </div>
  )
}
