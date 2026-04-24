import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TelemetryProvider, useTelemetry } from '../store/TelemetryContext'
import type { Telemetry } from '../types'

const mockTelemetry: Telemetry = {
  timestamp: 1000,
  armed: true,
  mode: 'LOITER',
  position: { lat: 51.5, lon: -0.09, alt_msl: 150, alt_rel: 80 },
  attitude: { roll: 0, pitch: 2, yaw: 90 },
  velocity: { ground_speed: 18, air_speed: 22, climb_rate: 0 },
  battery: { voltage: 22.2, current: 12, remaining_pct: 85 },
  gps: { fix_type: 3, satellites_visible: 12 },
}

vi.mock('../mocks/mockTelemetry', () => ({
  createMockTelemetryEmitter: (
    onTelemetry: (t: Telemetry) => void,
    onStatus: (s: string) => void,
  ) => {
    onStatus('connected')
    onTelemetry(mockTelemetry)
    return vi.fn()
  },
}))

function Consumer() {
  const { telemetry, connectionStatus } = useTelemetry()
  return (
    <>
      <div data-testid="status">{connectionStatus}</div>
      <div data-testid="mode">{telemetry?.mode ?? 'none'}</div>
      <div data-testid="bat">{telemetry?.battery.remaining_pct ?? 0}</div>
    </>
  )
}

describe('TelemetryContext', () => {
  it('provides telemetry and connection status from mock emitter', () => {
    render(
      <TelemetryProvider>
        <Consumer />
      </TelemetryProvider>,
    )
    expect(screen.getByTestId('status').textContent).toBe('connected')
    expect(screen.getByTestId('mode').textContent).toBe('LOITER')
    expect(screen.getByTestId('bat').textContent).toBe('85')
  })
})
