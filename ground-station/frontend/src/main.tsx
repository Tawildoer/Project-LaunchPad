import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles/theme.css'
import App from './App'
import { TelemetryProvider } from './store/TelemetryContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TelemetryProvider>
      <App />
    </TelemetryProvider>
  </StrictMode>,
)
