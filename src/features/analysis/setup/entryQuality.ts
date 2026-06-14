import { ENTRY_QUALITY } from './config'
import type { TradePlan } from './engine'

// ---------------------------------------------------------------------------
// Entry-quality evaluation. Given the chosen side's plan and where the trade
// would actually fill (market = current price, limit = typed entry), decide
// whether this is a good point to enter. Purely advisory — it only produces a
// verdict + reasons; it never blocks the order.
// ---------------------------------------------------------------------------

export type EntryVerdict = 'good' | 'caution' | 'poor'

export interface EntryQuality {
  verdict: EntryVerdict
  score: number // derived 0..100
  reasons: string[]
  chasing: boolean
  againstBias: boolean
  counterTrend: boolean
}

export interface EntryQualityInput {
  side: 'LONG' | 'SHORT'
  plan: TradePlan
  effectiveEntry: number
  biasLabel: 'LONG' | 'SHORT' | 'NEUTRAL'
  backtest: { samples: number; expectancy: number } | null
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Evaluates the quality of entering `side` at `effectiveEntry`, combining:
 * chasing (filling beyond the planned entry zone), directional conflict with
 * the live bias, counter-trend (fights the HTF), weak setup quality, and a
 * negative backtest edge.
 */
export function evaluateEntry(i: EntryQualityInput): EntryQuality {
  const { side, plan, effectiveEntry, biasLabel, backtest } = i
  const isLong = side === 'LONG'
  const reasons: string[] = []

  // Risk unit: distance from entry to stop. Falls back to a small fraction of
  // price when the plan is degenerate so chasing math stays finite.
  const risk = Math.abs(plan.entry - plan.stop) || Math.abs(plan.entry) * 0.005 || 1

  // --- Chasing: filling beyond the planned pullback zone in the trade dir. ---
  let chaseR = 0
  if (Number.isFinite(effectiveEntry) && effectiveEntry > 0) {
    if (isLong && effectiveEntry > plan.entryHigh) chaseR = (effectiveEntry - plan.entryHigh) / risk
    else if (!isLong && effectiveEntry < plan.entryLow) chaseR = (plan.entryLow - effectiveEntry) / risk
  }
  const mildChase = chaseR >= ENTRY_QUALITY.chaseMildR
  const farChase = chaseR >= ENTRY_QUALITY.chaseFarR
  const chasing = mildChase
  if (chasing) {
    reasons.push(
      `Price is ${chaseR.toFixed(1)}R ${isLong ? 'above' : 'below'} the entry zone — chasing${
        farChase ? ' hard' : ''
      }`,
    )
  }

  // --- Directional conflict with the live bias. ---
  const againstBias = biasLabel !== 'NEUTRAL' && biasLabel !== side
  if (againstBias) reasons.push(`Bias reads ${biasLabel}, against your ${side}`)

  // --- Counter-trend (fights the higher-timeframe trend). ---
  const counterTrend = plan.counterTrend
  if (counterTrend) reasons.push('Fights the higher-timeframe trend')

  // --- Weak setup quality. ---
  const weakSetup = !plan.valid || plan.quality < ENTRY_QUALITY.weakQuality
  if (!plan.valid && plan.note) reasons.push(plan.note)
  else if (weakSetup) reasons.push(`Low setup quality (${plan.quality.toFixed(0)}/100)`)

  // --- Negative historical edge. ---
  const negativeEdge =
    !!backtest && backtest.samples >= ENTRY_QUALITY.minBacktestSamples && backtest.expectancy < 0
  if (negativeEdge && backtest) {
    reasons.push(`Backtest edge is negative (${backtest.expectancy.toFixed(2)}R over ${backtest.samples})`)
  }

  // --- Verdict. ---
  let verdict: EntryVerdict
  if (counterTrend || againstBias || farChase || plan.quality < ENTRY_QUALITY.poorQuality) {
    verdict = 'poor'
  } else if (weakSetup || mildChase || negativeEdge) {
    verdict = 'caution'
  } else {
    verdict = 'good'
  }

  // --- Score: plan quality minus penalties, for a quick read. ---
  let score = plan.quality
  if (againstBias) score -= 30
  if (counterTrend) score -= 25
  score -= clamp(chaseR, 0, 2) * 12
  if (negativeEdge) score -= 12
  score = clamp(score, 0, 100)

  if (verdict === 'good' && reasons.length === 0) {
    reasons.push('Aligned with bias, price in or near the entry zone')
  }

  return { verdict, score, reasons, chasing, againstBias, counterTrend }
}
