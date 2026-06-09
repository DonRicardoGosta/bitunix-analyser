import type { EChartsOption } from 'echarts'
import { baseTooltip, darkChart } from '../../components/charts/EChart'
import type { EquityPoint, HoldBucket, SideBreakdown, SymbolBreakdown } from './compute'
import { fmtUsd } from '../../lib/format'

export function equityCurveOption(curve: EquityPoint[]): EChartsOption {
  const data = curve.map((p) => [p.time, p.equity])
  const dd = curve.map((p) => [p.time, p.drawdown])
  return {
    grid: { left: 56, right: 16, top: 20, bottom: 30 },
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      valueFormatter: (v) => fmtUsd(v as number),
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: darkChart.gridColor } },
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => fmtUsd(v, 0) },
      splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)' } },
    },
    series: [
      {
        name: 'Cumulative PnL',
        type: 'line',
        showSymbol: false,
        smooth: false,
        data,
        lineStyle: { color: darkChart.accent, width: 2 },
        areaStyle: { color: 'rgba(34,211,238,0.10)' },
      },
      {
        name: 'Drawdown',
        type: 'line',
        showSymbol: false,
        data: dd,
        lineStyle: { color: 'rgba(239,68,68,0.0)' },
        areaStyle: { color: 'rgba(239,68,68,0.12)' },
      },
    ],
  }
}

export function symbolBarOption(rows: SymbolBreakdown[]): EChartsOption {
  const top = rows.slice(0, 12).reverse()
  return {
    grid: { left: 80, right: 24, top: 10, bottom: 24 },
    tooltip: { ...baseTooltip(), valueFormatter: (v) => fmtUsd(v as number) },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => fmtUsd(v, 0) },
      splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)' } },
    },
    yAxis: {
      type: 'category',
      data: top.map((r) => r.symbol),
      axisLabel: { color: '#94a3b8', fontSize: 10 },
      axisLine: { lineStyle: { color: darkChart.gridColor } },
    },
    series: [
      {
        type: 'bar',
        data: top.map((r) => ({
          value: r.net,
          itemStyle: { color: r.net >= 0 ? darkChart.up : darkChart.down },
        })),
        barMaxWidth: 16,
      },
    ],
  }
}

export function sideOption(rows: SideBreakdown[]): EChartsOption {
  return {
    grid: { left: 56, right: 16, top: 20, bottom: 24 },
    tooltip: { ...baseTooltip(), valueFormatter: (v) => fmtUsd(v as number) },
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.side),
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      axisLine: { lineStyle: { color: darkChart.gridColor } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => fmtUsd(v, 0) },
      splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)' } },
    },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => ({
          value: r.net,
          itemStyle: { color: r.side === 'LONG' ? darkChart.up : darkChart.down },
        })),
        barMaxWidth: 60,
      },
    ],
  }
}

export function heatmapOption(grid: number[][]): EChartsOption {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const data: [number, number, number][] = []
  let maxAbs = 0
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = grid[d][h]
      data.push([h, d, v])
      maxAbs = Math.max(maxAbs, Math.abs(v))
    }
  }
  if (maxAbs === 0) maxAbs = 1
  return {
    grid: { left: 44, right: 16, top: 10, bottom: 40 },
    tooltip: {
      ...baseTooltip(),
      formatter: (p) => {
        const v = (p as unknown as { value: [number, number, number] }).value
        return `${days[v[1]]} ${String(v[0]).padStart(2, '0')}:00<br/>${fmtUsd(v[2])}`
      },
    },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, i) => String(i)),
      axisLabel: { color: '#64748b', fontSize: 9 },
      axisLine: { lineStyle: { color: darkChart.gridColor } },
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: days,
      axisLabel: { color: '#94a3b8', fontSize: 10 },
      axisLine: { lineStyle: { color: darkChart.gridColor } },
      splitArea: { show: false },
    },
    visualMap: {
      min: -maxAbs,
      max: maxAbs,
      calculable: false,
      show: false,
      inRange: { color: ['#ef4444', '#1f2937', '#22c55e'] },
    },
    series: [
      {
        type: 'heatmap',
        data,
        itemStyle: { borderColor: '#0a0e16', borderWidth: 1 },
      },
    ],
  }
}

export function holdingOption(buckets: HoldBucket[]): EChartsOption {
  return {
    grid: { left: 40, right: 16, top: 20, bottom: 30 },
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      formatter: (params) => {
        const arr = params as unknown as { name: string; dataIndex: number }[]
        const b = buckets[arr[0]?.dataIndex ?? 0]
        return `${arr[0]?.name}<br/>Trades: ${b?.count ?? 0}<br/>Net: ${fmtUsd(b?.net ?? 0)}`
      },
    },
    xAxis: {
      type: 'category',
      data: buckets.map((b) => b.label),
      axisLabel: { color: '#64748b', fontSize: 9, rotate: 30 },
      axisLine: { lineStyle: { color: darkChart.gridColor } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)' } },
    },
    series: [
      {
        type: 'bar',
        data: buckets.map((b) => b.count),
        itemStyle: { color: darkChart.violet },
        barMaxWidth: 30,
      },
    ],
  }
}
