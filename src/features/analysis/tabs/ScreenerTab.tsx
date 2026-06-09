import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { EChart } from '../../../components/charts/EChart'
import { baseTooltip, darkChart } from '../../../components/charts/chartTheme'
import { useTickers, type LiveTicker } from '../../../store/tickers'
import { useMarket } from '../../../store/market'
import { Panel, EmptyState } from '../../../components/ui/primitives'
import { fmtPrice, fmtPct, fmtCompact, pnlColor } from '../../../lib/format'
import clsx from 'clsx'

export function ScreenerTab() {
  const map = useTickers((s) => s.map)
  const setSymbol = useMarket((s) => s.setSymbol)
  const current = useMarket((s) => s.symbol)

  const list = useMemo(() => Object.values(map).filter((t) => t.quoteVol > 0), [map])

  const option = useMemo<EChartsOption>(() => {
    const data = list.map((t) => ({
      name: t.symbol,
      value: [t.changePct, Math.max(t.quoteVol, 1)],
      itemStyle: {
        color:
          t.symbol === current
            ? '#22d3ee'
            : t.changePct >= 0
              ? 'rgba(34,197,94,0.55)'
              : 'rgba(239,68,68,0.55)',
      },
    }))
    return {
      grid: { left: 64, right: 20, top: 16, bottom: 36 },
      tooltip: {
        ...baseTooltip(),
        formatter: (p) => {
          const d = p as unknown as { name: string; value: [number, number] }
          return `${d.name}<br/>24h: ${fmtPct(d.value[0])}<br/>Vol: $${fmtCompact(d.value[1])}`
        },
      },
      xAxis: {
        type: 'value',
        name: '24h %',
        nameTextStyle: { color: '#64748b', fontSize: 10 },
        axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
        axisLine: { lineStyle: { color: darkChart.gridColor } },
      },
      yAxis: {
        type: 'log',
        name: 'Quote volume',
        nameTextStyle: { color: '#64748b', fontSize: 10 },
        axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => `$${fmtCompact(v, 0)}` },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      series: [
        {
          type: 'scatter',
          data,
          symbolSize: 9,
          emphasis: { focus: 'self', itemStyle: { borderColor: '#fff', borderWidth: 1 } },
        },
      ],
    }
  }, [list, current])

  const gainers = useMemo(() => [...list].sort((a, b) => b.changePct - a.changePct).slice(0, 10), [list])
  const losers = useMemo(() => [...list].sort((a, b) => a.changePct - b.changePct).slice(0, 10), [list])
  const volume = useMemo(() => [...list].sort((a, b) => b.quoteVol - a.quoteVol).slice(0, 10), [list])

  if (list.length === 0) {
    return (
      <Panel>
        <EmptyState title="Loading market data…" hint="Live tickers are streaming from Bitunix." />
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Market map"
        subtitle="24h change vs quote volume · click a point to analyze that coin"
      >
        <EChart
          option={option}
          height={380}
          notMerge
          onClick={(p) => {
            const name = (p as unknown as { name?: string }).name
            if (name) setSymbol(name)
          }}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MoverList title="Top gainers" rows={gainers} onPick={setSymbol} current={current} />
        <MoverList title="Top losers" rows={losers} onPick={setSymbol} current={current} />
        <MoverList title="Most active" rows={volume} onPick={setSymbol} current={current} showVol />
      </div>
    </div>
  )
}

function MoverList({
  title,
  rows,
  onPick,
  current,
  showVol,
}: {
  title: string
  rows: LiveTicker[]
  onPick: (s: string) => void
  current: string
  showVol?: boolean
}) {
  return (
    <Panel title={title}>
      <div className="flex flex-col">
        {rows.map((t) => (
          <button
            key={t.symbol}
            onClick={() => onPick(t.symbol)}
            className={clsx(
              'flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-zinc-800/50',
              t.symbol === current && 'bg-cyan-500/10',
            )}
          >
            <span className="font-medium text-zinc-200">{t.symbol}</span>
            <span className="flex items-center gap-3 tabular">
              <span className="text-zinc-400">{fmtPrice(t.last)}</span>
              {showVol ? (
                <span className="w-16 text-right text-zinc-500">${fmtCompact(t.quoteVol, 0)}</span>
              ) : (
                <span className={clsx('w-16 text-right', pnlColor(t.changePct))}>{fmtPct(t.changePct)}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  )
}
