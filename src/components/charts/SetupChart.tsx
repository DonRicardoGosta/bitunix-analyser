import { useEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '../../lib/candles'
import { fmtPrice } from '../../lib/format'

export interface PriceLineDef {
  price: number
  color: string
  title: string
  dashed?: boolean
  width?: 1 | 2 | 3
}

export interface ChartMarker {
  /** Must match a candle's `time` (seconds) or it is dropped silently. */
  time: number
  position: 'aboveBar' | 'belowBar' | 'inBar'
  color: string
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  text?: string
}

interface Props {
  candles: Candle[]
  lines: PriceLineDef[]
  markers?: ChartMarker[]
  height?: number
  /**
   * When false, mouse-wheel zoom/scroll is disabled so the chart does not hijack
   * the page/container scroll (used for the small pattern preview charts).
   */
  interactive?: boolean
}

/**
 * Decimal precision for the price axis, adapted to the coin's magnitude so that
 * tiny prices (e.g. 0.0003) are shown with enough digits to be meaningful.
 * Kept in sync with `fmtPrice`'s bands so labels and the axis agree.
 */
function priceScaleDigits(ref: number): number {
  const abs = Math.abs(ref)
  if (!Number.isFinite(abs) || abs <= 0) return 2
  if (abs < 0.0001) return 8
  if (abs < 0.01) return 6
  if (abs < 1) return 5
  if (abs < 100) return 4
  return 2
}

/** Parse a hex or rgb(a) colour into [r, g, b], or null when unrecognised. */
function parseRgb(c: string): [number, number, number] | null {
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
function solidColor(c: string): string {
  const rgb = parseRgb(c)
  return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : c
}

/** A dimmed (low-alpha) version of a colour, used to fade non-hovered lines. */
function dimColor(c: string, alpha: number): string {
  const rgb = parseRgb(c)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : c
}

interface ChartLabel {
  price: number
  color: string
  baseWidth: 1 | 2 | 3
  baseStyle: LineStyle
  line: IPriceLine
  el: HTMLDivElement
}

export function SetupChart({ candles, lines, markers, height = 460, interactive = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const itemsRef = useRef<ChartLabel[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'Inter, sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(51,65,85,0.18)' },
        horzLines: { color: 'rgba(51,65,85,0.18)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1f2937' },
      timeScale: { borderColor: '#1f2937', timeVisible: true, secondsVisible: false },
      ...(interactive
        ? {}
        : {
            handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
            handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false, axisDoubleClickReset: false },
          }),
    })
    chartRef.current = chart
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    markersRef.current = createSeriesMarkers(candleRef.current, [])

    // Keep the overlay labels glued to their price levels across zoom / pan /
    // autoscale / resize. A rAF loop is cheap for a handful of labels and avoids
    // wiring up every price-scale event.
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      positionLabels()
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      markersRef.current?.detach()
      markersRef.current = null
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      itemsRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const series = candleRef.current
    if (!series) return
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )
    const ref = candles.length ? candles[candles.length - 1].close : 0
    const digits = priceScaleDigits(ref)
    series.applyOptions({
      priceFormat: { type: 'price', precision: digits, minMove: 1 / Math.pow(10, digits) },
    })
  }, [candles])

  // Draw the price lines themselves (no native titles / axis tags — the text is
  // rendered as collision-avoiding HTML labels in the overlay instead).
  useEffect(() => {
    const series = candleRef.current
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
      const solid = solidColor(def.color)
      const el = document.createElement('div')
      el.textContent = `${def.title} ${fmtPrice(def.price)}`
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
      const item: ChartLabel = { price: def.price, color: def.color, baseWidth, baseStyle, line, el }
      el.addEventListener('mouseenter', () => emphasize(item))
      el.addEventListener('mouseleave', reset)
      overlay.appendChild(el)
      created.push(item)
    }
    itemsRef.current = created
  }, [lines, candles])

  useEffect(() => {
    const mapped: SeriesMarker<Time>[] = (markers ?? [])
      .filter((m) => Number.isFinite(m.time))
      .map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.position,
        color: m.color,
        shape: m.shape,
        text: m.text,
      }))
    markersRef.current?.setMarkers(mapped)
  }, [markers, candles])

  function positionLabels() {
    const series = candleRef.current
    const chart = chartRef.current
    const overlay = overlayRef.current
    const labels = itemsRef.current
    if (!series || !chart || !overlay || labels.length === 0) return

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

    // Lane width follows the widest label so neighbouring lanes never overlap
    // horizontally (some titles are far wider than a fixed step would allow).
    const maxLabelW = Math.max(...vis.map((it) => it.el.offsetWidth), 80)
    const laneStep = maxLabelW + 10
    const maxLanes = Math.max(1, Math.floor((W - axisW - 12) / laneStep))

    // Keep labels at their true price level (top-down), and when several would
    // collide vertically, fan them out into lanes further to the LEFT instead of
    // stacking them all in one column at the axis.
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

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        ref={overlayRef}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 100 }}
      />
    </div>
  )
}
