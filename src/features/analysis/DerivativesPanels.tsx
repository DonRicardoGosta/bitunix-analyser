import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { EChart } from '../../components/charts/EChart'
import { baseTooltip, darkChart } from '../../components/charts/chartTheme'
import type { LongShortPoint, OpenInterestPoint, TakerVolumePoint } from '../../lib/binance/types'
import type { PricePoint } from '../../lib/binance/rest'
import { useAnalysisLive } from '../../store/analysisLive'
import { toNum, fmtCompact, fmtPrice, fmtClock } from '../../lib/format'
import { EmptyState } from '../../components/ui/primitives'

function timeAxis() {
  return {
    type: 'time' as const,
    axisLine: { lineStyle: { color: darkChart.gridColor } },
    axisLabel: { color: '#64748b', fontSize: 9 },
    splitLine: { show: false },
  }
}

function priceSeries(price: PricePoint[]) {
  return {
    name: 'Price',
    type: 'line' as const,
    yAxisIndex: 1,
    showSymbol: false,
    data: price.map((p) => [p.time, p.close]),
    lineStyle: { color: 'rgba(226,232,240,0.5)', width: 1, type: 'dashed' as const },
  }
}

function priceYAxis() {
  return {
    type: 'value' as const,
    scale: true,
    position: 'right' as const,
    axisLabel: { color: '#475569', fontSize: 9, formatter: (v: number) => fmtPrice(v) },
    splitLine: { show: false },
  }
}

export function OpenInterestChart({ oi, price }: { oi: OpenInterestPoint[]; price: PricePoint[] }) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 56, right: 56, top: 14, bottom: 24 },
      tooltip: { ...baseTooltip(), trigger: 'axis' },
      legend: { show: true, top: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, data: ['Open Interest', 'Price'] },
      xAxis: timeAxis(),
      yAxis: [
        {
          type: 'value',
          scale: true,
          axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => `$${fmtCompact(v, 0)}` },
          splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
        },
        priceYAxis(),
      ],
      series: [
        {
          name: 'Open Interest',
          type: 'line',
          showSymbol: false,
          data: oi.map((p) => [toNum(p.timestamp), toNum(p.sumOpenInterestValue)]),
          lineStyle: { color: darkChart.accent, width: 1.5 },
          areaStyle: { color: 'rgba(34,211,238,0.12)' },
        },
        priceSeries(price),
      ],
    }),
    [oi, price],
  )
  return <EChart option={option} height={240} notMerge />
}

export function LongShortChart({
  global,
  top,
  price,
}: {
  global: LongShortPoint[]
  top: LongShortPoint[]
  price: PricePoint[]
}) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 48, right: 56, top: 14, bottom: 24 },
      tooltip: { ...baseTooltip(), trigger: 'axis', valueFormatter: (v) => (typeof v === 'number' ? v.toFixed(3) : '') },
      legend: {
        show: true,
        top: 0,
        textStyle: { color: '#94a3b8', fontSize: 10 },
        data: ['All accounts L/S', 'Top traders L/S', 'Price'],
      },
      xAxis: timeAxis(),
      yAxis: [
        {
          type: 'value',
          scale: true,
          axisLabel: { color: '#64748b', fontSize: 9 },
          splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
        },
        priceYAxis(),
      ],
      series: [
        {
          name: 'All accounts L/S',
          type: 'line',
          showSymbol: false,
          data: global.map((p) => [toNum(p.timestamp), toNum(p.longShortRatio)]),
          lineStyle: { color: darkChart.up, width: 1.4 },
          markLine: {
            symbol: 'none',
            silent: true,
            data: [{ yAxis: 1, lineStyle: { color: 'rgba(148,163,184,0.4)', type: 'dashed' } }],
            label: { show: false },
          },
        },
        {
          name: 'Top traders L/S',
          type: 'line',
          showSymbol: false,
          data: top.map((p) => [toNum(p.timestamp), toNum(p.longShortRatio)]),
          lineStyle: { color: darkChart.amber, width: 1.4 },
        },
        priceSeries(price),
      ],
    }),
    [global, top, price],
  )
  return <EChart option={option} height={240} notMerge />
}

export function TakerFlowChart({ taker, price }: { taker: TakerVolumePoint[]; price: PricePoint[] }) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 48, right: 56, top: 14, bottom: 24 },
      tooltip: { ...baseTooltip(), trigger: 'axis' },
      legend: { show: true, top: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, data: ['Taker buy/sell', 'Price'] },
      xAxis: timeAxis(),
      yAxis: [
        {
          type: 'value',
          scale: true,
          axisLabel: { color: '#64748b', fontSize: 9 },
          splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
        },
        priceYAxis(),
      ],
      series: [
        {
          name: 'Taker buy/sell',
          type: 'bar',
          data: taker.map((p) => {
            const r = toNum(p.buySellRatio)
            return {
              value: [toNum(p.timestamp), r],
              itemStyle: { color: r >= 1 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)' },
            }
          }),
          markLine: {
            symbol: 'none',
            silent: true,
            data: [{ yAxis: 1, lineStyle: { color: 'rgba(148,163,184,0.4)', type: 'dashed' } }],
            label: { show: false },
          },
        },
        priceSeries(price),
      ],
    }),
    [taker, price],
  )
  return <EChart option={option} height={240} notMerge />
}

/** Live liquidation map: scatter of liquidation events (price × time). */
export function LiquidationMap() {
  const liquidations = useAnalysisLive((s) => s.liquidations)

  const option = useMemo<EChartsOption | null>(() => {
    if (liquidations.length === 0) return null
    const maxNotional = Math.max(...liquidations.map((l) => l.notional), 1)
    const longLiq = liquidations
      .filter((l) => l.liquidatedSide === 'LONG')
      .map((l) => ({ value: [l.time, l.price, l.notional] }))
    const shortLiq = liquidations
      .filter((l) => l.liquidatedSide === 'SHORT')
      .map((l) => ({ value: [l.time, l.price, l.notional] }))
    const sizeFn = (val: number[]) => 4 + Math.sqrt(val[2] / maxNotional) * 26
    return {
      grid: { left: 60, right: 16, top: 14, bottom: 24 },
      tooltip: {
        ...baseTooltip(),
        formatter: (p) => {
          const v = (p as unknown as { value: [number, number, number]; seriesName: string })
          return `${v.seriesName}<br/>${fmtClock(v.value[0])}<br/>${fmtPrice(v.value[1])}<br/>$${fmtCompact(v.value[2])}`
        },
      },
      legend: { show: true, top: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, data: ['Long liq.', 'Short liq.'] },
      xAxis: timeAxis(),
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => fmtPrice(v) },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      series: [
        {
          name: 'Long liq.',
          type: 'scatter',
          data: longLiq,
          symbolSize: sizeFn,
          itemStyle: { color: 'rgba(239,68,68,0.6)', borderColor: '#ef4444' },
        },
        {
          name: 'Short liq.',
          type: 'scatter',
          data: shortLiq,
          symbolSize: sizeFn,
          itemStyle: { color: 'rgba(34,197,94,0.6)', borderColor: '#22c55e' },
        },
      ],
    }
  }, [liquidations])

  if (!option) {
    return (
      <EmptyState
        title="Waiting for liquidations…"
        hint="Live forced-liquidation events from Binance accumulate here while you watch this symbol."
      />
    )
  }
  return <EChart option={option} height={300} notMerge />
}

export function LiquidationStats() {
  const liquidations = useAnalysisLive((s) => s.liquidations)
  const longNotional = liquidations.filter((l) => l.liquidatedSide === 'LONG').reduce((a, b) => a + b.notional, 0)
  const shortNotional = liquidations.filter((l) => l.liquidatedSide === 'SHORT').reduce((a, b) => a + b.notional, 0)
  const total = longNotional + shortNotional
  const longPct = total > 0 ? (longNotional / total) * 100 : 50

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Long liquidations</div>
          <div className="tabular font-semibold text-rose-400">${fmtCompact(longNotional)}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Short liquidations</div>
          <div className="tabular font-semibold text-emerald-400">${fmtCompact(shortNotional)}</div>
        </div>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-800">
        <div className="bg-rose-500/80" style={{ width: `${longPct}%` }} />
        <div className="bg-emerald-500/80" style={{ width: `${100 - longPct}%` }} />
      </div>
      <div className="text-center text-xs text-zinc-500">
        {liquidations.length} events this session · longs liquidated push price down, shorts push it up
      </div>
    </div>
  )
}

export function LiquidationTape() {
  const liquidations = useAnalysisLive((s) => s.liquidations)
  const recent = [...liquidations].slice(-30).reverse()
  if (recent.length === 0) return <EmptyState title="No liquidations yet" />
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[#0c111b]">
          <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
            <th className="px-2 py-1">Time</th>
            <th className="px-2 py-1">Side</th>
            <th className="px-2 py-1 text-right">Price</th>
            <th className="px-2 py-1 text-right">Notional</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((l, i) => (
            <tr key={`${l.time}-${i}`} className="border-b border-zinc-800/40">
              <td className="px-2 py-1 tabular text-zinc-400">{fmtClock(l.time)}</td>
              <td className={'px-2 py-1 font-medium ' + (l.liquidatedSide === 'LONG' ? 'text-rose-400' : 'text-emerald-400')}>
                {l.liquidatedSide}
              </td>
              <td className="px-2 py-1 text-right tabular text-zinc-300">{fmtPrice(l.price)}</td>
              <td className="px-2 py-1 text-right tabular text-zinc-300">${fmtCompact(l.notional)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
