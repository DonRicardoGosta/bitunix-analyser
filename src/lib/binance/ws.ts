import { ReconnectingSocket } from '../ws/ReconnectingSocket'
import type { AggTradeMsg, ForceOrderMsg } from './types'

// Binance USD-M futures market WebSocket (direct from browser; CORS-exempt).
const WS_URL = 'wss://fstream.binance.com/ws'

type Handler = (data: unknown) => void

class BinanceWs {
  private socket: ReconnectingSocket | null = null
  private streams = new Map<string, Set<Handler>>()
  private nextId = 1

  private ensureSocket(): void {
    if (this.socket) return
    this.socket = new ReconnectingSocket({
      url: WS_URL,
      onOpen: () => {
        const params = [...this.streams.keys()]
        if (params.length) this.socket?.send({ method: 'SUBSCRIBE', params, id: this.nextId++ })
      },
      onMessage: (data) => this.dispatch(data),
    })
    this.socket.connect()
  }

  private dispatch(data: unknown): void {
    if (!data || typeof data !== 'object') return
    const msg = data as Record<string, unknown>
    if (msg.result !== undefined && msg.id !== undefined) return // sub ack

    const e = msg.e as string | undefined
    let stream: string | null = null
    if (e === 'aggTrade') {
      const s = (msg as unknown as AggTradeMsg).s
      stream = `${s.toLowerCase()}@aggTrade`
    } else if (e === 'forceOrder') {
      const s = (msg as unknown as ForceOrderMsg).o?.s
      if (s) stream = `${s.toLowerCase()}@forceOrder`
    } else if (e === 'depthUpdate') {
      const s = msg.s as string
      stream = `${s.toLowerCase()}@depth`
    }
    if (!stream) return
    this.streams.get(stream)?.forEach((h) => h(data))
  }

  subscribe(stream: string, handler: Handler): () => void {
    this.ensureSocket()
    let set = this.streams.get(stream)
    if (!set) {
      set = new Set()
      this.streams.set(stream, set)
      if (this.socket?.isOpen()) {
        this.socket.send({ method: 'SUBSCRIBE', params: [stream], id: this.nextId++ })
      }
    }
    set.add(handler)

    return () => {
      const s = this.streams.get(stream)
      if (!s) return
      s.delete(handler)
      if (s.size === 0) {
        this.streams.delete(stream)
        if (this.socket?.isOpen()) {
          this.socket.send({ method: 'UNSUBSCRIBE', params: [stream], id: this.nextId++ })
        }
      }
    }
  }
}

export const binanceWs = new BinanceWs()
