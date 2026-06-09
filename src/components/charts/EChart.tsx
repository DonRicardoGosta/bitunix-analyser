import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

interface EChartProps {
  option: EChartsOption
  height?: number | string
  className?: string
  /** When true, the chart is not animated on update (better for streaming). */
  notMerge?: boolean
}

export function EChart({ option, height = 320, className, notMerge }: EChartProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, notMerge)
  }, [option, notMerge])

  return <div ref={ref} className={className} style={{ width: '100%', height }} />
}

/** Shared dark styling fragments for ECharts options. */
export const darkChart = {
  textStyle: { color: '#94a3b8', fontFamily: 'Inter, sans-serif' },
  gridColor: '#1f2937',
  axisLine: { lineStyle: { color: '#334155' } },
  splitLine: { lineStyle: { color: 'rgba(51,65,85,0.35)' } },
  tooltipBg: 'rgba(15,21,33,0.95)',
  tooltipBorder: '#334155',
  up: '#22c55e',
  down: '#ef4444',
  accent: '#22d3ee',
  amber: '#f59e0b',
  violet: '#a78bfa',
}

export function baseTooltip() {
  return {
    backgroundColor: darkChart.tooltipBg,
    borderColor: darkChart.tooltipBorder,
    textStyle: { color: '#e5e7eb', fontSize: 12 },
  }
}
