import type { Candle } from '../../../lib/candles'
import { atr, ema } from '../../../lib/indicators'

// Scores how "tradeable / easy to read" a coin's movement is, from candles:
//  - efficiency ratio (clean directional move vs. noise)
//  - choppiness index (trending vs. ranging)
//  - ATR% (healthy, tradeable volatility — not dead, not chaotic)
//  - liquidity (quote volume)

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function lastDefined(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && Number.isFinite(arr[i] as number)) return arr[i] as number
  }
  return null
}

/** Kaufman efficiency ratio over the last `lookback` closes (0..1). */
export function efficiencyRatio(values: number[], lookback = 30): number {
  const n = values.length
  if (n < 2) return 0
  const start = Math.max(0, n - lookback - 1)
  const net = Math.abs(values[n - 1] - values[start])
  let path = 0
  for (let i = start + 1; i < n; i++) path += Math.abs(values[i] - values[i - 1])
  return path > 0 ? net / path : 0
}

/** Choppiness index over `period` (≈0 trending, ≈100 ranging). */
export function choppinessIndex(candles: Candle[], period = 14): number {
  const n = candles.length
  if (n < period + 1) return 50
  let trSum = 0
  let hh = -Infinity
  let ll = Infinity
  for (let i = n - period; i < n; i++) {
    const h = candles[i].high
    const l = candles[i].low
    const pc = candles[i - 1].close
    trSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    if (h > hh) hh = h
    if (l < ll) ll = l
  }
  const range = hh - ll
  if (range <= 0 || trSum <= 0) return 100
  return clamp((100 * Math.log10(trSum / range)) / Math.log10(period), 0, 100)
}

export interface CandidateScore {
  score: number // 0..100
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  reasons: string[]
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
  const ema9 = lastDefined(ema(closes, 9))
  const ema50 = lastDefined(ema(closes, Math.min(50, Math.floor(candles.length / 2))))

  // Component scores (0..100).
  const trendScore = clamp(er, 0, 1) * 100
  const chopScore = clamp(100 - chop, 0, 100)
  // Log-normal preference around ~0.9% ATR per candle (healthy, not chaotic).
  const volScore = atrPct > 0 ? Math.exp(-((Math.log(atrPct / 0.9)) ** 2) / (2 * 0.9 * 0.9)) * 100 : 0
  // 1M quote vol -> 0, 1B -> 100.
  const liqScore = clamp((Math.log10(Math.max(quoteVol, 1)) - 6) / 3, 0, 1) * 100

  const score = clamp(trendScore * 0.4 + chopScore * 0.3 + volScore * 0.2 + liqScore * 0.1, 0, 100)

  let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL'
  if (er >= 0.3 && ema9 !== null && ema50 !== null) direction = ema9 >= ema50 ? 'LONG' : 'SHORT'

  const reasons: string[] = []
  if (er >= 0.5) reasons.push('Clean trend')
  else if (chop > 61.8) reasons.push('Choppy')
  if (chop < 38.2) reasons.push('Trending')
  if (volScore >= 60) reasons.push('Healthy volatility')
  else if (atrPct < 0.2) reasons.push('Low volatility')
  else if (atrPct > 3) reasons.push('Very volatile')
  if (liqScore >= 70) reasons.push('Liquid')

  return { score, direction, reasons, er, chop, atrPct }
}
