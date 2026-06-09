import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTickers } from '../lib/bitunix/rest'
import { parseRestTicker, useTickers, type LiveTicker } from '../store/tickers'

/**
 * Polls all Bitunix futures tickers and keeps the global tickers store fresh.
 * REST is used here (rather than WS) because the all-symbols ticker stream does
 * not expose a usable per-symbol payload. Live per-symbol price/candles still
 * come from the kline WebSocket.
 */
export function useTickersPoll(): void {
  const upsertMany = useTickers((s) => s.upsertMany)
  const setConnected = useTickers((s) => s.setConnected)

  const query = useQuery({
    queryKey: ['allTickers'],
    queryFn: () => getTickers(),
    refetchInterval: 5000,
    staleTime: 4000,
    retry: 1,
  })

  useEffect(() => {
    if (!query.data) return
    const ts = Date.now()
    const out: LiveTicker[] = []
    for (const t of query.data) {
      const parsed = parseRestTicker(t, ts)
      if (parsed) out.push(parsed)
    }
    if (out.length) upsertMany(out)
    setConnected(true)
  }, [query.data, upsertMany, setConnected])

  useEffect(() => {
    if (query.isError) setConnected(false)
  }, [query.isError, setConnected])
}
