import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CopilotBar from '../components/CopilotBar'

vi.mock('../store/TelemetryContext', () => ({
  useTelemetry: () => ({
    telemetry: null,
    connectionStatus: 'connected',
    send: vi.fn(),
  }),
}))

describe('CopilotBar', () => {
  it('shows offline message when no backend is configured', () => {
    render(<CopilotBar />)
    // In test environment, VITE_WS_URL is not set, so the offline state is shown
    expect(screen.getByText(/no backend/i)).toBeInTheDocument()
  })

  it('shows the copilot prefix', () => {
    render(<CopilotBar />)
    expect(screen.getByText(/copilot>/i)).toBeInTheDocument()
  })
})
