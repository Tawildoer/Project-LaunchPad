import { useEffect, useRef, useCallback } from 'react'
import type { WsMessage } from '../types'

type MessageHandler = (msg: WsMessage) => void

export function useWebSocket(
  url: string | null,
  onMessage: MessageHandler,
): { send: (msg: WsMessage) => void } {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  useEffect(() => {
    if (!url) return

    const socket = new WebSocket(url)
    wsRef.current = socket

    socket.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage
        onMessageRef.current(msg)
      } catch {
        // ignore malformed messages
      }
    }

    return () => {
      socket.close()
      wsRef.current = null
    }
  }, [url])

  return { send }
}
