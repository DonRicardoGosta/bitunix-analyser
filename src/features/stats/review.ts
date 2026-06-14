import type { PendingPositionRaw } from '../../lib/bitunix/types'
import { neutralBand, type FactorScore, type Regime } from '../analysis/setup/signal'
import { positionIsLong } from './positions'

// ---------------------------------------------------------------------------
// Open-position review: compares the live candle-derived directional bias to a
// position's side and decides whether the market has turned against it. Purely
// advisory — it never closes anything.
// ---------------------------------------------------------------------------

/** Candle-derived signal for a single symbol, produced by usePositionReviews. */
export interface SymbolSignal {
  bias: number // -1..+1
  biasLabel: 'LONG' | 'SHORT' | 'NEUTRAL'
  regime: Regime
  htfTrend: number | null // -1..+1, null when unavailable
  factors: FactorScore[]
}

export type ReviewVerdict = 'hold' | 'watch' | 'close' | 'unknown'

export interface PositionReview {
  verdict: ReviewVerdict
  tone: 'up' | 'down' | 'warn' | 'neutral'
  label: string
  reasons: string[]
}

/** Tunable thresholds for the review verdicts. */
export const REVIEW = {
  closeConviction: 0.18, // min directional conviction to advise closing
  htfConflict: 0.3, // |htf trend| beyond this counts as a real HTF conflict
  opposingFactorMin: 0.15, // min |value| for a factor to be named as a reason
} as const

function dirLabel(d: number): 'LONG' | 'SHORT' {
  return d > 0 ? 'LONG' : 'SHORT'
}

export function reviewPosition(
  p: PendingPositionRaw,
  mark: number,
  signal: SymbolSignal | undefined,
): PositionReview {
  if (!signal) return { verdict: 'unknown', tone: 'neutral', label: '—', reasons: [] }

  const isLong = positionIsLong(p, mark)
  const posDir = isLong ? 1 : -1
  const { bias, regime, htfTrend, factors } = signal
  const band = neutralBand(regime)
  const biasDir = bias > band ? 1 : bias < -band ? -1 : 0
  const conviction = Math.abs(bias) * (0.5 + 0.5 * regime.trendStrength)

  // The strongest candle factor pointing against the position (for a concrete why).
  const opposing = factors
    .filter((f) => f.available && Math.sign(f.value) === -posDir && Math.abs(f.value) > REVIEW.opposingFactorMin)
    .sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))[0]

  const htfOpposes =
    htfTrend !== null && Math.sign(htfTrend) === -posDir && Math.abs(htfTrend) >= REVIEW.htfConflict

  // CLOSE — the bias has flipped against the position with real conviction.
  if (biasDir === -posDir && conviction >= REVIEW.closeConviction) {
    const reasons = [
      `Bias turned ${dirLabel(biasDir)} against your ${dirLabel(posDir)} (${Math.round(conviction * 100)}% conviction)`,
    ]
    if (htfOpposes) reasons.push(`Higher-timeframe trend ${htfTrend! < 0 ? 'down' : 'up'}`)
    if (opposing) reasons.push(`${opposing.label}: ${opposing.detail}`)
    return { verdict: 'close', tone: 'down', label: 'Consider closing', reasons }
  }

  // WATCH — momentum is fading or the structure is breaking down.
  if (biasDir === -posDir) {
    const reasons = [`Bias leaning ${dirLabel(biasDir)} but not yet decisive`]
    if (opposing) reasons.push(`${opposing.label}: ${opposing.detail}`)
    return { verdict: 'watch', tone: 'warn', label: 'Momentum fading', reasons }
  }
  if (biasDir === 0) {
    return {
      verdict: 'watch',
      tone: 'warn',
      label: 'Watch',
      reasons: [regime.type === 'RANGE' ? 'Bias neutral · choppy regime' : 'Bias neutralizing'],
    }
  }
  if (regime.type === 'RANGE') {
    return { verdict: 'watch', tone: 'warn', label: 'Watch', reasons: ['On side, but regime turned choppy'] }
  }

  // HOLD — the bias still agrees with the position.
  return {
    verdict: 'hold',
    tone: 'up',
    label: 'On side',
    reasons: [`Bias ${dirLabel(posDir)} · in line with your position`],
  }
}
