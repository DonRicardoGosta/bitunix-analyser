import { useEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '../../lib/candles'
import { createVisibleCandleAutoscaleProvider, subscribeVisibleRangeAutoscale } from './chartAutoscale'
import { applyAdaptivePriceFormat } from './chartLabelUtils'
import type { ChartMarker, PriceLineDef } from './chartTypes'
import { chartOverlayStyle, chartShellStyle, usePriceLineLabels } from './usePriceLineLabels'

export type { ChartMarker, PriceLineDef } from './chartTypes'

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

export function SetupChart({ candles, lines, markers, height = 460, interactive = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const candlesRef = useRef(candles)

  useEffect(() => {
    candlesRef.current = candles
  }, [candles])

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
      rightPriceScale: {
        borderColor: '#1f2937',
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
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
      autoscaleInfoProvider: createVisibleCandleAutoscaleProvider(
        () => candlesRef.current,
        () => chartRef.current,
      ),
    })
    markersRef.current = createSeriesMarkers(candleRef.current, [])

    const unsubAutoscale = interactive ? subscribeVisibleRangeAutoscale(chart) : () => {}

    return () => {
      unsubAutoscale()
      markersRef.current?.detach()
      markersRef.current = null
      chart.remove()
      chartRef.current = null
      candleRef.current = null
    }
  }, [interactive])

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
    applyAdaptivePriceFormat(series, ref)
  }, [candles])

  usePriceLineLabels({
    chartRef,
    seriesRef: candleRef,
    overlayRef,
    lines,
    layoutKey: candles,
  })

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

  return (
    <div style={chartShellStyle(height)}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div ref={overlayRef} style={chartOverlayStyle()} />
    </div>
  )
}
