import type { KeyLevel } from './engine'
import type { Regime } from './signal'
import { BUILDER } from './config'

// ---------------------------------------------------------------------------
// Position Builder (laddered scale-in).
//
// Splits a small margin budget across several resting LIMIT orders placed in
// advance at key levels in the chosen build direction:
//   - LONG build:  rungs sit on supports at/below price (buy the dips).
//   - SHORT build: rungs sit on resistances at/above price (sell the rips).
// A single shared take-profit and a wide-but-real stop are attached to every
// rung, so the aggregate position behaves as one TP / one SL. Each rung is kept
// tiny so a drastic adverse move neither liquidates nor stops us out early; the
// order ticket sizes the rungs from the budget and handles the minimum-quantity
// workaround (open `target + min`, shed `min` via a reduce-only order).
// ---------------------------------------------------------------------------

export interface BuilderRung {
  /** The key level this rung sits on, or null for a synthetic ATR-spaced rung. */
  level: KeyLevel | null
  /** Limit price for this rung. */
  price: number
  /** Share of the budget allocated to this rung (sums to ~1 across rungs). */
  weight: number
}

export interface PositionBuilderPlan {
  /** Direction this plan was built for. */
  side: 'LONG' | 'SHORT'
  /** Engine's recommended build direction (from HTF trend + bias). */
  suggestedSide: 'LONG' | 'SHORT'
  valid: boolean
  rungs: BuilderRung[]
  /** Weighted-mean fill price if every rung fills. */
  avgEntry: number
  /** Shared take-profit for the whole position. */
  tp: number
  /** Shared (intentionally wide) stop-loss for the whole position. */
  stop: number
  /** Ladder span (deepest rung → nearest rung) as a fraction of price. */
  rangePct: number
  /** Reward:risk from the average entry to the TP vs. the stop. */
  rr: number
  reasons: string[]
  note?: string
}

export interface BuilderInput {
  side: 'LONG' | 'SHORT'
  price: number
  levels: KeyLevel[]
  atr: number
  regime: Regime
  htfValue: number | null
  bias: number
  /** Desired rung count (clamped to BUILDER.minRungs..maxRungs). */
  rungs?: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Recommended build direction: lean on the higher-timeframe trend, then bias. */
export function suggestBuildSide(htfValue: number | null, bias: number): 'LONG' | 'SHORT' {
  const v = htfValue !== null ? htfValue * 0.6 + bias * 0.4 : bias
  return v >= 0 ? 'LONG' : 'SHORT'
}

/** Build the laddered rung prices for a side, padding with synthetic levels. */
function pickRungs(
  side: 'LONG' | 'SHORT',
  price: number,
  levels: KeyLevel[],
  atr: number,
  count: number,
): BuilderRung[] {
  const isLong = side === 'LONG'
  const maxSpan = Math.max(atr * BUILDER.maxSpanAtrMult, price * BUILDER.maxSpanPct)
  const entrySide = isLong ? 'support' : 'resistance'

  // Real key levels on the entry side within the ladder span, nearest first.
  const real = levels
    .filter((l) => l.side === entrySide && l.strength >= BUILDER.minLevelStrength)
    .filter((l) => (isLong ? l.price <= price && l.price >= price - maxSpan : l.price >= price && l.price <= price + maxSpan))
    .sort((a, b) => (isLong ? b.price - a.price : a.price - b.price))

  const tol = Math.max(atr * 0.3, price * 0.0015)
  const rungs: BuilderRung[] = []
  const accept = (p: number) => rungs.every((r) => Math.abs(r.price - p) > tol)

  for (const l of real) {
    if (rungs.length >= count) break
    if (accept(l.price)) rungs.push({ level: l, price: l.price, weight: 0 })
  }

  // Pad with synthetic ATR/span-spaced rungs if there are too few real levels.
  if (rungs.length < count) {
    const step = maxSpan / count
    for (let i = 1; i <= count && rungs.length < count; i++) {
      const p = isLong ? price - step * i : price + step * i
      if (p > 0 && accept(p)) rungs.push({ level: null, price: p, weight: 0 })
    }
  }

  // Order from nearest to deepest and weight equally.
  rungs.sort((a, b) => (isLong ? b.price - a.price : a.price - b.price))
  const w = rungs.length > 0 ? 1 / rungs.length : 0
  for (const r of rungs) r.weight = w
  return rungs
}

export function buildPositionBuilder(input: BuilderInput): PositionBuilderPlan {
  const { side, price, levels, atr, htfValue, bias } = input
  const isLong = side === 'LONG'
  const suggestedSide = suggestBuildSide(htfValue, bias)
  const count = clamp(Math.round(input.rungs ?? BUILDER.defaultRungs), BUILDER.minRungs, BUILDER.maxRungs)

  const rungs = pickRungs(side, price, levels, atr, count)

  const reasons: string[] = []
  let note: string | undefined

  if (rungs.length < BUILDER.minRungs) {
    return {
      side,
      suggestedSide,
      valid: false,
      rungs,
      avgEntry: price,
      tp: price,
      stop: price,
      rangePct: 0,
      rr: 0,
      reasons,
      note: 'Not enough room to build a ladder around price on this side.',
    }
  }

  // Average entry assuming every rung fills (weighted mean of rung prices).
  const wsum = rungs.reduce((a, r) => a + r.weight, 0) || 1
  const avgEntry = rungs.reduce((a, r) => a + r.price * r.weight, 0) / wsum

  // Deepest rung and a wide, real stop beyond it.
  const deepest = isLong
    ? Math.min(...rungs.map((r) => r.price))
    : Math.max(...rungs.map((r) => r.price))
  const nearest = isLong
    ? Math.max(...rungs.map((r) => r.price))
    : Math.min(...rungs.map((r) => r.price))
  const stopBuffer = Math.max(atr * BUILDER.stopBufferAtr, price * BUILDER.stopBufferPct)
  const stop = isLong ? deepest - stopBuffer : deepest + stopBuffer
  const risk = Math.abs(avgEntry - stop)

  // Shared take-profit: nearest strong opposite level beyond minTpR, else R-mult.
  const targetSide = isLong ? 'resistance' : 'support'
  const minTpDist = risk * BUILDER.minTpR
  const targets = levels
    .filter((l) => l.side === targetSide)
    .filter((l) => (isLong ? l.price >= avgEntry + minTpDist : l.price <= avgEntry - minTpDist))
    .sort((a, b) => (isLong ? a.price - b.price : b.price - a.price))
  const tpLevel = targets[0]
  const tp = tpLevel
    ? tpLevel.price
    : isLong
      ? avgEntry + risk * BUILDER.fallbackTpR
      : avgEntry - risk * BUILDER.fallbackTpR

  const rr = risk > 0 ? Math.abs(tp - avgEntry) / risk : 0
  const rangePct = price > 0 ? Math.abs(nearest - deepest) / price : 0

  // ---- Reasons ----
  const realCount = rungs.filter((r) => r.level).length
  reasons.push(
    `${rungs.length} rungs (${realCount} at key levels${rungs.length - realCount > 0 ? `, ${rungs.length - realCount} ATR-spaced` : ''}) ` +
      `from ${nearest.toPrecision(6)} to ${deepest.toPrecision(6)}`,
  )
  if (tpLevel) reasons.push(`TP at ${tpLevel.sources.join(' + ')} (${tpLevel.price.toPrecision(6)})`)
  else reasons.push(`TP at ${BUILDER.fallbackTpR}R (no structural target in range)`)
  reasons.push(`Stop ${stopBuffer > 0 ? `${(stopBuffer / price * 100).toFixed(2)}% ` : ''}beyond the deepest rung`)

  // ---- Validity ----
  const valid = rungs.length >= BUILDER.minRungs && risk > 0 && rr >= BUILDER.minTpR

  if (!valid) {
    if (rr < BUILDER.minTpR) {
      note = `Reward:risk ${rr.toFixed(2)} is below ${BUILDER.minTpR} — the take-profit is too close for this ladder.`
    } else {
      note = 'Ladder could not be validated here.'
    }
  } else if (side !== suggestedSide) {
    note = `Building ${side} against the suggested ${suggestedSide} direction — higher risk.`
  }

  return {
    side,
    suggestedSide,
    valid,
    rungs,
    avgEntry,
    tp,
    stop,
    rangePct,
    rr,
    reasons,
    note,
  }
}
