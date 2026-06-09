import { useEffect, useRef, useState } from 'react'
import { getKline, type KlineInterval } from '../../lib/bitunix/rest'
import { parseKlines, type Candle } from '../../lib/candles'
import { bitunixWs, type BitunixWsMessage } from '../../lib/bitunix/ws'
import { klineChannel, intervalSeconds } from '../../lib/bitunix/intervals'
import { toNum } from '../../lib/format'

const HISTORY_PAGES = 4 // ~800 candles (200 max per request)
const LIMIT = 200

async function fetchHistory(
  symbol: string,
  interval: KlineInterval,
  type: 'LAST_PRICE' | 'MARK_PRICE',
): Promise<Candle[]> {
  let endTime: number | undefined = undefined
  const collected: Candle[] = []
  for (let i = 0; i < HISTORY_PAGES; i++) {
    const rows = await getKline({ symbol, interval, limit: LIMIT, endTime, type })
    const parsed = parseKlines(rows)
    if (parsed.length === 0) break
    collected.unshift(...parsed)
    // Page further back from the earliest candle we have.
    endTime = parsed[0].time * 1000 - 1
    if (parsed.length < LIMIT) break
  }
  // De-duplicate by time and sort ascending.
  const map = new Map<number, Candle>()
  for (const c of collected) map.set(c.time, c)
  return [...map.values()].sort((a, b) => a.time - b.time)
}

export interface CandleFeed {
  candles: Candle[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: unknown
}

export function useCandles(
  symbol: string,
  interval: KlineInterval,
  priceType: 'LAST_PRICE' | 'MARK_PRICE',
): CandleFeed {
  const [candles, setCandles] = useState<Candle[]>([])
  const [status, setStatus] = useState<CandleFeed['status']>('idle')
  const [error, setError] = useState<unknown>(null)
  const candlesRef = useRef<Candle[]>([])

  // Initial history load.
  useEffect(() => {
    let alive = true
    setStatus('loading')
    setError(null)
    setCandles([])
    candlesRef.current = []
    fetchHistory(symbol, interval, priceType)
      .then((data) => {
        if (!alive) return
        candlesRef.current = data
        setCandles(data)
        setStatus('ready')
      })
      .catch((e) => {
        if (!alive) return
        setError(e)
        setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [symbol, interval, priceType])

  // Live updates to the forming candle.
  useEffect(() => {
    const ch = klineChannel(interval, priceType === 'MARK_PRICE')
    const sec = intervalSeconds(interval)
    const handler = (msg: BitunixWsMessage) => {
      const d = msg.data as Record<string, unknown> | undefined
      if (!d) return
      const ts = msg.ts ?? Date.now()
      const bucket = Math.floor(ts / 1000 / sec) * sec
      const live: Candle = {
        time: bucket,
        open: toNum(d.o),
        high: toNum(d.h),
        low: toNum(d.l),
        close: toNum(d.c),
        volume: toNum(d.b),
      }
      if (!Number.isFinite(live.close) || live.close === 0) return
      const arr = candlesRef.current
      if (arr.length === 0) return
      const last = arr[arr.length - 1]
      let next: Candle[]
      if (live.time > last.time) {
        next = [...arr, live]
        if (next.length > 1500) next = next.slice(next.length - 1500)
      } else if (live.time === last.time) {
        next = arr.slice(0, -1).concat(live)
      } else {
        return
      }
      candlesRef.current = next
      setCandles(next)
    }
    const unsub = bitunixWs.subscribe(ch, symbol, handler)
    return () => unsub()
  }, [symbol, interval, priceType])

  return { candles, status, error }
}
