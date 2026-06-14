import type { Candle } from '../../../lib/candles'
import { atr as atrIndic } from '../../../lib/indicators'
import { BACKTEST, PLAN, STRADDLE } from './config'

// ---------------------------------------------------------------------------
// Range-reversal validation for the both-directions straddle.
//
// Replays a dual-leg straddle bar-by-bar over recent history: at each bar it
// derives the nearest confirmed swing support/resistance around price (no
// look-ahead) and, when price sits inside a wide-enough range, simulates
// opening a LONG (TP at resistance, stop below support) and a SHORT (TP at
// support, stop above resistance) at the next bar's open. It measures how
// often the bounding levels actually held and reversed price to the far side
// (`bounceRate`) and the mean combined R per straddle (`expectancy`). This is
// the historical evidence that strong levels reverse — i.e. the thesis the
// straddle relies on.
// ---------------------------------------------------------------------------

export interface RangeBacktestStats {
  samples: number
  bothTp: number // straddles where BOTH legs reached TP (full oscillation)
  bounceRate: number // bothTp / samples — how often the range held & reversed
  wins: number // straddles with positive combined net R
  winRate: number // 0..1
  avgR: number // mean combined net R per straddle (long leg R + short leg R)
  expectancy: number // same as avgR, expressed in R units
  longLegWins: number
  shortLegWins: number
  lookbackBars: number
}

interface RangeBacktestOptions {
  lookbackBars?: number
  maxHoldBars?: number
  warmup?: number
  cooldownBars?: number
  pivotK?: number
  pivotLookback?: number
}

/**
 * Nearest confirmed swing support (largest swing-low below price) and
 * resistance (smallest swing-high above price) at bar `i`. Only pivots whose
 * full `±k` window ends at or before `i` are considered, so the result never
 * peeks into the future.
 */
function nearestPivots(
  candles: Candle[],
  i: number,
  k: number,
  lookback: number,
): { support: number | null; resistance: number | null } {
  const price = candles[i].close
  const startIdx = Math.max(k, i - lookback)
  let support: number | null = null
  let resistance: number | null = null
  for (let p = startIdx; p + k <= i; p++) {
    let isHigh = true
    let isLow = true
    for (let j = p - k; j <= p + k; j++) {
      if (j === p) continue
      if (candles[j].high >= candles[p].high) isHigh = false
      if (candles[j].low <= candles[p].low) isLow = false
    }
    if (isHigh && candles[p].high > price) {
      if (resistance === null || candles[p].high < resistance) resistance = candles[p].high
    }
    if (isLow && candles[p].low < price) {
      if (support === null || candles[p].low > support) support = candles[p].low
    }
  }
  return { support, resistance }
}

export function backtestRangeReversal(
  candles: Candle[],
  options: RangeBacktestOptions = {},
): RangeBacktestStats | null {
  const lookbackBars = options.lookbackBars ?? BACKTEST.lookbackBars
  const maxHoldBars = options.maxHoldBars ?? BACKTEST.maxHoldBars
  const warmup = options.warmup ?? BACKTEST.warmup
  const cooldownBars = options.cooldownBars ?? BACKTEST.cooldownBars
  const k = options.pivotK ?? 3
  const pivotLookback = options.pivotLookback ?? 120

  const n = candles.length
  if (n < warmup + 30) return null

  const atrArr = atrIndic(candles, 14)
  const start = Math.max(warmup, n - lookbackBars)

  let samples = 0
  let bothTp = 0
  let wins = 0
  let longLegWins = 0
  let shortLegWins = 0
  let sumR = 0
  let lastExit = -Infinity

  for (let i = start; i < n - 1; ) {
    if (i - lastExit < cooldownBars) {
      i++
      continue
    }

    const price = candles[i].close
    const { support, resistance } = nearestPivots(candles, i, k, pivotLookback)
    if (support === null || resistance === null || !(support < price && price < resistance)) {
      i++
      continue
    }
    if ((resistance - support) / price < STRADDLE.minRangePct) {
      i++
      continue
    }

    const atr = atrArr[i] ?? price * 0.01
    const buffer = Math.max(atr * PLAN.stopBufferAtr, price * PLAN.stopBufferPct)
    const entry = candles[i + 1].open
    if (!Number.isFinite(entry) || entry <= 0 || !(support < entry && entry < resistance)) {
      i++
      continue
    }

    const longStop = support - buffer
    const shortStop = resistance + buffer
    const longRisk = entry - longStop
    const shortRisk = shortStop - entry
    if (longRisk <= 0 || shortRisk <= 0) {
      i++
      continue
    }
    const longRR = (resistance - entry) / longRisk
    const shortRR = (entry - support) / shortRisk
    if (longRR < STRADDLE.minLegRR || shortRR < STRADDLE.minLegRR) {
      i++
      continue
    }

    // Resolve each leg independently (conservative: the stop wins same-bar ties).
    let longOut: number | null = null // outcome in the long leg's R
    let shortOut: number | null = null // outcome in the short leg's R
    let exit = i + 1
    const last = Math.min(n - 1, i + maxHoldBars)
    for (let j = i + 1; j <= last; j++) {
      const hi = candles[j].high
      const lo = candles[j].low
      if (longOut === null) {
        if (lo <= longStop) longOut = -1
        else if (hi >= resistance) longOut = longRR
      }
      if (shortOut === null) {
        if (hi >= shortStop) shortOut = -1
        else if (lo <= support) shortOut = shortRR
      }
      exit = j
      if (longOut !== null && shortOut !== null) break
    }

    // Mark unresolved legs to market at the hold limit.
    const closePx = candles[last].close
    if (longOut === null) longOut = (closePx - entry) / longRisk
    if (shortOut === null) shortOut = (entry - closePx) / shortRisk

    const combined = longOut + shortOut
    samples++
    sumR += combined
    if (longOut > 0 && shortOut > 0) bothTp++
    if (combined > 0) wins++
    if (longOut > 0) longLegWins++
    if (shortOut > 0) shortLegWins++

    lastExit = exit
    i = exit + 1
  }

  if (samples === 0) return null

  const avgR = sumR / samples
  return {
    samples,
    bothTp,
    bounceRate: bothTp / samples,
    wins,
    winRate: wins / samples,
    avgR,
    expectancy: avgR,
    longLegWins,
    shortLegWins,
    lookbackBars: n - start,
  }
}
