import type { BuilderEntryStyle } from './builder'

/** True when a GTC limit at this price would take liquidity immediately (market-like fill). */
export function builderLimitWouldCross(
  side: 'LONG' | 'SHORT',
  limitPrice: number,
  marketPrice: number,
): boolean {
  if (!Number.isFinite(limitPrice) || !Number.isFinite(marketPrice) || marketPrice <= 0) return true
  return side === 'LONG' ? limitPrice >= marketPrice : limitPrice <= marketPrice
}

/** True when a POST_ONLY limit can rest on the book at the current market. */
export function builderLimitCanRest(
  side: 'LONG' | 'SHORT',
  limitPrice: number,
  marketPrice: number,
): boolean {
  return !builderLimitWouldCross(side, limitPrice, marketPrice)
}

/** Pullback rungs should rest immediately; momentum rungs may need deferred placement. */
export function builderShouldDeferRung(
  side: 'LONG' | 'SHORT',
  entryStyle: BuilderEntryStyle,
  limitPrice: number,
  marketPrice: number,
): boolean {
  if (entryStyle !== 'momentum') return false
  return builderLimitWouldCross(side, limitPrice, marketPrice)
}
