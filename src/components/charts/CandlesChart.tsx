import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '../../lib/candles'
import { bollinger, ema, vwap } from '../../lib/indicators'

export interface OverlayToggles {
  ema9: boolean
  ema21: boolean
  ema50: boolean
  bb: boolean
  vwap: boolean
}

interface Props {
  candles: Candle[]
  overlays: OverlayToggles
  height?: number
}

interface LineDef {
  key: string
  color: string
  width: 1 | 2
  values: (number | null)[]
}

export function CandlesChart({ candles, overlays, height = 460 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lineRefs = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())

  useEffect(() => {
    if (!containerRef.current) return
    const lineSeriesMap = lineRefs.current
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
    })
    chartRef.current = chart

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })

    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      lineSeriesMap.clear()
    }
  }, [])

  // Update candle + volume data.
  useEffect(() => {
    const candleSeries = candleRef.current
    const volumeSeries = volumeRef.current
    if (!candleSeries || !volumeSeries) return

    candleSeries.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )
    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
      })),
    )
  }, [candles])

  // Reconcile overlay line series with the current toggles + data.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const closes = candles.map((c) => c.close)

    const defs: LineDef[] = []
    if (overlays.ema9) defs.push({ key: 'ema9', color: '#38bdf8', width: 1, values: ema(closes, 9) })
    if (overlays.ema21) defs.push({ key: 'ema21', color: '#f59e0b', width: 1, values: ema(closes, 21) })
    if (overlays.ema50) defs.push({ key: 'ema50', color: '#a78bfa', width: 1, values: ema(closes, 50) })
    if (overlays.vwap) defs.push({ key: 'vwap', color: '#e879f9', width: 2, values: vwap(candles) })
    if (overlays.bb) {
      const bb = bollinger(closes, 20, 2)
      defs.push({ key: 'bbu', color: 'rgba(148,163,184,0.7)', width: 1, values: bb.upper })
      defs.push({ key: 'bbm', color: 'rgba(148,163,184,0.4)', width: 1, values: bb.mid })
      defs.push({ key: 'bbl', color: 'rgba(148,163,184,0.7)', width: 1, values: bb.lower })
    }

    const wanted = new Set(defs.map((d) => d.key))
    // Remove series no longer wanted.
    for (const [key, series] of lineRefs.current.entries()) {
      if (!wanted.has(key)) {
        chart.removeSeries(series)
        lineRefs.current.delete(key)
      }
    }
    // Add / update wanted series.
    for (const def of defs) {
      let series = lineRefs.current.get(def.key)
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: def.color,
          lineWidth: def.width,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        lineRefs.current.set(def.key, series)
      }
      const data = []
      for (let i = 0; i < candles.length; i++) {
        const v = def.values[i]
        if (v !== null && Number.isFinite(v)) {
          data.push({ time: candles[i].time as UTCTimestamp, value: v as number })
        }
      }
      series.setData(data)
    }
  }, [candles, overlays])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}
