import type { Candle } from '../../lib/candles'
import type { KeyLevel } from './setup/engine'
import type { PriceZoneDef } from '../../components/charts/chartTypes'

const MIN_STRENGTH = 0.35
const MAX_PER_SIDE = 3

function zoneTimeRange(candles: Candle[]): { timeFrom: number; timeTo: number } {
  if (candles.length === 0) return { timeFrom: 0, timeTo: 0 }
  const startIdx = Math.floor(candles.length * 0.4)
  return {
    timeFrom: candles[startIdx].time,
    timeTo: candles[candles.length - 1].time,
  }
}

/** Pick the strongest support/resistance levels and convert them to chart zones. */
export function pickChartZones(
  levels: KeyLevel[],
  candles: Candle[],
  price: number,
  atr: number,
): PriceZoneDef[] {
  if (!candles.length || !Number.isFinite(price) || price <= 0) return []

  const halfBand = Math.max(atr * 0.15, price * 0.0015)
  const { timeFrom, timeTo } = zoneTimeRange(candles)

  const supports = levels
    .filter((l) => l.side === 'support' && l.price < price && l.strength >= MIN_STRENGTH)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_PER_SIDE)

  const resistances = levels
    .filter((l) => l.side === 'resistance' && l.price > price && l.strength >= MIN_STRENGTH)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_PER_SIDE)

  const toZone = (level: KeyLevel): PriceZoneDef => ({
    priceLow: level.price - halfBand,
    priceHigh: level.price + halfBand,
    timeFrom,
    timeTo,
    side: level.side,
    label: level.side === 'support' ? 'SUPPORT LEVEL' : 'RESISTANCE LEVEL',
    subtitle: level.sources[0],
  })

  return [...supports, ...resistances].map(toZone)
}
