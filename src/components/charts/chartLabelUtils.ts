import type { IChartApi, ISeriesApi } from 'lightweight-charts'

/**
 * Decimal precision for the price axis, adapted to the coin's magnitude so that
 * tiny prices (e.g. 0.0003) are shown with enough digits to be meaningful.
 * Kept in sync with `fmtPrice`'s bands so labels and the axis agree.
 */
export function priceScaleDigits(ref: number): number {
  const abs = Math.abs(ref)
  if (!Number.isFinite(abs) || abs <= 0) return 2
  if (abs < 0.0001) return 8
  if (abs < 0.01) return 6
  if (abs < 1) return 5
  if (abs < 100) return 4
  return 2
}

/** Parse a hex or rgb(a) colour into [r, g, b], or null when unrecognised. */
export function parseRgb(c: string): [number, number, number] | null {
  const hex = c.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = c.match(/^rgba?\(([^)]+)\)$/i)
  if (m) {
    const p = m[1].split(',').map((s) => Number(s.trim()))
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return [p[0], p[1], p[2]]
  }
  return null
}

/** Force a colour fully opaque so faint line colours stay readable as labels. */
export function solidColor(c: string): string {
  const rgb = parseRgb(c)
  return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : c
}

/** A dimmed (low-alpha) version of a colour, used to fade non-hovered lines. */
export function dimColor(c: string, alpha: number): string {
  const rgb = parseRgb(c)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : c
}

export function applyAdaptivePriceFormat(series: ISeriesApi<'Candlestick'>, refPrice: number): void {
  const digits = priceScaleDigits(refPrice)
  series.applyOptions({
    priceFormat: { type: 'price', precision: digits, minMove: 1 / Math.pow(10, digits) },
  })
}

export interface OverlayLabelItem {
  price: number
  el: HTMLDivElement
}

/** Position HTML overlay labels with lane-based collision avoidance. */
export function positionOverlayLabels(
  series: ISeriesApi<'Candlestick'>,
  chart: IChartApi,
  overlay: HTMLDivElement,
  labels: OverlayLabelItem[],
): void {
  if (labels.length === 0) return

  const axisW = chart.priceScale('right').width()
  const W = overlay.clientWidth
  const H = overlay.clientHeight
  const gap = 20
  const baseRight = axisW + 6
  const minY = gap / 2
  const maxY = H - gap / 2

  const items = labels.map((l) => ({ el: l.el, y: series.priceToCoordinate(l.price) as number | null }))
  for (const it of items) if (it.y === null) it.el.style.top = '-9999px'
  const vis = items.filter((it): it is { el: HTMLDivElement; y: number } => it.y !== null)
  if (vis.length === 0) return

  const maxLabelW = Math.max(...vis.map((it) => it.el.offsetWidth), 80)
  const laneStep = maxLabelW + 10
  const maxLanes = Math.max(1, Math.floor((W - axisW - 12) / laneStep))

  vis.sort((a, b) => a.y - b.y)
  const laneLastY: number[] = []
  for (const it of vis) {
    let y = Math.min(Math.max(it.y, minY), maxY)
    let lane = 0
    while (lane < maxLanes && laneLastY[lane] !== undefined && y < laneLastY[lane] + gap) lane++
    if (lane >= maxLanes) {
      lane = maxLanes - 1
      y = Math.max(y, (laneLastY[lane] ?? -Infinity) + gap)
    }
    laneLastY[lane] = y
    it.el.style.top = `${y}px`
    it.el.style.right = `${baseRight + lane * laneStep}px`
  }
}
