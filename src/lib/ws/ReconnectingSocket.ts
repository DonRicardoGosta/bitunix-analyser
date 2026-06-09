// Minimal reconnecting WebSocket with heartbeat and exponential backoff.
// Used directly from the browser (WebSockets are not subject to CORS).

export interface ReconnectingSocketOptions {
  url: string
  onOpen?: (sock: ReconnectingSocket) => void
  onMessage?: (data: unknown, raw: MessageEvent) => void
  onClose?: () => void
  /** Heartbeat sender invoked on an interval while connected. */
  heartbeat?: (sock: ReconnectingSocket) => void
  heartbeatIntervalMs?: number
  maxBackoffMs?: number
}

export class ReconnectingSocket {
  private opts: ReconnectingSocketOptions
  private ws: WebSocket | null = null
  private backoff = 1000
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false

  constructor(opts: ReconnectingSocketOptions) {
    this.opts = opts
  }

  connect(): void {
    this.closedByUser = false
    this.open()
  }

  private open(): void {
    try {
      this.ws = new WebSocket(this.opts.url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.backoff = 1000
      this.startHeartbeat()
      this.opts.onOpen?.(this)
    }

    this.ws.onmessage = (raw) => {
      let parsed: unknown = raw.data
      if (typeof raw.data === 'string') {
        try {
          parsed = JSON.parse(raw.data)
        } catch {
          parsed = raw.data
        }
      }
      this.opts.onMessage?.(parsed, raw)
    }

    this.ws.onclose = () => {
      this.stopHeartbeat()
      this.opts.onClose?.()
      if (!this.closedByUser) this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will follow and trigger reconnect.
      this.ws?.close()
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return
    if (this.reconnectTimer) return
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
    this.heartbeatTimer = setInterval(() => {
      this.opts.heartbeat?.(this)
    }, this.opts.heartbeatIntervalMs ?? 15000)
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
