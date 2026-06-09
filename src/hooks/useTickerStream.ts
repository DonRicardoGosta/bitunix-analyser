import { useEffect } from 'react'
import { bitunixWs, type BitunixWsMessage } from '../lib/bitunix/ws'
import { parseStreamTicker, useTickers, type LiveTicker } from '../store/tickers'

/**
 * Subscribes once to the Bitunix `tickers` stream (all symbols) and keeps the
 * global tickers store up to date. Mount near the app root.
 */
export function useTickerStream(): void {
  const upsertMany = useTickers((s) => s.upsertMany)
  const setConnected = useTickers((s) => s.setConnected)

  useEffect(() => {
    let alive = true
    const handler = (msg: BitunixWsMessage) => {
      if (!alive) return
      const arr = msg.data as Record<string, unknown>[] | undefined
      if (!Array.isArray(arr)) return
      const out: LiveTicker[] = []
      for (const item of arr) {
        const t = parseStreamTicker(item, msg.ts ?? Date.now())
        if (t) out.push(t)
      }
      if (out.length) {
        upsertMany(out)
        setConnected(true)
      }
    }
    const unsub = bitunixWs.subscribe('tickers', undefined, handler)
    return () => {
      alive = false
      setConnected(false)
      unsub()
    }
  }, [upsertMany, setConnected])
}
