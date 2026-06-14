import type { Candle } from '../../../lib/candles'
import { BACKTEST, HTF, PLAN } from './config'
import { buildCtx, candleBias, htfProxyAt, neutralBand, regimeAt } from './signal'

// ---------------------------------------------------------------------------
// Lightweight in-browser historical validation.
//
// Replays the *candle-derived* portion of the bias bar-by-bar over the loaded
// history and simulates a fixed-RR trade whenever the bias crosses the regime
// neutral band. It can only validate the candle part of the signal — the live
// order-book / derivatives factors have no replayable history — so the result
// is a quality estimate, not a performance guarantee.
// ---------------------------------------------------------------------------

export interface BacktestStats {
  samples: number
  wins: number
  losses: number
  winRate: number // 0..1
  avgR: number // mean R multiple per trade
  expectancy: number // same as avgR; expressed in R units
  profitFactor: number // gross win R / gross loss R
  longSamples: number
  shortSamples: number
  lookbackBars: number
}

interface BacktestOptions {
  lookbackBars?: number
  maxHoldBars?: number
  warmup?: number
  cooldownBars?: number
}

export function backtestSignal(candles: Candle[], options: BacktestOptions = {}): BacktestStats | null {
  const lookbackBars = options.lookbackBars ?? BACKTEST.lookbackBars
  const maxHoldBars = options.maxHoldBars ?? BACKTEST.maxHoldBars
  const warmup = options.warmup ?? BACKTEST.warmup
  const cooldownBars = options.cooldownBars ?? BACKTEST.cooldownBars

  const n = candles.length
  if (n < warmup + 30) return null

  const ctx = buildCtx(candles)
  const start = Math.max(warmup, n - lookbackBars)

  let wins = 0
  let losses = 0
  let longSamples = 0
  let shortSamples = 0
  let grossWin = 0
  let grossLoss = 0
  let sumR = 0
  let samples = 0
  let lastExit = -Infinity

  for (let i = start; i < n - 1; ) {
    if (i - lastExit < cooldownBars) {
      i++
      continue
    }

    const regime = regimeAt(ctx.candles, ctx.closes, i)
    const htf = htfProxyAt(ctx, i)
    const bias = candleBias(ctx, i, htf, regime)
    const band = neutralBand(regime)
    const dir: 'LONG' | 'SHORT' | null = bias > band ? 'LONG' : bias < -band ? 'SHORT' : null
    if (!dir) {
      i++
      continue
    }

    // Respect the higher-timeframe filter exactly like the live plan does.
    if (
      htf !== null &&
      ((dir === 'LONG' && htf < -HTF.conflictThreshold) || (dir === 'SHORT' && htf > HTF.conflictThreshold))
    ) {
      i++
      continue
    }

    const atr = ctx.atr[i] ?? ctx.closes[i] * 0.01
    const entry = candles[i + 1].open // fill on next bar's open
    if (!Number.isFinite(entry) || entry <= 0) {
      i++
      continue
    }
    const stopDist = Math.max(atr * PLAN.stopBufferAtr, entry * PLAN.stopBufferPct)
    const stop = dir === 'LONG' ? entry - stopDist : entry + stopDist
    const risk = Math.abs(entry - stop)
    if (risk <= 0) {
      i++
      continue
    }
    const tp = dir === 'LONG' ? entry + risk * PLAN.targetRR : entry - risk * PLAN.targetRR

    let outcome = 0 // in R
    let exit = i + 1
    let resolved = false
    const last = Math.min(n - 1, i + maxHoldBars)
    for (let j = i + 1; j <= last; j++) {
      const hi = candles[j].high
      const lo = candles[j].low
      if (dir === 'LONG') {
        // Conservative: assume the stop is touched first on an ambiguous bar.
        if (lo <= stop) {
          outcome = -1
          exit = j
          resolved = true
          break
        }
        if (hi >= tp) {
          outcome = PLAN.targetRR
          exit = j
          resolved = true
          break
        }
      } else {
        if (hi >= stop) {
          outcome = -1
          exit = j
          resolved = true
          break
        }
        if (lo <= tp) {
          outcome = PLAN.targetRR
          exit = j
          resolved = true
          break
        }
      }
    }
    if (!resolved) {
      // Mark-to-market at the hold limit.
      const closePx = candles[last].close
      outcome = (dir === 'LONG' ? closePx - entry : entry - closePx) / risk
      exit = last
    }

    samples++
    sumR += outcome
    if (dir === 'LONG') longSamples++
    else shortSamples++
    if (outcome > 0) {
      wins++
      grossWin += outcome
    } else {
      losses++
      grossLoss += Math.abs(outcome)
    }

    lastExit = exit
    i = exit + 1
  }

  if (samples === 0) return null

  const avgR = sumR / samples
  return {
    samples,
    wins,
    losses,
    winRate: wins / samples,
    avgR,
    expectancy: avgR,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    longSamples,
    shortSamples,
    lookbackBars: n - start,
  }
}
