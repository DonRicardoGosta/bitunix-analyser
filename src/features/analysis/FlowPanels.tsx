import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { EChart } from '../../components/charts/EChart'
import { baseTooltip, darkChart, referenceMarkLine } from '../../components/charts/chartTheme'
import { useAnalysisLive } from '../../store/analysisLive'
import { volumeProfile } from './volumeProfile'
import type { Candle } from '../../lib/candles'
import { fmtCompact, fmtPrice, fmtClock } from '../../lib/format'
import { EmptyState } from '../../components/ui/primitives'
import clsx from 'clsx'

export function CvdChart() {
  const cvdHistory = useAnalysisLive((s) => s.cvdHistory)
  const option = useMemo<EChartsOption | null>(() => {
    if (cvdHistory.length < 2) return null
    return {
      grid: { left: 56, right: 16, top: 14, bottom: 24 },
      tooltip: { ...baseTooltip(), trigger: 'axis', valueFormatter: (v) => fmtCompact(v as number) },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: darkChart.gridColor } },
        axisLabel: { color: '#64748b', fontSize: 9 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => fmtCompact(v, 0) },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      series: [
        {
          name: 'CVD',
          type: 'line',
          showSymbol: false,
          data: cvdHistory.map((p) => [p.time, p.cvd]),
          lineStyle: { color: darkChart.accent, width: 1.5 },
          areaStyle: { color: 'rgba(34,211,238,0.10)' },
          markLine: referenceMarkLine([{ yAxis: 0, label: 'CVD 0', color: 'rgba(148,163,184,0.85)' }]),
        },
      ],
    }
  }, [cvdHistory])

  if (!option)
    return <EmptyState title="Waiting for trades…" hint="Cumulative volume delta builds from the live trade stream." />
  return <EChart option={option} height={240} notMerge />
}

export function FlowStats() {
  const buyVol = useAnalysisLive((s) => s.buyVol)
  const sellVol = useAnalysisLive((s) => s.sellVol)
  const cvd = useAnalysisLive((s) => s.cvd)
  const total = buyVol + sellVol
  const buyPct = total > 0 ? (buyVol / total) * 100 : 50

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Taker buy vol</div>
          <div className="tabular font-semibold text-emerald-400">{fmtCompact(buyVol)}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">CVD</div>
          <div className={clsx('tabular font-semibold', cvd >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
            {cvd >= 0 ? '+' : ''}
            {fmtCompact(cvd)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Taker sell vol</div>
          <div className="tabular font-semibold text-rose-400">{fmtCompact(sellVol)}</div>
        </div>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-800">
        <div className="bg-emerald-500/80" style={{ width: `${buyPct}%` }} />
        <div className="bg-rose-500/80" style={{ width: `${100 - buyPct}%` }} />
      </div>
      <div className="text-center text-xs text-zinc-500">Session aggressor flow (Binance trades)</div>
    </div>
  )
}

export function TradeTape() {
  const trades = useAnalysisLive((s) => s.trades)
  if (trades.length === 0) return <EmptyState title="No trades yet" />
  return (
    <div className="max-h-80 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[#0c111b]">
          <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
            <th className="px-2 py-1">Time</th>
            <th className="px-2 py-1 text-right">Price</th>
            <th className="px-2 py-1 text-right">Size</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={`${t.time}-${i}`} className="border-b border-zinc-800/30">
              <td className="px-2 py-0.5 tabular text-zinc-500">{fmtClock(t.time)}</td>
              <td
                className={clsx(
                  'px-2 py-0.5 text-right tabular font-medium',
                  t.buy ? 'text-emerald-400' : 'text-rose-400',
                )}
              >
                {fmtPrice(t.price)}
              </td>
              <td className="px-2 py-0.5 text-right tabular text-zinc-400">{fmtCompact(t.qty, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function VolumeProfileChart({ candles }: { candles: Candle[] }) {
  const option = useMemo<EChartsOption | null>(() => {
    const vp = volumeProfile(candles, 60)
    if (!vp) return null
    const display = [...vp.bins].reverse()
    return {
      grid: { left: 70, right: 16, top: 8, bottom: 24 },
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => fmtCompact(v as number),
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => fmtCompact(v, 0) },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      yAxis: {
        type: 'category',
        data: display.map((b) => fmtPrice(b.price)),
        axisLabel: { color: '#94a3b8', fontSize: 9, interval: 4 },
        axisLine: { lineStyle: { color: darkChart.gridColor } },
      },
      series: [
        {
          type: 'bar',
          data: display.map((b) => {
            const inVa = b.price >= vp.vaLow && b.price <= vp.vaHigh
            const isPoc = Math.abs(b.price - vp.poc) < 1e-9
            return {
              value: b.volume,
              itemStyle: {
                color: isPoc
                  ? '#f59e0b'
                  : inVa
                    ? 'rgba(34,211,238,0.7)'
                    : 'rgba(100,116,139,0.5)',
              },
            }
          }),
          barWidth: '92%',
        },
      ],
    }
  }, [candles])

  if (!option) return <EmptyState title="No data for volume profile" />
  return <EChart option={option} height={420} notMerge />
}
