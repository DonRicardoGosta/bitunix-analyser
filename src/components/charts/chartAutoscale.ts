import type { AutoscaleInfoProvider, IChartApi } from 'lightweight-charts'
import type { Candle } from '../../lib/candles'

const PADDING_RATIO = 0.08

/**
 * Autoscale the Y-axis from visible candle OHLC only — ignores price lines and
 * overlay series so horizontal zoom keeps candles proportionally sized.
 */
export function createVisibleCandleAutoscaleProvider(
  getCandles: () => Candle[],
  getChart: () => IChartApi | null,
): AutoscaleInfoProvider {
  return () => {
    const candles = getCandles()
    const chart = getChart()
    if (!candles.length || !chart) return null

    const range = chart.timeScale().getVisibleLogicalRange()
    if (!range) return null

    const from = Math.max(0, Math.ceil(range.from))
    const to = Math.min(candles.length - 1, Math.floor(range.to))
    if (from > to) return null

    let min = Infinity
    let max = -Infinity
    for (let i = from; i <= to; i++) {
      const c = candles[i]
      if (!c) continue
      min = Math.min(min, c.low)
      max = Math.max(max, c.high)
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null

    if (min === max) {
      const pad = Math.max(min * 0.002, 1e-8)
      return { priceRange: { minValue: min - pad, maxValue: max + pad } }
    }

    const pad = (max - min) * PADDING_RATIO
    return { priceRange: { minValue: min - pad, maxValue: max + pad } }
  }
}

/** Re-run price autoscale when the user zooms or pans the time axis. */
export function subscribeVisibleRangeAutoscale(chart: IChartApi): () => void {
  const handler = () => {
    chart.priceScale('right').applyOptions({ autoScale: true })
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange(handler)
  return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
}
