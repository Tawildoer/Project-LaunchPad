import { useState } from 'react'
import StatusHeader from './components/StatusHeader'
import CommandBar from './components/CommandBar'
import MapPanel from './components/MapPanel'
import VideoPanel from './components/VideoPanel'
import CopilotBar from './components/CopilotBar'
import SettingsPanel from './components/SettingsPanel'

type PipPanel = 'map' | 'video'

export default function App() {
  const [pip, setPip] = useState<PipPanel>('video')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="app">
      <StatusHeader onSettingsToggle={() => setSettingsOpen(v => !v)} />
      <SettingsPanel open={settingsOpen} />

      <div className="panels">
        <div className={pip === 'map' ? 'panel-pip' : 'panel-main'}>
          {pip === 'map' && (
            <div className="panel-pip-overlay" onClick={() => setPip('video')} />
          )}
          <MapPanel isPip={pip === 'map'} />
        </div>

        <div className={pip === 'video' ? 'panel-pip' : 'panel-main'}>
          {pip === 'video' && (
            <div className="panel-pip-overlay" onClick={() => setPip('map')} />
          )}
          <VideoPanel />
        </div>
      </div>

      <CommandBar />
      <CopilotBar />
    </div>
  )
}
