import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '../../lib/candles'

export interface PriceLineDef {
  price: number
  color: string
  title: string
  dashed?: boolean
  width?: 1 | 2 | 3
}

interface Props {
  candles: Candle[]
  lines: PriceLineDef[]
  height?: number
}

export function SetupChart({ candles, lines, height = 460 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])

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
    })
    chartRef.current = chart
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      priceLinesRef.current = []
    }
  }, [])

  useEffect(() => {
    candleRef.current?.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )
  }, [candles])

  useEffect(() => {
    const series = candleRef.current
    if (!series) return
    for (const pl of priceLinesRef.current) series.removePriceLine(pl)
    priceLinesRef.current = []
    for (const def of lines) {
      if (!Number.isFinite(def.price) || def.price <= 0) continue
      priceLinesRef.current.push(
        series.createPriceLine({
          price: def.price,
          color: def.color,
          lineWidth: def.width ?? 1,
          lineStyle: def.dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: def.title,
        }),
      )
    }
  }, [lines, candles])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}
