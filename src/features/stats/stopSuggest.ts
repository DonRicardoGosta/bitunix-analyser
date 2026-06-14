// ---------------------------------------------------------------------------
// Suggests pulling a position's stop-loss closer to a sensible level when the
// current stop sits too far from price. "Sensible" means anchored to recent
// market structure (the nearest protective swing) with an ATR fallback, never
// so tight that normal noise would stop it out. Purely advisory + reversible —
// it only proposes a price; the user confirms before anything is sent.
// ---------------------------------------------------------------------------

export const STOP_SUGGEST = {
  tooFarAtr: 2.5, // current SL beyond this many ATR from mark => candidate to tighten
  defaultStopAtr: 1.5, // ATR-based fallback stop distance from mark
  anchorBufferAtr: 0.25, // place the stop this far beyond the anchoring swing
  minStopAtr: 0.6, // never tighten closer than this to mark (avoid noise stop-outs)
  minTightenFrac: 0.15, // require the new stop to be at least this much closer
} as const

export interface StopSuggestion {
  price: number // suggested (tighter) stop price
  anchor: 'swing' | 'atr'
  currentDistAtr: number // current SL distance from mark, in ATR
  newDistAtr: number // suggested SL distance from mark, in ATR
  riskReductionPct: number // 0..1 — how much closer the new stop is vs. current
  reason: string
}

export interface SuggestStopInput {
  isLong: boolean
  entry: number
  mark: number
  currentSl: number | null
  atr: number
  swingLows: number[]
  swingHighs: number[]
}

/**
 * Returns a tighter stop suggestion, or null when the current stop is already
 * reasonable (or no sensible tighter level exists). The suggestion always sits
 * on the correct side of price and strictly reduces risk.
 */
export function suggestTighterStop(input: SuggestStopInput): StopSuggestion | null {
  const { isLong, mark, currentSl, atr, swingLows, swingHighs } = input
  if (!(atr > 0) || !(mark > 0)) return null
  if (currentSl === null || !(currentSl > 0)) return null

  const curDist = Math.abs(mark - currentSl)
  const currentDistAtr = curDist / atr
  // Stop already close enough — nothing to do.
  if (currentDistAtr <= STOP_SUGGEST.tooFarAtr) return null

  const minBuf = STOP_SUGGEST.minStopAtr * atr
  const anchorBuf = STOP_SUGGEST.anchorBufferAtr * atr
  const atrStopDist = STOP_SUGGEST.defaultStopAtr * atr
  const tightenCeil = curDist * (1 - STOP_SUGGEST.minTightenFrac) // new stop must be at least this close

  // A candidate is valid if it stays on the correct side of price (with a
  // noise buffer), strictly tightens the existing stop, and reduces risk enough.
  const valid = (stop: number): boolean => {
    if (isLong) {
      if (!(stop > currentSl) || !(stop <= mark - minBuf)) return false
    } else {
      if (!(stop < currentSl) || !(stop >= mark + minBuf)) return false
    }
    return Math.abs(mark - stop) <= tightenCeil
  }

  // Structure anchor: just beyond the nearest protective swing between the
  // current stop and price. ATR fallback when no usable swing exists.
  let swingStop: number | null = null
  if (isLong) {
    const upperBound = mark - minBuf
    const lowCand = swingLows.filter((l) => l < upperBound && l > currentSl).sort((a, b) => b - a)[0]
    if (lowCand !== undefined) swingStop = lowCand - anchorBuf
  } else {
    const lowerBound = mark + minBuf
    const highCand = swingHighs.filter((h) => h > lowerBound && h < currentSl).sort((a, b) => a - b)[0]
    if (highCand !== undefined) swingStop = highCand + anchorBuf
  }
  const atrStop = isLong ? mark - atrStopDist : mark + atrStopDist

  let chosen: number | null = null
  let anchor: 'swing' | 'atr' = 'atr'
  if (swingStop !== null && valid(swingStop)) {
    chosen = swingStop
    anchor = 'swing'
  } else if (valid(atrStop)) {
    chosen = atrStop
    anchor = 'atr'
  }
  if (chosen === null) return null

  const newDist = Math.abs(mark - chosen)

  return {
    price: chosen,
    anchor,
    currentDistAtr,
    newDistAtr: newDist / atr,
    riskReductionPct: curDist > 0 ? 1 - newDist / curDist : 0,
    reason:
      anchor === 'swing'
        ? 'Just beyond the nearest swing (structure)'
        : `~${STOP_SUGGEST.defaultStopAtr} ATR from price`,
  }
}
