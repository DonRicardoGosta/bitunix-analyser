import { WebSocket } from 'ws'
import { logger } from '../logger'

// Reconnecting WebSocket client for Node (Bitunix public market feed). Mirrors
// the browser ReconnectingSocket: heartbeat + exponential backoff.

export interface ReconnectingSocketOptions {
  url: string
  onOpen?: (sock: ReconnectingSocket) => void
  onMessage?: (data: unknown) => void
  onClose?: () => void
  heartbeat?: (sock: ReconnectingSocket) => void
  heartbeatIntervalMs?: number
  maxBackoffMs?: number
}

export class ReconnectingSocket {
  private readonly opts: ReconnectingSocketOptions
  private ws: WebSocket | null = null
  private backoff = 1000
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private closedByUser = false

  constructor(opts: ReconnectingSocketOptions) {
    this.opts = opts
  }

  connect(): void {
    this.closedByUser = false
    this.open()
  }

  private open(): void {
    let ws: WebSocket
    try {
      ws = new WebSocket(this.opts.url)
    } catch (err) {
      logger.warn(`ws connect failed: ${String(err)}`)
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.on('open', () => {
      this.backoff = 1000
      this.startHeartbeat()
      this.opts.onOpen?.(this)
    })

    ws.on('message', (raw) => {
      let parsed: unknown
      const text = raw.toString()
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
      this.opts.onMessage?.(parsed)
    })

    ws.on('close', () => {
      this.stopHeartbeat()
      this.opts.onClose?.()
      if (!this.closedByUser) this.scheduleReconnect()
    })

    ws.on('error', (err) => {
      logger.debug(`ws error: ${String(err)}`)
      ws.close()
    })
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return
    const delay = this.backoff
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs ?? 30000)
      this.open()
    }, delay)
  }

  private startHeartbeat(): void {
    if (!this.opts.heartbeat) return
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(
      () => this.opts.heartbeat?.(this),
      this.opts.heartbeatIntervalMs ?? 15000,
    )
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  close(): void {
    this.closedByUser = true
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }
}
