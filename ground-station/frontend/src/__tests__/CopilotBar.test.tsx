import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CopilotBar from '../components/CopilotBar'

const mockSend = vi.fn()

vi.mock('../store/TelemetryContext', () => ({
  useTelemetry: () => ({
    telemetry: null,
    connectionStatus: 'connected',
    send: mockSend,
  }),
}))

describe('CopilotBar', () => {
  it('sends copilot_request on Enter', () => {
    render(<CopilotBar />)
    const input = screen.getByPlaceholderText(/copilot/i)
    fireEvent.change(input, { target: { value: 'fly to the river' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockSend).toHaveBeenCalledWith({
      type: 'copilot_request',
      payload: { text: 'fly to the river', session_id: expect.any(String) },
    })
  })

  it('clears input after submit', () => {
    render(<CopilotBar />)
    const input = screen.getByPlaceholderText(/copilot/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'fly north' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('')
  })
})
