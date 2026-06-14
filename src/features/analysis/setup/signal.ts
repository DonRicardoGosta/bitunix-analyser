import type { Candle } from '../../../lib/candles'
import {
  atr as atrIndic,
  choppinessIndex,
  efficiencyRatio,
  ema,
  macd,
  rsi,
  vwap,
} from '../../../lib/indicators'
import { BIAS, REGIME, MACD_ATR_K, WEIGHTS } from './config'

// ---------------------------------------------------------------------------
// Shared candle-only signal logic.
//
// This module is the single source of truth for the *candle-derived* part of
// the directional bias. The live engine layers order-book / derivatives factors
// on top of it, and the backtester replays it bar-by-bar. Keeping it here (and
// pure) guarantees the live read and the historical validation stay consistent.
// ---------------------------------------------------------------------------

export interface FactorScore {
  label: string
  value: number // -1 (bearish) .. +1 (bullish)
  weight: number
  available: boolean
  detail: string
}

export type RegimeType = 'TREND' | 'RANGE' | 'TRANSITION'

export interface Regime {
  er: number // efficiency ratio 0..1
  chop: number // choppiness index 0..100
  type: RegimeType
  trendStrength: number // 0 (chop) .. 1 (clean trend)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ---- Precomputed indicator context (computed once per candle series) -------

export interface CandleCtx {
  candles: Candle[]
  closes: number[]
  ema9: (number | null)[]
  ema50: (number | null)[]
  ema200: (number | null)[]
  rsi: (number | null)[]
  macdHist: (number | null)[]
  vwap: (number | null)[]
  atr: (number | null)[]
}

export function buildCtx(candles: Candle[]): CandleCtx {
  const closes = candles.map((c) => c.close)
  return {
    candles,
    closes,
    ema9: ema(closes, 9),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi: rsi(closes, 14),
    macdHist: macd(closes).hist,
    vwap: vwap(candles),
    atr: atrIndic(candles, 14),
  }
}

// ---- Regime detection ------------------------------------------------------

export function regimeAt(candles: Candle[], closes: number[], end: number): Regime {
  const er = efficiencyRatio(closes, REGIME.erLookback, end)
  const chop = choppinessIndex(candles, REGIME.chopPeriod, end)
  let type: RegimeType = 'TRANSITION'
  if (er >= REGIME.erTrendMin && chop <= REGIME.chopTrendMax) type = 'TREND'
  else if (er <= REGIME.erRangeMax || chop >= REGIME.chopRangeMin) type = 'RANGE'
  const chopStrength = clamp((100 - chop) / 100, 0, 1)
  const trendStrength = clamp(er * 0.6 + chopStrength * 0.4, 0, 1)
  return { er, chop, type, trendStrength }
}

export function detectRegime(candles: Candle[]): Regime {
  const closes = candles.map((c) => c.close)
  return regimeAt(candles, closes, candles.length - 1)
}

/** Widen the neutral band when the tape is choppy (fewer false signals). */
export function neutralBand(regime: Regime): number {
  return BIAS.bandTrend + (BIAS.bandChop - BIAS.bandTrend) * (1 - regime.trendStrength)
}

// ---- Trend / structure primitives ------------------------------------------

/** Combined EMA-cross + price-position read used for both LTF and HTF trend. */
export function trendValue(fast: number | null, slow: number | null, price: number): number | null {
  if (fast === null || slow === null || !slow) return null
  const cross = clamp((fast - slow) / slow / 0.01, -1, 1)
  const pos = clamp((price - slow) / slow / 0.02, -1, 1)
  return clamp((cross + pos) / 2, -1, 1)
}

/**
 * Higher-timeframe trend at a given LTF bar. Live code passes the real HTF
 * value; the backtester uses long LTF EMAs (50/200) as a look-ahead-free proxy.
 */
export function htfProxyAt(ctx: CandleCtx, i: number): number | null {
  return trendValue(ctx.ema50[i], ctx.ema200[i], ctx.closes[i])
}

/**
 * Market structure: compares the last two swing highs and last two swing lows.
 * Higher highs + higher lows => bullish; lower highs + lower lows => bearish.
 * Only uses pivots confirmed `k` bars before `end` (no look-ahead).
 */
export function structureValue(candles: Candle[], end: number, lookback = 60, k = 2): number | null {
  const start = Math.max(k, end - lookback)
  const highs: number[] = []
  const lows: number[] = []
  for (let i = start; i <= end - k; i++) {
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
  let acc = 0
  let n = 0
  if (highs.length >= 2) {
    const a = highs[highs.length - 2]
    const b = highs[highs.length - 1]
    if (a > 0) {
      acc += clamp((b - a) / a / 0.01, -1, 1)
      n++
    }
  }
  if (lows.length >= 2) {
    const a = lows[lows.length - 2]
    const b = lows[lows.length - 1]
    if (a > 0) {
      acc += clamp((b - a) / a / 0.01, -1, 1)
      n++
    }
  }
  return n > 0 ? clamp(acc / n, -1, 1) : null
}

// ---- Candle-only factor scoring --------------------------------------------

/**
 * The candle-derived bias factors for a single bar `i`. `htfValue` is the
 * higher-timeframe trend read (-1..+1) or null when unavailable.
 */
export function candleFactors(
  ctx: CandleCtx,
  i: number,
  htfValue: number | null,
  regime: Regime,
): FactorScore[] {
  const price = ctx.closes[i]
  const factors: FactorScore[] = []

  // Trend (EMA9 vs EMA50 + price vs EMA50), damped when the regime is choppy.
  const tv = trendValue(ctx.ema9[i], ctx.ema50[i], price)
  if (tv !== null) {
    const damp = 0.4 + 0.6 * regime.trendStrength
    factors.push({
      label: 'Trend (EMA)',
      value: clamp(tv * damp, -1, 1),
      weight: WEIGHTS.trend,
      available: true,
      detail: `EMA9 ${(ctx.ema9[i] as number) >= (ctx.ema50[i] as number) ? '>' : '<'} EMA50`,
    })
  }

  // Higher-timeframe trend confirmation.
  if (htfValue !== null) {
    factors.push({
      label: 'HTF trend',
      value: clamp(htfValue, -1, 1),
      weight: WEIGHTS.htfTrend,
      available: true,
      detail: htfValue > 0.1 ? 'Higher TF up' : htfValue < -0.1 ? 'Higher TF down' : 'Higher TF flat',
    })
  }

  // Market structure.
  const sv = structureValue(ctx.candles, i)
  if (sv !== null) {
    factors.push({
      label: 'Structure',
      value: sv,
      weight: WEIGHTS.structure,
      available: true,
      detail: sv > 0.1 ? 'Higher highs/lows' : sv < -0.1 ? 'Lower highs/lows' : 'Sideways structure',
    })
  }

  // RSI — momentum in trends, mean-reversion at range extremes.
  const r = ctx.rsi[i]
  if (r !== null) {
    let value: number
    let detail: string
    if (regime.type === 'RANGE') {
      if (r > 70) {
        value = clamp(-(r - 70) / 30, -1, 0)
        detail = `RSI ${r.toFixed(0)} — fade (range)`
      } else if (r < 30) {
        value = clamp((30 - r) / 30, 0, 1)
        detail = `RSI ${r.toFixed(0)} — fade (range)`
      } else {
        value = clamp((r - 50) / 50, -1, 1) * 0.3
        detail = `RSI ${r.toFixed(0)}`
      }
    } else {
      value = clamp((r - 50) / 50, -1, 1)
      detail = `RSI ${r.toFixed(0)}`
    }
    factors.push({ label: 'RSI (14)', value, weight: WEIGHTS.rsi, available: true, detail })
  }

  // MACD histogram, normalized by ATR (volatility-aware, not a fixed %).
  const hist = ctx.macdHist[i]
  const atr = ctx.atr[i]
  if (hist !== null && atr !== null && atr > 0) {
    const value = clamp(hist / (atr * MACD_ATR_K), -1, 1)
    factors.push({
      label: 'MACD',
      value,
      weight: WEIGHTS.macd,
      available: true,
      detail: `Histogram ${hist >= 0 ? 'positive' : 'negative'}`,
    })
  }

  // VWAP.
  const vw = ctx.vwap[i]
  if (vw !== null && vw > 0) {
    const value = clamp((price - vw) / vw / 0.01, -1, 1)
    factors.push({
      label: 'VWAP',
      value,
      weight: WEIGHTS.vwap,
      available: true,
      detail: `Price ${price > vw ? 'above' : 'below'} VWAP`,
    })
  }

  return factors
}

/** Weighted mean of the available factors (the raw bias, -1..+1). */
export function biasFromFactors(factors: FactorScore[]): number {
  const avail = factors.filter((f) => f.available)
  const wsum = avail.reduce((a, f) => a + f.weight, 0)
  if (wsum === 0) return 0
  return avail.reduce((a, f) => a + f.weight * f.value, 0) / wsum
}

/** Convenience: candle-only bias number for bar `i`. */
export function candleBias(ctx: CandleCtx, i: number, htfValue: number | null, regime: Regime): number {
  return biasFromFactors(candleFactors(ctx, i, htfValue, regime))
}
