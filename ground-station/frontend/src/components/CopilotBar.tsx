import { useState, useRef, useEffect, useCallback } from 'react'
import { useTelemetry } from '../store/TelemetryContext'
import type { CopilotResponse, WsMessage } from '../types'

const SESSION_ID = crypto.randomUUID()
const DEMO_MODE = !import.meta.env.VITE_WS_URL

interface Message {
  role: 'user' | 'assistant'
  text: string
  pendingCommand?: unknown
}

export default function CopilotBar() {
  const { send } = useTelemetry()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [messages])

  const handleIncomingMessage = useCallback((msg: WsMessage) => {
    if (msg.type !== 'copilot_response') return
    const resp = msg.payload as CopilotResponse
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', text: resp.text, pendingCommand: resp.pending_command },
    ])
    setShowHistory(true)
  }, [])

  useEffect(() => {
    const key = '__copilotHandler'
    ;(window as unknown as Record<string, unknown>)[key] = handleIncomingMessage
    return () => { delete (window as unknown as Record<string, unknown>)[key] }
  }, [handleIncomingMessage])

  const submit = useCallback(() => {
    const text = input.trim()
    if (!text || DEMO_MODE) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text }])
    setShowHistory(true)
    send({ type: 'copilot_request', payload: { text, session_id: SESSION_ID } })
  }, [input, send])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') submit()
      if (e.key === 'Escape') setShowHistory(false)
    },
    [submit],
  )

  const executeConfirmed = useCallback(
    (cmd: unknown) => {
      send({ type: 'command', payload: cmd })
      setMessages((prev) =>
        prev.map((m) =>
          m.pendingCommand === cmd ? { ...m, pendingCommand: undefined } : m,
        ),
      )
    },
    [send],
  )

  const lastPendingMsg = [...messages].reverse().find((m) => m.pendingCommand)

  return (
    <div style={{ position: 'relative' }}>
      {showHistory && messages.length > 0 && (
        <div className="copilot-response" ref={historyRef}>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <span style={{ color: m.role === 'user' ? 'var(--fg-dim)' : 'var(--fg)' }}>
                {m.role === 'user' ? '> ' : '◈ '}
              </span>
              {m.text}
              {!!m.pendingCommand && m === lastPendingMsg && (
                <div className="copilot-confirmation">
                  <button onClick={() => executeConfirmed(m.pendingCommand)}>EXECUTE</button>
                  <button onClick={() => setMessages((p) =>
                    p.map((x) => x === m ? { ...x, pendingCommand: undefined } : x)
                  )}>CANCEL</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="copilot-bar">
        <span className="copilot-prefix">▌ copilot&gt;</span>
        {DEMO_MODE ? (
          <span className="copilot-offline">NO BACKEND — start ground-station/backend to use copilot</span>
        ) : (
          <input
            className="copilot-input"
            type="text"
            value={input}
            placeholder="type a command or question..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => messages.length > 0 && setShowHistory(true)}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </div>
    </div>
  )
}
