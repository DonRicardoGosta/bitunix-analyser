import type { Candle } from '../../lib/candles'
import type { KeyLevel } from './setup/engine'
import type { PriceZoneDef } from '../../components/charts/chartTypes'

const MIN_STRENGTH = 0.55
const MAX_PER_SIDE = 2

function zoneTimeRange(candles: Candle[]): { timeFrom: number; timeTo: number } {
  if (candles.length === 0) return { timeFrom: 0, timeTo: 0 }
  const startIdx = Math.floor(candles.length * 0.4)
  return {
    timeFrom: candles[startIdx].time,
    timeTo: candles[candles.length - 1].time,
  }
}

function mergeSubtitles(a?: string, b?: string): string | undefined {
  const parts = [...(a?.split(' · ') ?? []), ...(b?.split(' · ') ?? [])].filter(Boolean)
  const unique = [...new Set(parts)]
  if (unique.length === 0) return undefined
  return unique.slice(0, 3).join(' · ')
}

/** Merge overlapping zones on the same side into single blocks. */
function mergeOverlappingZones(zones: PriceZoneDef[], halfBand: number): PriceZoneDef[] {
  if (zones.length <= 1) return zones

  const gap = halfBand * 0.5
  const sorted = [...zones].sort((a, b) => a.priceLow - b.priceLow)
  const merged: PriceZoneDef[] = []

  for (const zone of sorted) {
    const current = merged[merged.length - 1]
    if (current && zone.priceLow <= current.priceHigh + gap) {
      current.priceHigh = Math.max(current.priceHigh, zone.priceHigh)
      current.subtitle = mergeSubtitles(current.subtitle, zone.subtitle)
    } else {
      merged.push({ ...zone })
    }
  }

  return merged
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
  const maxDist = Math.max(price * 0.12, atr * 4)

  const supports = levels
    .filter(
      (l) =>
        l.side === 'support' &&
        l.price < price &&
        l.strength >= MIN_STRENGTH &&
        price - l.price <= maxDist,
    )
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_PER_SIDE)

  const resistances = levels
    .filter(
      (l) =>
        l.side === 'resistance' &&
        l.price > price &&
        l.strength >= MIN_STRENGTH &&
        l.price - price <= maxDist,
    )
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

  const supportZones = mergeOverlappingZones(supports.map(toZone), halfBand)
  const resistanceZones = mergeOverlappingZones(resistances.map(toZone), halfBand)

  return [...supportZones, ...resistanceZones]
}
