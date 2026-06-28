import { EventEmitter } from 'node:events'
import type { Candle } from '@shared/market/candle'
import { intervalSeconds, klineChannel, type KlineInterval } from '@shared/market/intervals'
import { toNum } from '@shared/num'
import { logger } from '../logger'
import { ReconnectingSocket } from './reconnectingSocket'

// Real-time Bitunix market feed (item 6). A single public WebSocket connection
// is shared by every running challenge. Strategies consume the candle stream;
// the latest forming-candle close doubles as the real-time price for PnL.

const PUBLIC_URL = 'wss://fapi.bitunix.com/public/'

export interface PriceEvent {
  symbol: string
  price: number
  ts: number
}

export interface CandleEvent {
  symbol: string
  interval: KlineInterval
  candle: Candle
  /** True when `candle` is a just-completed period (strategies evaluate here). */
  closed: boolean
}

interface KlineSub {
  symbol: string
  interval: KlineInterval
  ch: string
  refs: number
  forming?: Candle
}

class BitunixMarketFeed extends EventEmitter {
  private socket: ReconnectingSocket | null = null
  private readonly subs = new Map<string, KlineSub>()
  private readonly prices = new Map<string, number>()

  constructor() {
    super()
    // Many runners/coins attach listeners; avoid the default 10-listener warning.
    this.setMaxListeners(0)
  }

  private key(ch: string, symbol: string): string {
    return `${ch}::${symbol}`
  }

  private ensureSocket(): void {
    if (this.socket) return
    this.socket = new ReconnectingSocket({
      url: PUBLIC_URL,
      heartbeatIntervalMs: 15000,
      heartbeat: (s) => s.send({ op: 'ping', ping: Date.now() }),
      onOpen: () => {
        logger.info('Bitunix market feed connected')
        for (const sub of this.subs.values()) this.sendSubscribe(sub.ch, sub.symbol)
      },
      onMessage: (data) => this.dispatch(data),
    })
    this.socket.connect()
  }

  /** Reference-counted kline subscription for a symbol + interval. */
  subscribeKline(symbol: string, interval: KlineInterval): void {
    this.ensureSocket()
    const ch = klineChannel(interval, false)
    const k = this.key(ch, symbol)
    let sub = this.subs.get(k)
    if (!sub) {
      sub = { symbol, interval, ch, refs: 0 }
      this.subs.set(k, sub)
      if (this.socket?.isOpen()) this.sendSubscribe(ch, symbol)
    }
    sub.refs += 1
  }

  unsubscribeKline(symbol: string, interval: KlineInterval): void {
    const ch = klineChannel(interval, false)
    const k = this.key(ch, symbol)
    const sub = this.subs.get(k)
    if (!sub) return
    sub.refs -= 1
    if (sub.refs <= 0) {
      this.subs.delete(k)
      this.prices.delete(symbol)
      if (this.socket?.isOpen()) this.sendUnsubscribe(ch, symbol)
    }
  }

  /** Latest known price for a symbol (from the forming-candle close). */
  getPrice(symbol: string): number | undefined {
    return this.prices.get(symbol)
  }

  onPrice(fn: (e: PriceEvent) => void): () => void {
    this.on('price', fn)
    return () => this.off('price', fn)
  }

  onCandle(fn: (e: CandleEvent) => void): () => void {
    this.on('candle', fn)
    return () => this.off('candle', fn)
  }

  private sendSubscribe(ch: string, symbol: string): void {
    this.socket?.send({ op: 'subscribe', args: [{ symbol, ch }] })
  }

  private sendUnsubscribe(ch: string, symbol: string): void {
    this.socket?.send({ op: 'unsubscribe', args: [{ symbol, ch }] })
  }

  private dispatch(data: unknown): void {
    if (!data || typeof data !== 'object') return
    const msg = data as Record<string, unknown>
    if (msg.op === 'pong' || msg.pong || msg.op === 'ping') return
    if (msg.event) return // subscribe/unsubscribe acks
    const ch = msg.ch as string | undefined
    const symbol = msg.symbol as string | undefined
    if (!ch || !symbol) return
    const sub = this.subs.get(this.key(ch, symbol))
    if (!sub) return
    const d = msg.data as Record<string, unknown> | undefined
    if (!d) return

    const ts = (msg.ts as number) ?? Date.now()
    const sec = intervalSeconds(sub.interval)
    const bucket = Math.floor(ts / 1000 / sec) * sec
    const close = toNum(d.c)
    if (!Number.isFinite(close) || close === 0) return

    const live: Candle = {
      time: bucket,
      open: toNum(d.o),
      high: toNum(d.h),
      low: toNum(d.l),
      close,
      volume: toNum(d.b),
    }

    this.prices.set(symbol, close)
    this.emit('price', { symbol, price: close, ts } satisfies PriceEvent)

    const prev = sub.forming
    if (prev && live.time > prev.time) {
      // A new bucket started, so the previous forming candle is now closed.
      this.emit('candle', {
        symbol,
        interval: sub.interval,
        candle: prev,
        closed: true,
      } satisfies CandleEvent)
    }
    sub.forming = live
    this.emit('candle', {
      symbol,
      interval: sub.interval,
      candle: live,
      closed: false,
    } satisfies CandleEvent)
  }
}

export const marketFeed = new BitunixMarketFeed()
