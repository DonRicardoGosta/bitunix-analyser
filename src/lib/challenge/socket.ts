import { useEffect, useRef, useState } from 'react'
import type {
  ChallengeEvent,
  ChallengeRun,
  ChallengeSummary,
  ClientWsMessage,
  ServerWsMessage,
} from '@shared/challenge/types'

// Reconnecting WebSocket client + React hook for the Challenge event stream and
// live state snapshots (items 8 + 10). Subscribes to all challenges on connect.

const EVENT_CAP = 800

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/ws`
}

export interface ChallengeStreamState {
  connected: boolean
  runs: ChallengeRun[]
  /** Latest live snapshot per running challenge id. */
  summaries: Record<string, ChallengeSummary>
  events: ChallengeEvent[]
}

const EMPTY: ChallengeStreamState = { connected: false, runs: [], summaries: {}, events: [] }

function reduce(prev: ChallengeStreamState, msg: ServerWsMessage): ChallengeStreamState {
  switch (msg.type) {
    case 'runs':
      return { ...prev, runs: msg.runs }
    case 'state':
      return { ...prev, summaries: { ...prev.summaries, [msg.summary.run.id]: msg.summary } }
    case 'event': {
      const events = [...prev.events, msg.event]
      if (events.length > EVENT_CAP) events.splice(0, events.length - EVENT_CAP)
      return { ...prev, events }
    }
    default:
      return prev
  }
}

/** Subscribe to the backend stream for the lifetime of the component. */
export function useChallengeStream(): ChallengeStreamState {
  const [state, setState] = useState<ChallengeStreamState>(EMPTY)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      const ws = new WebSocket(wsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        setState((s) => ({ ...s, connected: true }))
        ws.send(JSON.stringify({ op: 'subscribe' } satisfies ClientWsMessage))
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'ping' } satisfies ClientWsMessage))
          }
        }, 20_000)
      }

      ws.onmessage = (ev: MessageEvent) => {
        let msg: ServerWsMessage
        try {
          msg = JSON.parse(String(ev.data)) as ServerWsMessage
        } catch {
          return
        }
        setState((prev) => reduce(prev, msg))
      }

      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }))
        if (pingTimer) clearInterval(pingTimer)
        if (!closed) reconnectTimer = setTimeout(connect, 2_000)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pingTimer) clearInterval(pingTimer)
      wsRef.current?.close()
    }
  }, [])

  return state
}
