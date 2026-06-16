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

/** Momentum rungs above/below price use trigger entries; pullback uses resting limits. */
export function builderUsesTriggerEntry(entryStyle: BuilderEntryStyle): boolean {
  return entryStyle === 'momentum'
}
