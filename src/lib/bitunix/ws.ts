import { ReconnectingSocket } from '../ws/ReconnectingSocket'

// Bitunix public market WebSocket. Connects directly from the browser.
const PUBLIC_URL = 'wss://fapi.bitunix.com/public/'

export interface BitunixWsMessage {
  ch: string
  symbol?: string
  ts?: number
  data: unknown
}

type Handler = (msg: BitunixWsMessage) => void

interface Sub {
  ch: string
  symbol?: string
  handlers: Set<Handler>
}

function key(ch: string, symbol?: string): string {
  return `${ch}::${symbol ?? '*'}`
}

class BitunixPublicWs {
  private socket: ReconnectingSocket | null = null
  private subs = new Map<string, Sub>()

  private ensureSocket(): void {
    if (this.socket) return
    this.socket = new ReconnectingSocket({
      url: PUBLIC_URL,
      heartbeatIntervalMs: 15000,
      heartbeat: (s) => s.send({ op: 'ping', ping: Date.now() }),
      onOpen: () => {
        for (const sub of this.subs.values()) this.sendSubscribe(sub.ch, sub.symbol)
      },
      onMessage: (data) => this.dispatch(data),
    })
    this.socket.connect()
  }

  private sendSubscribe(ch: string, symbol?: string): void {
    this.socket?.send({ op: 'subscribe', args: [symbol ? { symbol, ch } : { ch }] })
  }

  private sendUnsubscribe(ch: string, symbol?: string): void {
    this.socket?.send({ op: 'unsubscribe', args: [symbol ? { symbol, ch } : { ch }] })
  }

  private dispatch(data: unknown): void {
    if (!data || typeof data !== 'object') return
    const msg = data as Record<string, unknown>
    if (msg.op === 'pong' || msg.pong || msg.op === 'ping') return
    if (msg.event) return // subscribe/unsubscribe acks
    const ch = msg.ch as string | undefined
    if (!ch) return
    const symbol = msg.symbol as string | undefined
    const payload: BitunixWsMessage = { ch, symbol, ts: msg.ts as number, data: msg.data }

    // Symbol-specific subscribers.
    if (symbol) {
      this.subs.get(key(ch, symbol))?.handlers.forEach((h) => h(payload))
    }
    // Wildcard subscribers (e.g. tickers stream for all symbols).
    this.subs.get(key(ch, undefined))?.handlers.forEach((h) => h(payload))
  }

  subscribe(ch: string, symbol: string | undefined, handler: Handler): () => void {
    this.ensureSocket()
    const k = key(ch, symbol)
    let sub = this.subs.get(k)
    if (!sub) {
      sub = { ch, symbol, handlers: new Set() }
      this.subs.set(k, sub)
      if (this.socket?.isOpen()) this.sendSubscribe(ch, symbol)
    }
    sub.handlers.add(handler)

    return () => {
      const s = this.subs.get(k)
      if (!s) return
      s.handlers.delete(handler)
      if (s.handlers.size === 0) {
        this.subs.delete(k)
        if (this.socket?.isOpen()) this.sendUnsubscribe(ch, symbol)
      }
    }
  }
}

export const bitunixWs = new BitunixPublicWs()
