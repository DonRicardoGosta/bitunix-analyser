import { useQuery } from '@tanstack/react-query'
import { getKline, type KlineInterval } from '../../../lib/bitunix/rest'
import { parseKlines } from '../../../lib/candles'
import { mapLimit } from '../../../lib/async'
import { useTickers, type LiveTicker } from '../../../store/tickers'
import { scoreCandidate, type CandidateScore } from './score'

const CANDIDATE_COUNT = 30
const CONCURRENCY = 5
// Enough history for EMA200 so the shared candle-bias can derive a
// higher-timeframe proxy (keeps the scanner direction consistent with Setup).
const KLINE_LIMIT = 260

export interface RecommendedItem extends CandidateScore {
  symbol: string
  ticker: LiveTicker
}

export function useRecommended(interval: KlineInterval) {
  const ready = useTickers((s) => Object.keys(s.map).length > 0)

  return useQuery({
    queryKey: ['recommended', interval],
    enabled: ready,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 0,
    queryFn: async (): Promise<RecommendedItem[]> => {
      const map = useTickers.getState().map
      const candidates = Object.values(map)
        .filter((t) => t.quoteVol > 0 && t.last > 0)
        .sort((a, b) => b.quoteVol - a.quoteVol)
        .slice(0, CANDIDATE_COUNT)

      const scored = await mapLimit(candidates, CONCURRENCY, async (t) => {
        try {
          const candles = parseKlines(await getKline({ symbol: t.symbol, interval, limit: KLINE_LIMIT }))
          const rec = scoreCandidate(candles, t.quoteVol)
          return rec ? ({ symbol: t.symbol, ticker: t, ...rec } as RecommendedItem) : null
        } catch {
          return null
        }
      })

      return scored
        .filter((x): x is RecommendedItem => x !== null)
        .sort((a, b) => b.score - a.score)
    },
  })
}
