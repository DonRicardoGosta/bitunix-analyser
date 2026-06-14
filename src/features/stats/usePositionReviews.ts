import { useQuery } from '@tanstack/react-query'
import { getKline, type KlineInterval } from '../../lib/bitunix/rest'
import { parseKlines, type Candle } from '../../lib/candles'
import { mapLimit } from '../../lib/async'
import { useCredentials } from '../../store/credentials'
import type { PendingPositionRaw } from '../../lib/bitunix/types'
import { buildCtx, candleBias, candleFactors, detectRegime, htfProxyAt, neutralBand } from '../analysis/setup/signal'
import type { SymbolSignal } from './review'

// Enough history for EMA200 so the shared candle-bias can derive a
// higher-timeframe proxy (consistent with the Setup tab / scanner).
const KLINE_LIMIT = 260
const CONCURRENCY = 4

/** Per-symbol read used by the open-position panel: the directional review
 *  signal plus the structure/volatility context needed to suggest a stop. */
export interface SymbolAnalysis {
  signal: SymbolSignal
  price: number
  atr: number
  swingLows: number[]
  swingHighs: number[]
}

function lastDefined(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && Number.isFinite(arr[i] as number)) return arr[i] as number
  }
  return null
}

/** Confirmed swing-low / swing-high prices over the recent window. */
function swingPivots(candles: Candle[], k: number, lookback: number): { lows: number[]; highs: number[] } {
  const lows: number[] = []
  const highs: number[] = []
  const start = Math.max(k, candles.length - lookback)
  for (let i = start; i < candles.length - k; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue
      if (candles[j].high >= candles[i].high) isHigh = false
      if (candles[j].low <= candles[i].low) isLow = false
    }
    if (isHigh) highs.push(candles[i].high)
    if (isLow) lows.push(candles[i].low)
  }
  return { lows, highs }
}

function analyzeCandles(candles: Candle[]): SymbolAnalysis | null {
  if (candles.length < 30) return null
  const ctx = buildCtx(candles)
  const i = candles.length - 1
  const regime = detectRegime(candles)
  const htf = htfProxyAt(ctx, i)
  const bias = candleBias(ctx, i, htf, regime)
  const factors = candleFactors(ctx, i, htf, regime)
  const band = neutralBand(regime)
  const biasLabel: SymbolSignal['biasLabel'] = bias > band ? 'LONG' : bias < -band ? 'SHORT' : 'NEUTRAL'
  const price = ctx.closes[i]
  const atr = lastDefined(ctx.atr) ?? price * 0.01
  const { lows, highs } = swingPivots(candles, 2, 60)
  return {
    signal: { bias, biasLabel, regime, htfTrend: htf, factors },
    price,
    atr,
    swingLows: lows,
    swingHighs: highs,
  }
}

/**
 * Fetches recent candles for every open-position symbol and derives a live
 * directional signal plus structure/volatility context, so positions can be
 * reviewed for reversals and have their stops suggested.
 */
export function usePositionReviews(positions: PendingPositionRaw[], interval: KlineInterval) {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const symbols = [...new Set(positions.map((p) => p.symbol))].sort()
  const key = symbols.join(',')

  return useQuery({
    queryKey: ['positionReviews', interval, key],
    enabled: hasKeys && symbols.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 0,
    queryFn: async (): Promise<Record<string, SymbolAnalysis>> => {
      const results = await mapLimit(symbols, CONCURRENCY, async (symbol) => {
        try {
          const candles = parseKlines(await getKline({ symbol, interval, limit: KLINE_LIMIT }))
          return [symbol, analyzeCandles(candles)] as const
        } catch {
          return [symbol, null] as const
        }
      })
      const out: Record<string, SymbolAnalysis> = {}
      for (const [symbol, a] of results) if (a) out[symbol] = a
      return out
    },
  })
}
