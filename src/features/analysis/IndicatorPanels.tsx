import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { EChart } from '../../components/charts/EChart'
import { baseTooltip, darkChart } from '../../components/charts/chartTheme'
import type { Candle } from '../../lib/candles'
import { macd, rsi, stochRsi } from '../../lib/indicators'

function timeAxis(candles: Candle[]) {
  return {
    type: 'time' as const,
    axisLine: { lineStyle: { color: darkChart.gridColor } },
    axisLabel: { color: '#64748b', fontSize: 9 },
    splitLine: { show: false },
    min: candles.length ? candles[0].time * 1000 : undefined,
    max: candles.length ? candles[candles.length - 1].time * 1000 : undefined,
  }
}

function pair(candles: Candle[], values: (number | null)[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < candles.length; i++) {
    const v = values[i]
    if (v !== null && Number.isFinite(v)) out.push([candles[i].time * 1000, v as number])
  }
  return out
}

export function RsiPanel({ candles }: { candles: Candle[] }) {
  const option = useMemo<EChartsOption>(() => {
    const r = rsi(candles.map((c) => c.close), 14)
    return {
      grid: { left: 40, right: 16, top: 14, bottom: 20 },
      tooltip: { ...baseTooltip(), trigger: 'axis', valueFormatter: (v) => (v as number)?.toFixed(2) },
      xAxis: timeAxis(candles),
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisLabel: { color: '#64748b', fontSize: 9 },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      series: [
        {
          type: 'line',
          showSymbol: false,
          data: pair(candles, r),
          lineStyle: { color: darkChart.accent, width: 1.5 },
          markLine: {
            symbol: 'none',
            silent: true,
            data: [
              { yAxis: 70, lineStyle: { color: 'rgba(239,68,68,0.5)', type: 'dashed' } },
              { yAxis: 30, lineStyle: { color: 'rgba(34,197,94,0.5)', type: 'dashed' } },
            ],
            label: { show: false },
          },
        },
      ],
    }
  }, [candles])
  return <EChart option={option} height={140} notMerge />
}

export function MacdPanel({ candles }: { candles: Candle[] }) {
  const option = useMemo<EChartsOption>(() => {
    const m = macd(candles.map((c) => c.close))
    const histData = []
    for (let i = 0; i < candles.length; i++) {
      const v = m.hist[i]
      if (v !== null && Number.isFinite(v)) {
        histData.push({
          value: [candles[i].time * 1000, v as number],
          itemStyle: { color: (v as number) >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)' },
        })
      }
    }
    return {
      grid: { left: 40, right: 16, top: 14, bottom: 20 },
      tooltip: { ...baseTooltip(), trigger: 'axis', valueFormatter: (v) => (v as number)?.toFixed(4) },
      xAxis: timeAxis(candles),
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#64748b', fontSize: 9 },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      series: [
        { type: 'bar', data: histData, barWidth: '60%' },
        {
          type: 'line',
          showSymbol: false,
          data: pair(candles, m.macd),
          lineStyle: { color: darkChart.accent, width: 1.3 },
        },
        {
          type: 'line',
          showSymbol: false,
          data: pair(candles, m.signal),
          lineStyle: { color: darkChart.amber, width: 1.3 },
        },
      ],
    }
  }, [candles])
  return <EChart option={option} height={150} notMerge />
}

export function StochRsiPanel({ candles }: { candles: Candle[] }) {
  const option = useMemo<EChartsOption>(() => {
    const s = stochRsi(candles.map((c) => c.close))
    return {
      grid: { left: 40, right: 16, top: 14, bottom: 20 },
      tooltip: { ...baseTooltip(), trigger: 'axis', valueFormatter: (v) => (v as number)?.toFixed(2) },
      xAxis: timeAxis(candles),
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 50,
        axisLabel: { color: '#64748b', fontSize: 9 },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      series: [
        {
          type: 'line',
          showSymbol: false,
          data: pair(candles, s.k),
          lineStyle: { color: darkChart.accent, width: 1.3 },
        },
        {
          type: 'line',
          showSymbol: false,
          data: pair(candles, s.d),
          lineStyle: { color: darkChart.violet, width: 1.3 },
          markLine: {
            symbol: 'none',
            silent: true,
            data: [
              { yAxis: 80, lineStyle: { color: 'rgba(239,68,68,0.4)', type: 'dashed' } },
              { yAxis: 20, lineStyle: { color: 'rgba(34,197,94,0.4)', type: 'dashed' } },
            ],
            label: { show: false },
          },
        },
      ],
    }
  }, [candles])
  return <EChart option={option} height={140} notMerge />
}
