import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TelemetryProvider, useTelemetry } from '../store/TelemetryContext'

function Consumer() {
  const { connectionStatus } = useTelemetry()
  return <div data-testid="status">{connectionStatus}</div>
}

describe('TelemetryContext', () => {
  it('provides disconnected status when no WS_URL configured', () => {
    render(
      <TelemetryProvider>
        <Consumer />
      </TelemetryProvider>,
    )
    expect(screen.getByTestId('status').textContent).toBe('disconnected')
  })
})
