import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CommandBar from '../components/CommandBar'
import type { Telemetry } from '../types'

const mockSend = vi.fn()
const mockTelemetry: Telemetry = {
  timestamp: 1000,
  armed: false,
  mode: 'LOITER',
  position: { lat: 51.5, lon: -0.09, alt_msl: 150, alt_rel: 80 },
  attitude: { roll: 0, pitch: 0, yaw: 90 },
  velocity: { ground_speed: 18, air_speed: 22, climb_rate: 0 },
  battery: { voltage: 22.2, current: 12, remaining_pct: 85 },
  gps: { fix_type: 3, satellites_visible: 12 },
}

vi.mock('../store/TelemetryContext', () => ({
  useTelemetry: () => ({
    telemetry: mockTelemetry,
    connectionStatus: 'connected',
    send: mockSend,
  }),
}))

describe('CommandBar', () => {
  it('sends arm command when ARM clicked', () => {
    render(<CommandBar />)
    fireEvent.click(screen.getByText('ARM'))
    expect(mockSend).toHaveBeenCalledWith({ type: 'command', payload: { type: 'arm' } })
  })

  it('sends return_home command when RTL clicked', () => {
    render(<CommandBar />)
    fireEvent.click(screen.getByText('RTL'))
    expect(mockSend).toHaveBeenCalledWith({ type: 'command', payload: { type: 'return_home' } })
  })

  it('displays battery percentage', () => {
    render(<CommandBar />)
    expect(screen.getByText(/85%/)).toBeInTheDocument()
  })

  it('displays altitude', () => {
    render(<CommandBar />)
    expect(screen.getByText(/80m/)).toBeInTheDocument()
  })
})
