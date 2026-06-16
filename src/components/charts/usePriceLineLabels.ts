import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi } from 'lightweight-charts'
import { dimColor, positionOverlayLabels, solidColor } from './chartLabelUtils'
import type { PriceLineDef } from './chartTypes'
import { fmtPrice } from '../../lib/format'

interface ChartLabel {
  price: number
  color: string
  baseWidth: 1 | 2 | 3
  baseStyle: LineStyle
  line: IPriceLine
  el: HTMLDivElement
}

interface UsePriceLineLabelsArgs {
  chartRef: RefObject<IChartApi | null>
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>
  overlayRef: RefObject<HTMLDivElement | null>
  lines: PriceLineDef[]
  /** Re-sync labels when candle data changes (price scale / autoscale). */
  layoutKey?: unknown
}

function createLabelElement(def: PriceLineDef): HTMLDivElement {
  const solid = solidColor(def.color)
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'absolute',
    top: '-9999px',
    right: '0px',
    transform: 'translateY(-50%)',
    font: '600 11px Inter, sans-serif',
    lineHeight: '16px',
    color: solid,
    background: '#0b0f18',
    border: `1px solid ${solid}`,
    borderLeft: `3px solid ${solid}`,
    borderRadius: '4px',
    padding: '1px 6px',
    whiteSpace: 'nowrap',
    boxShadow: '0 1px 3px rgba(0,0,0,0.7)',
    cursor: 'pointer',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>)
  const title = document.createElement('div')
  title.textContent = `${def.title} ${fmtPrice(def.price)}`
  el.appendChild(title)
  if (def.subtitle) {
    const sub = document.createElement('div')
    sub.textContent = def.subtitle
    sub.style.cssText = `
      margin-top: 1px;
      font: 500 9px Inter, sans-serif;
      letter-spacing: normal;
      color: rgba(148,163,184,0.9);
    `
    el.appendChild(sub)
  }
  return el
}

/**
 * HTML overlay price-line labels with collision avoidance and hover emphasis.
 * Used by SetupChart and CandlesChart instead of native axis labels.
 */
export function usePriceLineLabels({
  chartRef,
  seriesRef,
  overlayRef,
  lines,
  layoutKey,
}: UsePriceLineLabelsArgs): void {
  const itemsRef = useRef<ChartLabel[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const series = seriesRef.current
      const chart = chartRef.current
      const overlay = overlayRef.current
      if (!series || !chart || !overlay) return
      positionOverlayLabels(
        series,
        chart,
        overlay,
        itemsRef.current.map((l) => ({ price: l.price, el: l.el })),
      )
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [chartRef, seriesRef, overlayRef])

  useEffect(() => {
    const series = seriesRef.current
    const overlay = overlayRef.current
    if (!series || !overlay) return

    for (const it of itemsRef.current) {
      series.removePriceLine(it.line)
      it.el.remove()
    }
    itemsRef.current = []

    const created: ChartLabel[] = []

    const emphasize = (target: ChartLabel) => {
      for (const it of created) {
        if (it === target) {
          it.line.applyOptions({ color: solidColor(it.color), lineWidth: 3, lineStyle: LineStyle.Solid })
          it.el.style.opacity = '1'
          it.el.style.zIndex = '30'
          it.el.style.borderColor = solidColor(it.color)
          it.el.style.boxShadow = `0 0 0 1px ${solidColor(it.color)}, 0 2px 6px rgba(0,0,0,0.8)`
        } else {
          it.line.applyOptions({ color: dimColor(it.color, 0.12) })
          it.el.style.opacity = '0.28'
        }
      }
    }
    const reset = () => {
      for (const it of created) {
        it.line.applyOptions({ color: it.color, lineWidth: it.baseWidth, lineStyle: it.baseStyle })
        it.el.style.opacity = ''
        it.el.style.zIndex = ''
        it.el.style.borderColor = solidColor(it.color)
        it.el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.7)'
      }
    }

    for (const def of lines) {
      if (!Number.isFinite(def.price) || def.price <= 0) continue
      const baseWidth = def.width ?? 1
      const baseStyle = def.dashed ? LineStyle.Dashed : LineStyle.Solid
      const line = series.createPriceLine({
        price: def.price,
        color: def.color,
        lineWidth: baseWidth,
        lineStyle: baseStyle,
        axisLabelVisible: false,
      })
      const el = createLabelElement(def)
      const item: ChartLabel = { price: def.price, color: def.color, baseWidth, baseStyle, line, el }
      el.addEventListener('mouseenter', () => emphasize(item))
      el.addEventListener('mouseleave', reset)
      overlay.appendChild(el)
      created.push(item)
    }
    itemsRef.current = created

    return () => {
      for (const it of itemsRef.current) {
        series.removePriceLine(it.line)
        it.el.remove()
      }
      itemsRef.current = []
    }
  }, [lines, layoutKey, seriesRef, overlayRef])
}

/** Wrapper for price-line overlay div (shared by candle charts). */
export function chartOverlayStyle(): CSSProperties {
  return { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 100 }
}

export function chartShellStyle(height: number): CSSProperties {
  return { position: 'relative', width: '100%', height }
}
