import type { Candle } from '../../lib/candles'

export interface VpBin {
  price: number
  volume: number
}

export interface VolumeProfile {
  bins: VpBin[]
  poc: number // point of control price
  vaHigh: number // value-area high
  vaLow: number // value-area low
  maxVolume: number
}

/**
 * Volume-by-price profile (VPVR). Each candle's volume is distributed evenly
 * across the price bins it spans. Value area = smallest contiguous band around
 * the POC holding `vaPct` of total volume.
 */
export function volumeProfile(candles: Candle[], bins = 60, vaPct = 0.7): VolumeProfile | null {
  if (candles.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const c of candles) {
    if (c.low < min) min = c.low
    if (c.high > max) max = c.high
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  const step = (max - min) / bins
  const vols = new Array(bins).fill(0)

  for (const c of candles) {
    const lo = Math.max(min, Math.min(c.low, c.high))
    const hi = Math.min(max, Math.max(c.low, c.high))
    const loIdx = Math.min(bins - 1, Math.max(0, Math.floor((lo - min) / step)))
    const hiIdx = Math.min(bins - 1, Math.max(0, Math.floor((hi - min) / step)))
    const span = hiIdx - loIdx + 1
    const per = c.volume / span
    for (let i = loIdx; i <= hiIdx; i++) vols[i] += per
  }

  const binsOut: VpBin[] = vols.map((v, i) => ({ price: min + step * (i + 0.5), volume: v }))
  let pocIdx = 0
  for (let i = 1; i < bins; i++) if (vols[i] > vols[pocIdx]) pocIdx = i

  const total = vols.reduce((a, b) => a + b, 0)
  let acc = vols[pocIdx]
  let lo = pocIdx
  let hi = pocIdx
  while (acc < total * vaPct && (lo > 0 || hi < bins - 1)) {
    const below = lo > 0 ? vols[lo - 1] : -1
    const above = hi < bins - 1 ? vols[hi + 1] : -1
    if (above >= below) {
      hi += 1
      acc += vols[hi]
    } else {
      lo -= 1
      acc += vols[lo]
    }
  }

  return {
    bins: binsOut,
    poc: binsOut[pocIdx].price,
    vaHigh: binsOut[hi].price,
    vaLow: binsOut[lo].price,
    maxVolume: vols[pocIdx],
  }
}
