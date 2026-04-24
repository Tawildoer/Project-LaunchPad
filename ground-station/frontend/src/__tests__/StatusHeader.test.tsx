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

  it('shows connected status', () => {
    render(<StatusHeader />)
    expect(screen.getByText('CONNECTED')).toBeInTheDocument()
  })
})
