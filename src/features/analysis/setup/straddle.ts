import type { KeyLevel } from './engine'
import type { Regime } from './signal'
import type { RangeBacktestStats } from './rangeBacktest'
import { PLAN, STRADDLE } from './config'

// ---------------------------------------------------------------------------
// Range straddle (both directions) at strong levels.
//
// Between a strong support `S` (below price) and a strong resistance `R`
// (above price) we open BOTH legs at market now:
//   - LONG:  entry = price, TP = R, stop just below S.
//   - SHORT: entry = price, TP = S, stop just above R.
// If price oscillates in the range, both legs can hit TP. On a breakout the
// winning leg takes profit while the losing leg stops out. Only "valid" when
// both bounding levels are strong, the regime is not strongly trending, and
// the range-reversal backtest shows a positive edge.
// ---------------------------------------------------------------------------

export interface RangeStraddleLeg {
  side: 'LONG' | 'SHORT'
  entry: number
  tp: number
  stop: number
  risk: number // |entry - stop|
  rr: number // reward:risk for this leg
}

export interface RangeStraddlePlan {
  valid: boolean
  support: KeyLevel | null
  resistance: KeyLevel | null
  rangePct: number // (R - S) / price
  long: RangeStraddleLeg | null
  short: RangeStraddleLeg | null
  bestCaseR: number // both legs hit TP (range holds): long.rr + short.rr
  breakoutR: number // worst realistic breakout: winning leg TP + losing leg stop
  quality: number // 0..100
  backtest: RangeBacktestStats | null
  reasons: string[]
  note?: string
}

export interface StraddleInput {
  price: number
  levels: KeyLevel[]
  atr: number
  regime: Regime
  backtest: RangeBacktestStats | null
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Nearest strong support below price (falls back to nearest support for display). */
function pickSupport(levels: KeyLevel[], price: number): KeyLevel | null {
  const below = levels.filter((l) => l.side === 'support' && l.price < price)
  if (!below.length) return null
  const strong = below.filter((l) => l.strength >= STRADDLE.minLevelStrength)
  const pool = strong.length ? strong : below
  return pool.reduce<KeyLevel | null>((best, l) => (best === null || l.price > best.price ? l : best), null)
}

/** Nearest strong resistance above price (falls back to nearest resistance for display). */
function pickResistance(levels: KeyLevel[], price: number): KeyLevel | null {
  const above = levels.filter((l) => l.side === 'resistance' && l.price > price)
  if (!above.length) return null
  const strong = above.filter((l) => l.strength >= STRADDLE.minLevelStrength)
  const pool = strong.length ? strong : above
  return pool.reduce<KeyLevel | null>((best, l) => (best === null || l.price < best.price ? l : best), null)
}

export function buildRangeStraddle(input: StraddleInput): RangeStraddlePlan {
  const { price, levels, atr, regime, backtest } = input

  const support = pickSupport(levels, price)
  const resistance = pickResistance(levels, price)

  const buffer = Math.max(atr * PLAN.stopBufferAtr, price * PLAN.stopBufferPct)

  let long: RangeStraddleLeg | null = null
  let short: RangeStraddleLeg | null = null
  let rangePct = 0

  if (support && resistance && support.price < price && price < resistance.price) {
    rangePct = (resistance.price - support.price) / price
    const longStop = support.price - buffer
    const shortStop = resistance.price + buffer
    const longRisk = price - longStop
    const shortRisk = shortStop - price
    long = {
      side: 'LONG',
      entry: price,
      tp: resistance.price,
      stop: longStop,
      risk: longRisk,
      rr: longRisk > 0 ? (resistance.price - price) / longRisk : 0,
    }
    short = {
      side: 'SHORT',
      entry: price,
      tp: support.price,
      stop: shortStop,
      risk: shortRisk,
      rr: shortRisk > 0 ? (price - support.price) / shortRisk : 0,
    }
  }

  const bestCaseR = (long?.rr ?? 0) + (short?.rr ?? 0)
  const upBreakoutR = (long?.rr ?? 0) - 1 // price breaks above R: long TP, short stop
  const downBreakoutR = (short?.rr ?? 0) - 1 // price breaks below S: short TP, long stop
  const breakoutR = long && short ? Math.min(upBreakoutR, downBreakoutR) : 0

  // ---- Validity gates ----
  const bothStrong =
    !!support &&
    !!resistance &&
    support.strength >= STRADDLE.minLevelStrength &&
    resistance.strength >= STRADDLE.minLevelStrength
  const roomOk =
    rangePct >= STRADDLE.minRangePct &&
    (long?.rr ?? 0) >= STRADDLE.minLegRR &&
    (short?.rr ?? 0) >= STRADDLE.minLegRR
  const regimeOk = regime.trendStrength <= STRADDLE.maxTrendStrength
  const backtestOk =
    !!backtest &&
    backtest.samples >= STRADDLE.minSamples &&
    backtest.expectancy > STRADDLE.minExpectancyR &&
    backtest.bounceRate >= STRADDLE.minBounceRate
  const valid = Boolean(bothStrong && roomOk && regimeOk && backtestOk && long && short)

  // ---- Reasons + note ----
  const reasons: string[] = []
  if (support) reasons.push(`Support ${support.price.toPrecision(6)} · ${support.sources.join(' + ')}`)
  if (resistance) reasons.push(`Resistance ${resistance.price.toPrecision(6)} · ${resistance.sources.join(' + ')}`)
  if (backtest) {
    reasons.push(
      `Range reversal: ${(backtest.bounceRate * 100).toFixed(0)}% both-TP, ` +
        `${backtest.expectancy >= 0 ? '+' : ''}${backtest.expectancy.toFixed(2)}R avg (${backtest.samples} samples)`,
    )
  }

  let note: string | undefined
  if (!support || !resistance) note = 'No strong support/resistance pair around price to straddle.'
  else if (!bothStrong) note = `Bounding levels are not strong enough (need strength ≥ ${STRADDLE.minLevelStrength}).`
  else if (!roomOk) note = `Range too tight or a leg's R:R is below ${STRADDLE.minLegRR}.`
  else if (!regimeOk) note = 'Market is trending — breakout risk is too high for a range straddle.'
  else if (!backtestOk)
    note = backtest
      ? 'Historical range-reversal edge is too weak here — levels broke through too often.'
      : 'Not enough history to validate range reversals.'

  // ---- Quality (0..100) ----
  const lvlStrength = ((support?.strength ?? 0) + (resistance?.strength ?? 0)) / 2
  const btScore = backtest ? clamp(backtest.bounceRate, 0, 1) : 0
  const rangeScore = clamp(bestCaseR / 4, 0, 1)
  const calmScore = clamp(1 - regime.trendStrength, 0, 1)
  const quality = clamp(lvlStrength * 35 + btScore * 30 + rangeScore * 20 + calmScore * 15, 0, 100)

  return {
    valid,
    support,
    resistance,
    rangePct,
    long,
    short,
    bestCaseR,
    breakoutR,
    quality,
    backtest,
    reasons,
    note,
  }
}
