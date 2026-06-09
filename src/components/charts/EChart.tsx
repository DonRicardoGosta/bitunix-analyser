import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

interface EChartProps {
  option: EChartsOption
  height?: number | string
  className?: string
  /** When true, the chart is not animated on update (better for streaming). */
  notMerge?: boolean
  onClick?: (params: echarts.ECElementEvent) => void
}

export function EChart({ option, height = 320, className, notMerge, onClick }: EChartProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const onClickRef = useRef(onClick)

  useEffect(() => {
    onClickRef.current = onClick
  }, [onClick])

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    chart.on('click', (params) => onClickRef.current?.(params as echarts.ECElementEvent))
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
