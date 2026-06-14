import type { Candle } from '../../../lib/candles'
import { atr } from '../../../lib/indicators'
import { choppinessIndex, efficiencyRatio } from '../../../lib/indicators'
import { buildCtx, candleBias, detectRegime, htfProxyAt, neutralBand } from '../setup/signal'
import { detectPatterns, type DetectedPattern } from '../setup/patterns'

// Scores how "tradeable / easy to read" a coin's movement is, from candles:
//  - efficiency ratio (clean directional move vs. noise)
//  - choppiness index (trending vs. ranging)
//  - ATR% (healthy, tradeable volatility — not dead, not chaotic)
//  - liquidity (quote volume)
// The directional read now reuses the shared candle-bias engine so the
// scanner agrees with the Setup tab.

// Re-exported for backwards compatibility; implementations live in indicators.ts.
export { efficiencyRatio, choppinessIndex }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function lastDefined(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && Number.isFinite(arr[i] as number)) return arr[i] as number
  }
  return null
}

export interface CandidateScore {
  score: number // 0..100 — blend of readability and directional conviction
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  bias: number // -1..+1 candle-derived directional read (matches Setup tab)
  conviction: number // 0..100 directional conviction
  reasons: string[]
  patterns: DetectedPattern[] // entry patterns completing near now (signal only)
  er: number
  chop: number
  atrPct: number
}

export function scoreCandidate(candles: Candle[], quoteVol: number): CandidateScore | null {
  if (candles.length < 30) return null
  const closes = candles.map((c) => c.close)
  const price = closes[closes.length - 1]
  if (!price) return null

  const er = efficiencyRatio(closes, 30)
  const chop = choppinessIndex(candles, 14)
  const atrLast = lastDefined(atr(candles, 14)) ?? 0
  const atrPct = price > 0 ? (atrLast / price) * 100 : 0

  // Tradeability components (how clean/liquid the tape is).
  const trendScore = clamp(er, 0, 1) * 100
  const chopScore = clamp(100 - chop, 0, 100)
  // Log-normal preference around ~0.9% ATR per candle (healthy, not chaotic).
  const volScore = atrPct > 0 ? Math.exp(-((Math.log(atrPct / 0.9)) ** 2) / (2 * 0.9 * 0.9)) * 100 : 0
  // 1M quote vol -> 0, 1B -> 100.
  const liqScore = clamp((Math.log10(Math.max(quoteVol, 1)) - 6) / 3, 0, 1) * 100
  const readability = clamp(trendScore * 0.4 + chopScore * 0.3 + volScore * 0.2 + liqScore * 0.1, 0, 100)

  // Directional read from the shared candle-bias engine (consistent with Setup).
  const ctx = buildCtx(candles)
  const i = candles.length - 1
  const regime = detectRegime(candles)
  const htf = htfProxyAt(ctx, i) // long-EMA proxy; null when history is short
  const bias = candleBias(ctx, i, htf, regime)
  const band = neutralBand(regime)
  const direction: 'LONG' | 'SHORT' | 'NEUTRAL' = bias > band ? 'LONG' : bias < -band ? 'SHORT' : 'NEUTRAL'
  // Conviction scales the magnitude of the bias by how trending the regime is.
  const conviction = clamp(Math.abs(bias) * 100 * (0.5 + 0.5 * regime.trendStrength), 0, 100)

  // Final rank rewards both a readable market and a clear directional setup.
  const score = clamp(readability * 0.7 + conviction * 0.3, 0, 100)

  const reasons: string[] = []
  if (er >= 0.5) reasons.push('Clean trend')
  else if (chop > 61.8) reasons.push('Choppy')
  if (chop < 38.2) reasons.push('Trending')
  if (volScore >= 60) reasons.push('Healthy volatility')
  else if (atrPct < 0.2) reasons.push('Low volatility')
  else if (atrPct > 3) reasons.push('Very volatile')
  if (liqScore >= 70) reasons.push('Liquid')
  if (direction !== 'NEUTRAL' && conviction >= 40) reasons.push('Clear bias')

  // Entry patterns (signal only — does not alter the ranking score).
  const patterns = detectPatterns(candles, { atr: atrLast, regime })

  return { score, direction, bias, conviction, reasons, patterns, er, chop, atrPct }
}
