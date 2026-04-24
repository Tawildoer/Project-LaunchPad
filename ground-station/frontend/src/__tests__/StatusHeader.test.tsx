import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import StatusHeader from '../components/StatusHeader'

vi.mock('../store/TelemetryContext', () => ({
  useTelemetry: () => ({
    connectionStatus: 'connected',
    telemetry: null,
    send: vi.fn(),
  }),
}))

describe('StatusHeader', () => {
  it('shows project name', () => {
    render(<StatusHeader />)
    expect(screen.getByText('PROJECT LAUNCHPAD')).toBeInTheDocument()
  })

  it('shows demo mode when no backend is configured', () => {
    render(<StatusHeader />)
    // In test environment, VITE_WS_URL is not set, so DEMO mode is shown
    expect(screen.getByText('DEMO')).toBeInTheDocument()
  })
})
