import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { PriceZoneDef } from './chartTypes'

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

export interface OverlayZoneItem {
  zone: PriceZoneDef
  rectEl: HTMLDivElement
  labelEl: HTMLDivElement
}

const ZONE_RGB = {
  support: [34, 197, 94] as const,
  resistance: [239, 68, 68] as const,
} as const

const ZONE_TEXT = {
  support: '#22c55e',
  resistance: '#ef4444',
} as const

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Map internal strength 0..1 to a 0..10 display score (10 = max). */
export function formatStrengthScore(strength: number): string {
  const score = strength * 10
  const text = Number.isInteger(score) ? String(score) : score.toFixed(1)
  return `${text}/10`
}

/** Map chart-visible strength (≥0.55) to fill/border rgba alphas. */
function zoneStrengthAlphas(
  strength: number,
  side: 'support' | 'resistance',
  emphasis = 1,
): { fill: string; border: string } {
  const [r, g, b] = ZONE_RGB[side]
  const t = clamp((strength - 0.55) / 0.45, 0, 1)
  const fillAlpha = clamp((0.12 + t * 0.18) * emphasis, 0, 1)
  const borderAlpha = clamp((0.45 + t * 0.3) * emphasis, 0, 1)
  return {
    fill: `rgba(${r},${g},${b},${fillAlpha})`,
    border: `rgba(${r},${g},${b},${borderAlpha})`,
  }
}

export type ZoneVisualMode = 'default' | 'emphasized' | 'dimmed'

/** Apply default, hover-emphasized, or dimmed styling to a zone overlay item. */
export function applyZoneVisual(item: OverlayZoneItem, mode: ZoneVisualMode): void {
  const { zone, rectEl, labelEl } = item
  const textColor = ZONE_TEXT[zone.side]
  const base = zoneStrengthAlphas(zone.strength, zone.side)

  if (mode === 'dimmed') {
    rectEl.style.opacity = '0.25'
    labelEl.style.opacity = '0.25'
    return
  }

  rectEl.style.opacity = ''
  labelEl.style.opacity = mode === 'emphasized' ? '1' : '0.65'

  if (mode === 'emphasized') {
    const emphasized = zoneStrengthAlphas(zone.strength, zone.side, 1.5)
    rectEl.style.background = emphasized.fill
    rectEl.style.border = `1px solid ${emphasized.border}`
    rectEl.style.zIndex = '20'
    labelEl.style.zIndex = '30'
    labelEl.style.background = '#0b0f18'
    labelEl.style.border = `1px solid ${textColor}`
    labelEl.style.borderRadius = '4px'
    labelEl.style.padding = '3px 6px'
    labelEl.style.boxShadow = `0 0 0 1px ${textColor}, 0 2px 6px rgba(0,0,0,0.8)`
    return
  }

  rectEl.style.background = base.fill
  rectEl.style.border = `1px solid ${base.border}`
  rectEl.style.zIndex = '10'
  labelEl.style.zIndex = '11'
  labelEl.style.background = ''
  labelEl.style.border = ''
  labelEl.style.borderRadius = ''
  labelEl.style.padding = ''
  labelEl.style.boxShadow = ''
}

/** Position HTML overlay S/R zone rectangles and their labels. */
export function positionPriceZones(
  series: ISeriesApi<'Candlestick'>,
  chart: IChartApi,
  overlay: HTMLDivElement,
  items: OverlayZoneItem[],
): void {
  if (items.length === 0) return

  const timeScale = chart.timeScale()
  const chartRight = overlay.clientWidth - chart.priceScale('right').width()

  for (const { zone, rectEl, labelEl } of items) {
    const yHigh = series.priceToCoordinate(zone.priceHigh)
    const yLow = series.priceToCoordinate(zone.priceLow)
    const xFrom = timeScale.timeToCoordinate(zone.timeFrom as UTCTimestamp)
    const xTo = timeScale.timeToCoordinate(zone.timeTo as UTCTimestamp)

    if (yHigh === null || yLow === null || xFrom === null || xTo === null) {
      rectEl.style.top = '-9999px'
      labelEl.style.top = '-9999px'
      continue
    }

    const top = Math.min(yHigh, yLow)
    const height = Math.abs(yLow - yHigh)
    const left = Math.min(xFrom, xTo)
    const width = Math.abs(xTo - xFrom)

    if (width < 2 || height < 2) {
      rectEl.style.top = '-9999px'
      labelEl.style.top = '-9999px'
      continue
    }

    const zoneRight = left + width
    const visLeft = Math.max(left, 0)
    const visRight = Math.min(zoneRight, chartRight)

    if (visRight <= visLeft) {
      rectEl.style.top = '-9999px'
      labelEl.style.top = '-9999px'
      continue
    }

    rectEl.style.top = `${top}px`
    rectEl.style.left = `${left}px`
    rectEl.style.width = `${width}px`
    rectEl.style.height = `${height}px`

    const labelX = (visLeft + visRight) / 2
    const labelY = top + height / 2
    labelEl.style.top = `${labelY}px`
    labelEl.style.left = `${labelX}px`
    labelEl.style.transform = 'translate(-50%, -50%)'
  }
}

export function createZoneElements(zone: PriceZoneDef): { rectEl: HTMLDivElement; labelEl: HTMLDivElement } {
  const rectEl = document.createElement('div')
  Object.assign(rectEl.style, {
    position: 'absolute',
    top: '-9999px',
    left: '0px',
    boxSizing: 'border-box',
    borderRadius: '2px',
    cursor: 'default',
    pointerEvents: 'auto',
    zIndex: '10',
  } as Partial<CSSStyleDeclaration>)

  const labelEl = document.createElement('div')
  labelEl.style.cssText = `
    position: absolute;
    top: -9999px;
    left: 0px;
    pointer-events: none;
    z-index: 11;
    font: 700 10px Inter, sans-serif;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    text-align: center;
    white-space: nowrap;
    color: ${ZONE_TEXT[zone.side]};
    line-height: 1.3;
    opacity: 0.65;
  `
  const title = document.createElement('div')
  title.textContent = zone.label
  labelEl.appendChild(title)
  const score = formatStrengthScore(zone.strength)
  const sub = document.createElement('div')
  sub.textContent = zone.subtitle ? `${zone.subtitle} · ${score}` : score
  sub.style.cssText = `
    margin-top: 1px;
    font: 500 9px Inter, sans-serif;
    letter-spacing: normal;
    text-transform: none;
    color: rgba(148,163,184,0.9);
  `
  labelEl.appendChild(sub)

  const item: OverlayZoneItem = { zone, rectEl, labelEl }
  applyZoneVisual(item, 'default')

  return { rectEl, labelEl }
}
