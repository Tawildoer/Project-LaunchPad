import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './App'
import { TelemetryProvider } from './store/TelemetryContext'
import { MissionProvider } from './store/MissionContext'
import { SettingsProvider } from './store/SettingsContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TelemetryProvider>
      <MissionProvider>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </MissionProvider>
    </TelemetryProvider>
  </StrictMode>,
)
